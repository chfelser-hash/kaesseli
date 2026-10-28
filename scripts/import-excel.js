#!/usr/bin/env node
// Übernimmt Budget und Ausgaben eines Jahres aus der bisherigen Excel-Datei.
//
//   npm run import-excel -- "C:\Pfad\budget.xlsx" [--jahr 2026] [--out import.json]
//
// Ergebnis ist eine Sicherungsdatei, die du in der App unter «Mehr → Sicherung einspielen»
// hochlädst. Die Datei enthält deine persönlichen Daten – NICHT ins Git-Repo einchecken!
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { readXlsx, colName } from './xlsx-reader.js';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!file) {
  console.error('Aufruf: npm run import-excel -- <datei.xlsx> [--jahr 2026] [--out import.json]');
  process.exit(1);
}

const sheets = readXlsx(file);
const budgetYears = Object.keys(sheets).map((n) => n.match(/^Budget_(\d{4})$/)?.[1]).filter(Boolean).map(Number).sort();
const year = Number(opt('--jahr')) || budgetYears.filter((y) => sheets[`Monitoring ${y}`]).pop() || budgetYears.pop();
if (!year || !sheets[`Budget_${year}`]) {
  console.error('Kein Blatt «Budget_<Jahr>» gefunden. Vorhanden: ' + Object.keys(sheets).join(', '));
  process.exit(1);
}
const out = opt('--out') || `budget-import-${year}.json`;
const id = () => crypto.randomBytes(6).toString('base64url');
const pad = (n) => String(n).padStart(2, '0');
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round2 = (v) => Math.round(v * 100) / 100;
const simpleExpr = (f) => (f && /^[\d.+\-*/() ]+$/.test(f) ? f.replace(/\s/g, '') : null);
const today = new Date();
const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
const warnings = [];

// ---------- 1. Budget ----------
const B = sheets[`Budget_${year}`];

/** Ermittelt Ausdruck und Rhythmus einer Budgetzeile aus Spalte B (Monat) / C (Jahr). */
function lineFromRow(r) {
  const bf = B.formula('B' + r), cf = B.formula('C' + r);
  const bv = B.value('B' + r), cv = B.value('C' + r);
  const bIsF = B.isFormula('B' + r), cIsF = B.isFormula('C' + r);
  // Monatsbetrag ist aus dem Jahresbetrag gerechnet (=C23/12, auch als geteilte Formel) → jährlicher Posten
  const yearly = (bf && /^C\d+\/12$/.test(bf.replace(/\s/g, ''))) || (bIsF && !simpleExpr(bf) && (!cIsF || simpleExpr(cf)));
  if (yearly && isNum(cv)) return { expr: simpleExpr(cf) || String(round2(cv)), freq: 1 };
  if (isNum(bv)) return { expr: simpleExpr(bf) || String(round2(bv)), freq: 12 };
  if (isNum(cv)) return { expr: simpleExpr(cf) || String(round2(cv)), freq: 1 };
  return null;
}

const SECTIONS = [
  { test: /monatlich/i, key: 'fix', name: 'Fixkosten', account: 'Rechnungskonto', color: '#64748b', tracked: false },
  { test: /steuer/i, key: 'steuern', name: 'Steuern', account: 'Steuerkonto', color: '#7c3aed', tracked: true },
  { test: /sporadisch/i, key: 'sporadisch', name: 'Sporadisch', account: 'Rückstellung & KPT', color: '#c2410c', tracked: true },
  { test: /sparen/i, key: 'sparen', name: 'Sparen', account: 'Sparkonto', color: '#15803d', tracked: true, kind: 'saving' },
  { test: /ferien/i, key: 'ferien', name: 'Ferien', account: 'Ferienkonto', color: '#0369a1', tracked: true },
  { test: /spassgeld/i, key: 'spassgeld', name: 'Spassgeld', account: 'Privat', color: '#be185d', tracked: false },
];
const pots = new Map();
const haushalt = { key: 'haushalt', name: 'Haushalt', account: 'Rechnungskonto', color: '#0e7490', tracked: true, kind: 'expense', carryover: 0, lines: [] };
const income = [];
let section = null;
let incomeMode = false;

