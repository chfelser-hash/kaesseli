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
