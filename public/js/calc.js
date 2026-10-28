// Berechnungen: Ausdrücke, Budgetsummen, Monitoring (Budget vs. Ist pro Monat)

export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export const FREQS = [
  { v: 12, label: 'monatlich' },
  { v: 13, label: '13× (Lohn)' },
  { v: 1, label: 'jährlich' },
  { v: 2, label: 'halbjährlich' },
  { v: 4, label: 'quartalsweise' },
];

/**
 * Wertet einfache Rechenausdrücke sicher aus: 1500+120, 2*7000, (21.4+43.6), 12,50
 * Erlaubt sind Zahlen, + - * / und Klammern. Tausendertrennzeichen (') werden ignoriert.
 */
export function evalExpr(input) {
  if (typeof input === 'number') return input;
  let s = String(input ?? '').trim().replace(/['’\s]/g, '').replace(/^=/, '');
  if (!s) return 0;
  s = s.replace(/(\d),(\d)/g, '$1.$2');
  let i = 0;
  const peek = () => s[i];
  const num = () => {
    const m = /^\d*\.?\d+|^\d+\.?/.exec(s.slice(i));
    if (!m) throw new Error('Zahl erwartet');
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const factor = () => {
    if (peek() === '-') { i++; return -factor(); }
    if (peek() === '+') { i++; return factor(); }
    if (peek() === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') throw new Error(') erwartet');
      i++;
      return v;
    }
    return num();
  };
  const term = () => {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = s[i++];
      const r = factor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const expr = () => {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = s[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  try {
    const v = expr();
    if (i !== s.length || !Number.isFinite(v)) return NaN;
    return v;
  } catch {
    return NaN;
  }
}

const n = (v) => (Number.isFinite(v) ? v : 0);
export const lineValue = (l) => n(evalExpr(l.expr));
export const lineMonthly = (l) => (lineValue(l) * (Number(l.freq) || 12)) / 12;
export const lineYearly = (l) => lineValue(l) * (Number(l.freq) || 12);
export const potMonthly = (p) => p.lines.reduce((a, l) => a + lineMonthly(l), 0);
export const potYearly = (p) => p.lines.reduce((a, l) => a + lineYearly(l), 0);

export function budgetSummary(y) {
  const incomeMonthly = y.income.reduce((a, l) => a + lineMonthly(l), 0);
  const incomeYearly = y.income.reduce((a, l) => a + lineYearly(l), 0);
  // "ohne 13." = nur die regulären 12 Zahlungen eines Monatslohns
  const incomeNo13 = y.income.reduce((a, l) => a + (lineValue(l) * Math.min(Number(l.freq) || 12, 12)) / 12, 0);
  const pots = y.pots.map((p) => ({ key: p.key, name: p.name, color: p.color, monthly: potMonthly(p), yearly: potYearly(p) }));
  const totalMonthly = pots.reduce((a, p) => a + p.monthly, 0);
  const totalYearly = pots.reduce((a, p) => a + p.yearly, 0);
  return {
    incomeMonthly, incomeYearly, incomeNo13, pots, totalMonthly, totalYearly,
    rest: incomeMonthly - totalMonthly,
    restYearly: incomeYearly - totalYearly,
    restNo13: incomeNo13 - totalMonthly,
  };
}

// ---------- Datum ----------
export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const ym = (date) => date.slice(0, 7);
export const shiftMonth = (ymStr, delta) => {
  let [y, m] = ymStr.split('-').map(Number);
  m += delta;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${String(m).padStart(2, '0')}`;
};
export const fmtDate = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '');
export const fmtDateShort = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.` : '');

// ---------- Zahlenformat ----------
const f2 = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const f0 = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 });
export const fmt = (v) => f2.format(n(v));
export const fmt0 = (v) => f0.format(Math.round(n(v)));
export const fmtSigned = (v) => (v > 0.005 ? '+' : '') + fmt0(v);

/**
 * Monitoring eines Topfs für ein Jahr.
 * Für Ausgabentöpfe ist die Differenz Budget − Ist (positiv = unter Budget).
 * Für Spartöpfe ist die Differenz Eingezahlt − Ziel (positiv = mehr gespart).
 * "geplant" sind Buchungen mit Datum in der Zukunft.
 */
export function monitorPot(pot, year, transactions, today = todayStr()) {
  const budget = potMonthly(pot);
  const saving = pot.kind === 'saving';
  const curYear = Number(today.slice(0, 4));
  const curMonth = Number(today.slice(5, 7));
  // Bis zu welchem Monat gilt das Jahr als "gelaufen"?
  const lastRealized = year < curYear ? 12 : year > curYear ? 0 : curMonth;
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, budget, actual: 0, planned: 0, diff: 0, cum: 0, realized: i + 1 <= lastRealized }));
  const byCat = new Map();
  for (const t of transactions) {
    if (t.pot !== pot.key || !t.date.startsWith(year + '-')) continue;
    const m = months[Number(t.date.slice(5, 7)) - 1];
    const planned = t.date > today;
    if (planned) m.planned += t.amount;
    else m.actual += t.amount;
    const c = byCat.get(t.cat || '') || { actual: 0, planned: 0, count: 0 };
    if (planned) c.planned += t.amount;
    else c.actual += t.amount;
    c.count++;
    byCat.set(t.cat || '', c);
  }
  let cum = 0;
  for (const m of months) {
    if (m.realized) {
      m.diff = saving ? m.actual - budget : budget - m.actual;
      cum += m.diff;
      m.cum = cum;
    } else {
      m.diff = null;
      m.cum = null;
    }
  }
  const actualTotal = months.reduce((a, m) => a + m.actual, 0);
  const plannedTotal = months.reduce((a, m) => a + m.planned, 0);
  const budgetToDate = budget * lastRealized;
  const yearly = potYearly(pot);
  const carry = Number(pot.carryover) || 0;
  return {
    pot, months, byCat, budget, yearly, saving, lastRealized,
    actualTotal, plannedTotal,
    cumDiff: lastRealized ? months[lastRealized - 1].cum : 0,
    // Kontostand des Topfs: Übertrag + einbezahltes Budget − Ausgaben (bei Sparen: Übertrag + Einzahlungen)
    balance: saving ? carry + actualTotal : carry + budgetToDate - actualTotal,
    forecast: saving ? carry + actualTotal + plannedTotal : carry + yearly - actualTotal - plannedTotal,
    remainingYear: saving ? yearly - actualTotal - plannedTotal : yearly - actualTotal - plannedTotal,
  };
}

