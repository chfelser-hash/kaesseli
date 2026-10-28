// CSV-Einlesen für Bank- und Kreditkartenauszüge (PostFinance, Kreditkarten, …)
// Erkennt Zeichensatz, Trennzeichen, Kopfzeile und Spalten möglichst automatisch.

export async function readFileText(file) {
  const buf = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buf);
  // Viele Schweizer Banken exportieren in Windows-1252 / Latin-1
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
  return text.replace(/^﻿/, '');
}

export function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 30).join('\n');
  const cands = [';', ',', '\t', '|'];
  let best = ';', bestScore = -1;
  for (const d of cands) {
    const counts = sample.split('\n').map((l) => splitLine(l, d).length).filter((c) => c > 1);
    if (!counts.length) continue;
    // Häufigste Spaltenzahl × Anzahl Zeilen mit dieser Spaltenzahl
    const freq = {};
    for (const c of counts) freq[c] = (freq[c] || 0) + 1;
    const [cols, rows] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    const score = rows * Math.min(Number(cols), 12);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function splitLine(line, d) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === d) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCsv(text, delimiter) {
  const d = delimiter || detectDelimiter(text);
  // Zeilenumbrüche innerhalb von Anführungszeichen berücksichtigen
  const rows = [];
  let cur = '', q = false;
  for (const ch of text) {
    if (ch === '"') q = !q;
    if ((ch === '\n') && !q) { rows.push(cur.replace(/\r$/, '')); cur = ''; }
    else cur += ch;
  }
  if (cur) rows.push(cur.replace(/\r$/, ''));
  return { delimiter: d, rows: rows.map((l) => splitLine(l, d)).filter((r) => r.some((c) => c !== '')) };
}