for (let r = 1; r <= B.maxRow; r++) {
  const a = B.value('A' + r);
  if (!isText(a)) continue;
  const label = a.trim();
  if (/^total$/i.test(label) && r > 40) break; // Gesamtauswertung am Ende
  if (/^total$/i.test(label)) continue;
  const hasVal = B.value('B' + r) !== null || B.value('C' + r) !== null;
  if (!hasVal) {
    incomeMode = /einkommen/i.test(label);
    const s = SECTIONS.find((x) => x.test.test(label));
    if (s) {
      section = s;
      if (!pots.has(s.key)) pots.set(s.key, { key: s.key, name: s.name, account: s.account, color: s.color, tracked: s.tracked, kind: s.kind || 'expense', carryover: 0, lines: [] });
    }
    continue;
  }
  if (incomeMode) {
    // "Einkommen monatlich" = (Lohn1+Lohn2)*13/12 → zwei Lohnzeilen mit 13 Zahlungen
    if (/ohne 13/i.test(label)) continue;
    const f = (B.formula('B' + r) || '').replace(/\s/g, '');
    const m = f.match(/^\(?([\d.+]+)\)?\*13\/12$/);
    if (m) {
      m[1].split('+').forEach((v, i) => income.push({ id: id(), name: `Lohn ${i + 1}`, expr: v, freq: 13 }));
    } else {
      income.push({ id: id(), name: label, expr: simpleExpr(f) || String(round2(B.value('B' + r))), freq: 12 });
    }
    continue;
  }
  if (!section) continue;
  const line = lineFromRow(r);
  if (!line) continue;
  const entry = { id: id(), name: label, ...line };
  if (section.key === 'fix' && /haushalt/i.test(label)) haushalt.lines.push(entry);
  else pots.get(section.key).lines.push(entry);
}

const potList = [];
if (pots.has('fix')) potList.push(pots.get('fix'));
if (haushalt.lines.length) potList.push(haushalt);
for (const [k, p] of pots) if (k !== 'fix') potList.push(p);

const years = { [year]: { year, income, pots: potList } };

// ---------- 2. Buchungen ----------
const transactions = [];
const addTx = (t) => transactions.push({ id: id(), cat: '', account: '', src: 'excel', by: 'Excel-Import', createdAt: new Date().toISOString(), ...t, amount: round2(t.amount) });

/** Liest Datum aus Bezeichnungen wie «Arzt (27.04)» oder «Energie (programmiert 07.04)» */
function dateFor(name, month, y = year) {
  const m = String(name).match(/(\d{1,2})\.(\d{1,2})\.?\)?/);
  if (m && Number(m[2]) === month) return `${y}-${pad(month)}-${pad(Number(m[1]))}`;
  return `${y}-${pad(month)}-01`;
}

// Kategorie für sporadische Ausgaben anhand von Stichworten ermitteln
const spoPot = potList.find((p) => p.key === 'sporadisch');
const findLine = (needle) => spoPot?.lines.find((l) => l.name.toLowerCase().includes(needle))?.name || '';
const CAT_RULES = [
  [/geschenk|blumen|l[äa]de?r+ach|bouncelab/i, 'geschenk'],
  [/energie|strom/i, 'strom'],
  [/serafe/i, 'serafe'],
  [/verkehrssteuer|verkehrsamt/i, 'verkehrssteuer'],
  [/windrad|winrad/i, 'winrad'],
  [/heilsarmee/i, 'heilsarmee'],
  [/aquamed/i, 'aquamed'],
  [/halbtax|\b[öo]v\b|ga\b/i, 'öv'],
  [/auto ?service|garage|velomech|reifen/i, 'garage'],
  [/autoversicherung/i, 'autoversicherung'],
  [/krankenkasse/i, 'krankenkasse'],
  [/reiseversicherung|ferienversicherung/i, 'ferienversicherung'],
  [/hausrat|baloise/i, 'hausrat'],
  [/arzt|arut|zahn|labor|neurolog|brille|concordia|apotheke/i, 'arzt'],
];
const catFor = (name) => {
  for (const [re, needle] of CAT_RULES) if (re.test(name)) { const c = findLine(needle); if (c) return c; }
  return findLine('anschaffung');
};

function importItemSheet(sheetName, potKey, y, withCat) {
  const S = sheets[sheetName];
  if (!S) return 0;
  let n = 0;
  for (let r = 2; r <= S.maxRow; r++) {
    const name = S.value('A' + r);
    if (!isText(name) || /^total$|^saldovorschau$/i.test(name.trim())) continue;
    for (let c = 2; c <= 13; c++) {
      const v = S.value(colName(c) + r);
      if (!isNum(v) || v === 0) continue;
      const month = c - 1;
      addTx({ date: dateFor(name, month, y), amount: v, pot: potKey, cat: withCat ? catFor(name) : '', note: name.trim() });
      n++;
    }
  }
  return n;
}

const counts = {};
counts.sporadisch = importItemSheet(`Sporadische_Ausgaben_${year}`, 'sporadisch', year, true);
counts.ferien = importItemSheet(`Ferien_${year}`, 'ferien', year, false);
counts.ferienFolgejahr = importItemSheet(`Ferien_${year + 1}`, 'ferien', year + 1, false);