/** Kategorie-Auswertung: Budget pro Zeile vs. Ist */
export function categoryBreakdown(mon) {
  const rows = mon.pot.lines.map((l) => {
    const c = mon.byCat.get(l.name) || { actual: 0, planned: 0, count: 0 };
    return { key: l.name, name: l.name, yearly: lineYearly(l), actual: c.actual, planned: c.planned, count: c.count };
  });
  const known = new Set(mon.pot.lines.map((l) => l.name));
  for (const [cat, c] of mon.byCat) {
    if (!known.has(cat)) rows.push({ key: cat, name: cat || 'Ohne Kategorie', yearly: 0, actual: c.actual, planned: c.planned, count: c.count, unbudgeted: true });
  }
  return rows;
}

/** Einfacher Hash für Duplikat-Erkennung beim Import */
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// ---------- Abrechnungszyklen ----------
/** Aktueller Zeitpunkt als «YYYY-MM-DDTHH:MM» (lokale Zeit) */
export function nowStamp(d = new Date()) {
  return `${todayStr(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export const nowTime = (d = new Date()) => nowStamp(d).slice(11);
export const fmtStamp = (s) => (s ? `${fmtDate(s.slice(0, 10))} ${s.slice(11, 16)}` : '');

/** Liste der Zyklen: abgeschlossene (von vorheriger bis zu dieser Abrechnung) + der offene seit der letzten */
export function cycleList(settlements) {
  const sorted = [...(settlements || [])].sort((a, b) => a.at.localeCompare(b.at));
  const closed = sorted.map((s, i) => ({ id: s.id, from: sorted[i - 1]?.at || null, to: s.at, note: s.note || '' }));
  return { closed: closed.reverse(), open: { id: 'open', from: sorted[sorted.length - 1]?.at || null, to: null }, last: sorted[sorted.length - 1] || null };
}

/**
 * Liegt eine Buchung im Zeitraum (from, to] ? from/to sind «YYYY-MM-DDTHH:MM» oder null (offen).
 * Buchungen ohne Uhrzeit am Starttag zählen nur mit inclFromDay (beim Import; Duplikate werden dort ohnehin erkannt).
 */
export function inPeriod(t, from, to, inclFromDay = false) {
  if (from) {
    const fd = from.slice(0, 10);
    if (t.date < fd) return false;
    if (t.date === fd) {
      if (t.time) { if (`${t.date}T${t.time}` <= from) return false; }
      else if (!inclFromDay) return false;
    }
  }
  if (to) {
    const td = to.slice(0, 10);
    if (t.date > td) return false;
    if (t.date === td && t.time && `${t.date}T${t.time}` > to) return false;
  }
  return true;
}

/**
 * Geldfluss eines Budgetjahres: Was kommt jeden Monat rein, was muss jeden Monat auf die Konten,
 * und was gleicht der 13. Lohn (bzw. andere Einmalzahlungen) aus?
 */
export function cashflow(y) {
  const f = (l) => Number(l.freq) || 12;
  const incomeMonthly = y.income.filter((l) => f(l) >= 12).reduce((a, l) => a + lineValue(l), 0);
  const extras = [];
  for (const l of y.income) {
    const v = lineValue(l);
    if (f(l) > 12) extras.push({ name: `${l.name || 'Lohn'}: ${f(l) - 12 === 1 ? '13.' : f(l) - 12 + ' zusätzliche'} Monatslohn`, amount: v * (f(l) - 12) });
    else if (f(l) < 12) extras.push({ name: l.name || 'Einmalzahlung', amount: v * f(l) });
  }
  const incomeExtra = extras.reduce((a, e) => a + e.amount, 0);
  const pots = y.pots.map((p) => {
    const running = p.lines.filter((l) => f(l) === 12).reduce((a, l) => a + lineValue(l), 0);
    const reserve = p.lines.filter((l) => f(l) !== 12).reduce((a, l) => a + lineYearly(l) / 12, 0);
    return { key: p.key, name: p.name, color: p.color, account: p.account, running, reserve, monthly: running + reserve, yearly: potYearly(p) };
  });
  const outMonthly = pots.reduce((a, p) => a + p.monthly, 0);
  const outYearly = pots.reduce((a, p) => a + p.yearly, 0);
  const monthBalance = incomeMonthly - outMonthly;
  const incomeYearly = incomeMonthly * 12 + incomeExtra;
  // Sparen = Rest am Ende des Abrechnungszyklus; das Budget ist dort das Ziel
  const savingKeys = new Set(y.pots.filter((p) => p.kind === 'saving').map((p) => p.key));
  const spendPots = pots.filter((p) => !savingKeys.has(p.key));
  const savingPots = pots.filter((p) => savingKeys.has(p.key));
  const spendMonthly = spendPots.reduce((a, p) => a + p.monthly, 0);
  const spendYearly = spendPots.reduce((a, p) => a + p.yearly, 0);
  const savingTargetMonthly = savingPots.reduce((a, p) => a + p.monthly, 0);
  const savingTargetYearly = savingPots.reduce((a, p) => a + p.yearly, 0);
  const savingMonthly = incomeMonthly - spendMonthly; // bleibt jeden Monat fürs Sparen
  const savingYearly = savingMonthly * 12 + incomeExtra; // inkl. 13. Lohn
  // Feste Spar-Posten in anderen Töpfen (z.B. Säule 3a in den Fixkosten)
  const fixedSaving = [];
  for (const p of y.pots) {
    if (savingKeys.has(p.key)) continue;
    for (const l of p.lines) if (l.saving) fixedSaving.push({ name: l.name || p.name, pot: p.name, monthly: lineYearly(l) / 12, yearly: lineYearly(l) });
  }
  const fixedSavingYearly = fixedSaving.reduce((a, x) => a + x.yearly, 0);
  for (const p of pots) {
    const src = y.pots.find((x) => x.key === p.key);
    p.savingMonthly = savingKeys.has(p.key) ? 0 : src.lines.filter((l) => l.saving).reduce((a, l) => a + lineYearly(l) / 12, 0);
  }
  return {
    incomeMonthly, extras, incomeExtra, pots, outMonthly, outYearly, monthBalance,
    incomeYearly, yearBalance: incomeYearly - outYearly,
    hasSaving: savingPots.length > 0, savingPots, spendPots, spendMonthly, spendYearly,
    savingTargetMonthly, savingTargetYearly, savingMonthly, savingYearly,
    fixedSaving, fixedSavingYearly,
    totalSavingYearly: Math.max(0, savingYearly) + fixedSavingYearly,
    runningTotal: pots.reduce((a, p) => a + p.running, 0),
    reserveTotal: pots.reduce((a, p) => a + p.reserve, 0),
  };
}