// ---------- Werte erkennen ----------
export function parseDate(s) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export function parseAmount(s) {
  s = String(s ?? '').trim().replace(/['’\s]|CHF/g, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  // 1.234,56 → 1234.56 ; 1,234.56 → 1234.56 ; 12,50 → 12.50
  if (/\d\.\d{3},\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/\d,\d{3}\.\d{1,2}$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return null;
  const v = parseFloat(s);
  return neg ? -v : v;
}

const KEYS = {
  date: ['buchungsdatum', 'datum', 'date', 'transaktionsdatum', 'einkaufsdatum', 'valuta'],
  text: ['avisierungstext', 'buchungsdetails', 'beschreibung', 'text', 'details', 'händler', 'haendler', 'merchant', 'description', 'buchungstext', 'empfänger', 'notification', 'mitteilung'],
  debit: ['lastschrift', 'belastung', 'debit', 'soll'],
  credit: ['gutschrift', 'credit', 'haben'],
  amount: ['betrag', 'amount', 'chf'],
};

/** Findet die Kopfzeile (erste Zeile, nach der Datumszeilen folgen) und schlägt Spalten vor. */
export function guessMapping(rows) {
  let header = -1;
  for (let i = 0; i < Math.min(rows.length - 1, 40); i++) {
    const next = rows.slice(i + 1, i + 4);
    const textual = rows[i].filter((c) => c && !parseDate(c) && parseAmount(c) === null).length >= 2;
    if (textual && next.length && next.every((r) => r.some((c) => parseDate(c)))) { header = i; break; }
  }
  if (header < 0) header = rows.findIndex((r) => r.some((c) => parseDate(c))) - 1;
  const head = header >= 0 ? rows[header].map((c) => c.toLowerCase()) : [];
  const find = (keys, exclude = []) => {
    for (const k of keys) {
      const i = head.findIndex((c, idx) => !exclude.includes(idx) && c.includes(k));
      if (i >= 0) return i;
    }
    return -1;
  };
  const sample = rows.slice(header + 1, header + 20);
  let date = find(KEYS.date);
  if (date < 0 && sample.length) date = sample[0].findIndex((c) => parseDate(c));
  const debit = find(KEYS.debit);
  const credit = find(KEYS.credit);
  let amount = debit < 0 ? find(KEYS.amount, [date]) : -1;
  if (amount < 0 && debit < 0 && sample.length) {
    amount = sample[0].findIndex((c, i) => i !== date && parseAmount(c) !== null && /[.,]\d{2}$/.test(c));
  }
  let text = find(KEYS.text, [date, debit, credit, amount]);
  if (text < 0 && sample.length) {
    // längste Textspalte
    const lens = sample[0].map((_, i) => sample.reduce((a, r) => a + ((r[i] || '').length), 0));
    text = lens.reduce((bi, l, i) => (i !== date && i !== amount && i !== debit && i !== credit && l > (lens[bi] ?? -1) ? i : bi), -1);
  }
  // Vorzeichen: Bei einer einzigen Betragsspalte sind Ausgaben bei Banken meist negativ, bei Kreditkarten positiv
  let negatives = 0, positives = 0;
  if (amount >= 0) for (const r of sample) { const v = parseAmount(r[amount]); if (v < 0) negatives++; else if (v > 0) positives++; }
  return {
    header,
    date,
    text,
    text2: -1,
    mode: debit >= 0 ? 'split' : 'single',
    amount,
    debit,
    credit,
    expenseNegative: negatives > positives,
    signature: head.join('|'),
  };
}

/** Wendet ein Mapping an und liefert normalisierte Zeilen {date, text, amount(Ausgabe positiv)} */
export function applyMapping(rows, map) {
  const out = [];
  for (let i = map.header + 1; i < rows.length; i++) {
    const r = rows[i];
    const date = parseDate(r[map.date]);
    if (!date) continue;
    let amount;
    if (map.mode === 'split') {
      const d = parseAmount(r[map.debit]);
      const c = parseAmount(r[map.credit]);
      if (d === null && c === null) continue;
      amount = Math.abs(d || 0) - Math.abs(c || 0);
    } else {
      const v = parseAmount(r[map.amount]);
      if (v === null) continue;
      amount = map.expenseNegative ? -v : v;
    }
    const text = [r[map.text], map.text2 >= 0 ? r[map.text2] : ''].filter(Boolean).join(' – ').replace(/\s+/g, ' ').trim();
    out.push({ date, text, amount: Math.round(amount * 100) / 100, raw: r });
  }
  return out;
}

// ---------- Eingefügter Text (z.B. Transaktionsliste aus Viseca One kopiert) ----------
const MONTH_NAMES = {
  jan: 1, januar: 1, feb: 2, februar: 2, mär: 3, mar: 3, märz: 3, maerz: 3, apr: 4, april: 4, mai: 5, may: 5,
  jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, november: 11, dez: 12, dec: 12, dezember: 12, december: 12,
};
const pad2 = (n) => String(n).padStart(2, '0');
const isoDate = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
// Zeilen mit diesen Wörtern sind keine Transaktionen (Kontostand, Limite, Totale …)
const NOISE = /saldo|limite|verfügbar|verfuegbar|\btotal\b|summe|rechnungsbetrag|mindestzahlung|offener betrag|ausgaben diesen monat/i;
// Statuszeilen, die nicht als Händlername taugen
const STATUS = /^(ausstehend|reserviert|gebucht|pending|in bearbeitung|autorisiert|belastet)$/i;
const CREDIT = /gutschrift|rückerstattung|rueckerstattung|erstattung|zahlung erhalten|einzahlung|ihre zahlung|refund/i;

/** Sucht ein Datum in der Zeile. Liefert {date, rest} oder null. */
export function findDateInLine(line, today = new Date()) {
  const cy = today.getFullYear();
  const todayIso = isoDate(cy, today.getMonth() + 1, today.getDate());
  const fixYear = (y, m, d) => {
    // Ohne Jahresangabe: Datum in der Zukunft gehört zum Vorjahr
    let iso = isoDate(y, m, d);
    if (iso > todayIso) iso = isoDate(y - 1, m, d);
    return iso;
  };
  let m;
  if ((m = line.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) return { date: `${m[1]}-${m[2]}-${m[3]}`, rest: line.replace(m[0], ' ') };
  if ((m = line.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})\b/))) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) <= 31) return { date: isoDate(y, Number(m[2]), Number(m[1])), rest: line.replace(m[0], ' ') };
  }
  // 22. Oktober 2026 / 22. Okt. 2026 / Mittwoch, 22. Okt
  if ((m = line.match(/\b(\d{1,2})\.?\s*([A-Za-zÄÖÜäöü]{3,9})\.?(?:\s+(\d{4}))?/))) {
    const mon = MONTH_NAMES[m[2].toLowerCase()];
    if (mon && Number(m[1]) <= 31) {
      const date = m[3] ? isoDate(Number(m[3]), mon, Number(m[1])) : fixYear(cy, mon, Number(m[1]));
      return { date, rest: line.replace(m[0], ' ').replace(/^(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|mo|di|mi|do|fr|sa|so)\.?,?\s*/i, '') };
    }
  }
  // 22.10. (ohne Jahr) – nur wenn danach kein weiterer Ziffernblock folgt (sonst ist es ein Betrag)
  if ((m = line.match(/(?:^|\s)(\d{1,2})\.(\d{1,2})\.(?=\s|$)/))) {
    if (Number(m[2]) >= 1 && Number(m[2]) <= 12) return { date: fixYear(cy, Number(m[2]), Number(m[1])), rest: line.replace(m[0], ' ') };
  }
  const t = line.trim().toLowerCase().replace(/[,.:]$/, '');
  if (t === 'heute') return { date: todayIso, rest: '' };
  if (t === 'gestern') {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return { date: isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate()), rest: '' };
  }
  return null;
}