// Monitoring: Haushalt-Monatstotale, Steuerzahlungen, Spar-Einzahlungen
const M = sheets[`Monitoring ${year}`];
if (M) {
  const findRow = (label, after = 0) => {
    for (let r = after + 1; r <= M.maxRow; r++) if (String(M.value('A' + r) || '').trim().toLowerCase() === label) return r;
    return -1;
  };
  const sectionRow = (re) => {
    for (let r = 1; r <= M.maxRow; r++) if (re.test(String(M.value('A' + r) || ''))) return r;
    return -1;
  };
  const stampDate = (s, month) => {
    const m = String(s || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
    if (!m) return null;
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = `${y}-${pad(m[2])}-${pad(m[1])}`;
    return Number(m[2]) === month && y === year ? d : null;
  };
  // Haushalt: erste Sektion (Zeile 2 enthält den Bezeichner aus dem Budget)
  const hhBezug = findRow('bezug');
  counts.haushalt = 0;
  if (hhBezug > 0 && hhBezug < sectionRow(/sporadisch/i)) {
    for (let c = 2; c <= 13; c++) {
      const v = M.value(colName(c) + hhBezug);
      if (!isNum(v) || v === 0) continue;
      const month = c - 1;
      const stamp = stampDate(M.value(colName(c) + (hhBezug - 2)), month);
      let date = stamp || `${year}-${pad(month)}-01`;
      if (date > todayStr) date = todayStr;
      addTx({ date, amount: v, pot: 'haushalt', note: 'Monatstotal Haushalt (aus Excel)' });
      counts.haushalt++;
    }
  }
  const simpleRow = (secRe, label, potKey, note) => {
    const sec = sectionRow(secRe);
    if (sec < 0) return 0;
    const r = findRow(label, sec);
    if (r < 0) return 0;
    let n = 0;
    for (let c = 2; c <= 13; c++) {
      const v = M.value(colName(c) + r);
      if (!isNum(v) || v === 0) continue;
      addTx({ date: `${year}-${pad(c - 1)}-01`, amount: v, pot: potKey, note });
      n++;
    }
    return n;
  };
  counts.steuern = simpleRow(/^steuern$/i, 'effektiv', 'steuern', 'Steuerzahlung (aus Excel)');
  counts.sparen = simpleRow(/^sparen$/i, 'eingezahlt', 'sparen', 'Einzahlung Sparkonto (aus Excel)');

  // Kontrolle: Monatssummen gegen das Excel-Monitoring prüfen
  const check = (secRe, label, potKey) => {
    const sec = sectionRow(secRe);
    const r = findRow(label, sec);
    if (sec < 0 || r < 0) return;
    for (let c = 2; c <= 13; c++) {
      const xl = M.value(colName(c) + r);
      const mine = transactions.filter((t) => t.pot === potKey && t.date.startsWith(`${year}-${pad(c - 1)}`)).reduce((a, t) => a + t.amount, 0);
      if (isNum(xl) && Math.abs(xl - mine) > 0.05) warnings.push(`${potKey} ${colName(c)}: Excel ${xl.toFixed(2)} ≠ Import ${mine.toFixed(2)}`);
    }
  };
  check(/sporadisch/i, 'bezug', 'sporadisch');
  check(/^ferien$/i, 'bezug', 'ferien');
}

// ---------- 3. Ausgabe ----------
const settings = { accounts: ['Kreditkarte', 'Postkonto', 'Bar'], rules: [], importProfiles: [] };
const result = { schema: 1, exportedAt: new Date().toISOString(), source: path.basename(file), years, transactions, settings };
fs.writeFileSync(out, JSON.stringify(result, null, 1));

console.log(`\nBudget ${year} übernommen: ${income.length} Einkommenszeilen, ${potList.length} Töpfe`);
for (const p of potList) console.log(`  · ${p.name.padEnd(12)} ${p.lines.length} Posten${p.tracked ? '' : ' (nicht überwacht)'}`);
console.log(`Buchungen: ${transactions.length}`, counts);
if (warnings.length) {
  console.log('\nAbweichungen zum Excel-Monitoring:');
  for (const w of warnings) console.log('  ! ' + w);
} else {
  console.log('Kontrolle: Monatssummen stimmen mit dem Excel-Monitoring überein ✓');
}
console.log(`\nGespeichert in: ${path.resolve(out)}`);
console.log('→ In der App unter «Mehr → Sicherung einspielen» hochladen.');
console.log('⚠ Die Datei enthält persönliche Daten: nicht ins Git-Repo einchecken.\n');