/** Sucht den CHF-Betrag in der Zeile. Liefert {value, credit, rest} oder null. */
export function findAmountInLine(line) {
  const re = /([+\-−–]\s*)?(CHF\s*)?(\d{1,3}(?:['’   ]\d{3})+|\d+)[.,](\d{2})(?!\d)(\s*CHF)?/g;
  const all = [...line.matchAll(re)];
  if (!all.length) return null;
  // Bevorzugt der Betrag mit «CHF», sonst der letzte (Fremdwährung steht meist davor)
  const m = all.find((x) => x[2] || x[5]) || all[all.length - 1];
  const value = Number(m[3].replace(/\D/g, '') + '.' + m[4]);
  const sign = (m[1] || '').trim();
  let rest = line;
  for (const x of all) rest = rest.replace(x[0], ' ');
  rest = rest.replace(/\b(CHF|EUR|USD|GBP)\b/g, ' ');
  return { value, credit: sign === '+', debit: sign && sign !== '+', rest };
}

const clean = (s) => s.replace(/\s+/g, ' ').replace(/^[\s·•|,;:–-]+|[\s·•|,;:–-]+$/g, '').trim();
const hasLetters = (s) => /[A-Za-zÄÖÜäöüéèà]{2,}/.test(s);

/**
 * Liest kopierten Text einer Transaktionsliste. Erkennt Datumsüberschriften («22. Oktober 2026»),
 * Zeilen mit Datum + Händler + Betrag und Händlernamen, die eine Zeile über dem Betrag stehen.
 * Ausgaben werden positiv, Gutschriften negativ zurückgegeben.
 */
export function parsePastedText(text, today = new Date()) {
  const out = [];
  let curDate = null;
  let buffer = []; // Textzeilen seit der letzten Transaktion (Händler, Kategorie …)
  let place = ''; // Ort aus der Datumszeile («26.10.2026 18:11 Musterdorf»)
  const reset = () => { buffer = []; place = ''; };
  for (const raw of text.split(/\r?\n/)) {
    let line = raw
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // Markdown-Links [Text](url) → Text
      .replace(/^\s*[*\-•]\s+/, '') // Aufzählungszeichen
      .replace(/\t+/g, '  ')
      .trim();
    if (!line) continue;
    // Kartenzeile «••••1234 NAME» beginnt eine neue Transaktion
    if (/^[•*●·]{3,}\s*\d{4}/.test(line)) { reset(); continue; }
    if (NOISE.test(line)) { reset(); continue; }
    const d = findDateInLine(line, today);
    if (d) {
      curDate = d.date;
      line = d.rest.replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ').trim();
      if (!findAmountInLine(line)) {
        // Rest der Datumszeile ist der Ort; der Händler steht davor im Puffer
        if (hasLetters(line) && !STATUS.test(clean(line))) place = clean(line);
        continue;
      }
    }
    const a = findAmountInLine(line);
    // Nur Betrag in Fremdwährung (z.B. «EUR 45.00»): der CHF-Betrag folgt separat → Zeile überspringen
    if (a && /\b(EUR|USD|GBP|THB|IDR|JPY|EGP|AUD|CAD|SEK|NOK|DKK)\b/.test(line) && !/CHF/.test(line)) continue;
    if (a) {
      if (!curDate) { reset(); continue; }
      let label = clean(a.rest);
      if (!hasLetters(label) || STATUS.test(label)) label = buffer.slice(0, 2).join(' – ');
      if (place && !label.toLowerCase().includes(place.toLowerCase())) label = label ? `${label}, ${place}` : place;
      const credit = a.credit || CREDIT.test(label);
      out.push({ date: curDate, text: label, amount: credit ? -a.value : a.value });
      reset();
    } else if (hasLetters(line) && !STATUS.test(clean(line))) {
      buffer.push(clean(line));
      if (buffer.length > 3) buffer.shift();
    }
  }
  return out;
}
