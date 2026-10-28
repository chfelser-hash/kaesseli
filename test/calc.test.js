import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalExpr, budgetSummary, monitorPot, inPeriod, cycleList } from '../public/js/calc.js';
import { parseCsv, guessMapping, applyMapping, parseAmount, parseDate } from '../public/js/csv.js';

test('Rechenausdrücke', () => {
  assert.equal(evalExpr('1500+120'), 1620);
  assert.equal(evalExpr('=2*7000'), 14000);
  assert.equal(evalExpr('(21.4+43.6)'), 65);
  assert.equal(evalExpr("1'500"), 1500);
  assert.equal(evalExpr('12,50'), 12.5);
  assert.ok(Number.isNaN(evalExpr('abc')));
  assert.ok(Number.isNaN(evalExpr('2+')));
});

const year = {
  income: [{ name: 'Lohn', expr: '1200', freq: 13 }],
  pots: [
    { key: 'h', name: 'Haushalt', kind: 'expense', carryover: 0, lines: [{ name: 'H', expr: '100', freq: 12 }] },
    { key: 's', name: 'Steuern', kind: 'expense', carryover: 0, lines: [{ name: 'S', expr: '1200', freq: 1 }] },
    { key: 'p', name: 'Sparen', kind: 'saving', carryover: 0, lines: [{ name: 'P', expr: '50', freq: 12 }] },
  ],
};

test('Budget-Zusammenfassung', () => {
  const s = budgetSummary(year);
  assert.equal(s.incomeMonthly, 1300);
  assert.equal(s.incomeNo13, 1200);
  assert.equal(s.totalMonthly, 250);
  assert.equal(s.rest, 1050);
});

test('Monitoring mit geplanten Buchungen', () => {
  const tx = [
    { date: '2026-01-10', amount: 150, pot: 'h' },
    { date: '2026-02-10', amount: 50, pot: 'h' },
    { date: '2026-12-01', amount: 999, pot: 'h' },
    { date: '2026-02-01', amount: 80, pot: 'p' },
  ];
  const m = monitorPot(year.pots[0], 2026, tx, '2026-02-28');
  assert.equal(m.months[0].diff, -50);
  assert.equal(m.months[1].cum, 0);
  assert.equal(m.plannedTotal, 999);
  assert.equal(m.months[2].diff, null);
  const p = monitorPot(year.pots[2], 2026, tx, '2026-02-28');
  assert.equal(p.cumDiff, -50 + 30);
});

test('CSV PostFinance-ähnlich (getrennte Spalten, Kopfzeilen davor)', () => {
  const csv = 'Datum von:;01.10.2026\nKonto:;CH00 0000\n\nDatum;Avisierungstext;Gutschrift in CHF;Lastschrift in CHF;Label;Kategorie\n02.10.2026;"Kauf/Dienstleistung vom 01.10.2026 COOP-1234 ZÜRICH";;-45.20;;\n03.10.2026;LOHN;4000.00;;;\n';
  const { rows } = parseCsv(csv);
  const map = guessMapping(rows);
  assert.equal(rows[map.header][0], 'Datum');
  assert.equal(map.mode, 'split');
  const items = applyMapping(rows, map);
  assert.equal(items.length, 2);
  assert.equal(items[0].amount, 45.2);
  assert.equal(items[1].amount, -4000);
  assert.equal(items[0].date, '2026-10-02');
});

test('CSV Kreditkarte (eine Betragsspalte, Ausgaben positiv)', () => {
  const csv = 'Transaktionsdatum,Beschreibung,Betrag\n2026-10-01,MIGROS ZUERICH,23.50\n2026-10-03,GUTSCHRIFT,-10.00\n2026-10-05,SBB,12.00\n';
  const { rows, delimiter } = parseCsv(csv);
  assert.equal(delimiter, ',');
  const map = guessMapping(rows);
  assert.equal(map.mode, 'single');
  assert.equal(map.expenseNegative, false);
  const items = applyMapping(rows, map);
  assert.deepEqual(items.map((i) => i.amount), [23.5, -10, 12]);
});

test('Beträge und Daten', () => {
  assert.equal(parseAmount("1'234.50"), 1234.5);
  assert.equal(parseAmount('1.234,50'), 1234.5);
  assert.equal(parseAmount('12.00-'), -12);
  assert.equal(parseDate('5.3.26'), '2026-03-05');
});

import { parsePastedText } from '../public/js/csv.js';

test('Eingefügter Text: Datumsüberschriften, Händler über Betrag, Gutschrift', () => {
  const today = new Date(2026, 9, 28);
  const txt = [
    'Verfügbarer Saldo', 'CHF 4\'321.10',
    'Mittwoch, 22. Oktober 2026',
    'Coop Pronto Zürich', 'Lebensmittel', 'CHF 23.50',
    'SBB CFF FFS\tReisen\tCHF 1\'204.00',
    '21. Okt.',
    'Amazon Marketplace', 'Ausstehend', 'EUR 45.00', 'CHF 43.20',
    'Gutschrift Migros', '+ CHF 10.00',
    '15.10.2026 Shell Tankstelle 86.50',
  ].join('\n');
  const r = parsePastedText(txt, today);
  assert.deepEqual(r.map((x) => [x.date, x.amount]), [
    ['2026-10-22', 23.5], ['2026-10-22', 1204], ['2026-10-21', 43.2], ['2026-10-21', -10], ['2026-10-15', 86.5],
  ]);
  assert.equal(r[0].text, 'Coop Pronto Zürich – Lebensmittel');
  assert.ok(r[1].text.startsWith('SBB CFF FFS'));
  assert.equal(r[2].text, 'Amazon Marketplace');
});

test('Eingefügter Text: Format Viseca One (Karte, Händler, Datum+Ort, Betrag)', () => {
  // Frei erfundene Beispieldaten im Aufbau der Viseca-One-Liste
  const today = new Date(2026, 9, 28);
  const txt = `Transaktionen
Alle KartenVisa **** 1111 CHF Person AVisa **** 2222 CHF Person B
Betrag
von
bis
Oktober
[••••2222PERSON B](https://example.com/1)
[Laden Alpha](https://example.com/1)
[27.10.2026 07:41](https://example.com/1)
12.30  CHF
[Ihre Zahlung - Danke](https://example.com/2)
[26.10.2026](https://example.com/2)
[+ 1'000.00  CHF](https://example.com/2)
[••••2222PERSON B](https://example.com/3)
[Laden Beta](https://example.com/3)
[26.10.2026 18:11 Musterdorf](https://example.com/3)
[45.60  CHF](https://example.com/3)
••••1111PERSON A
onlineshop.example
24.10.2026 09:06
50.00  CHF52.00  EUR
* 1
* 2
Hinweis:
Der Devisenkurs ist provisorisch.`;
  const r = parsePastedText(txt, today);
  assert.deepEqual(r.map((x) => [x.date, x.text, x.amount]), [
    ['2026-10-27', 'Laden Alpha', 12.3],
    ['2026-10-26', 'Ihre Zahlung - Danke', -1000],
    ['2026-10-26', 'Laden Beta, Musterdorf', 45.6],
    ['2026-10-24', 'onlineshop.example', 50],
  ]);
});

test('Eingefügter Text: Viseca ohne Punkte vor der Karte, mit TRX-Nummern', () => {
  const today = new Date(2026, 9, 28);
  const txt = `Alle KartenVisa **** 1111 CHF Anna MusterVisa **** 2222 CHF Beat Muster
Oktober
1111ANNA MUSTER
TRX2026102600001234567
Laden Gamma
TRX2026102600001234567
24.10.2026 13:52 Musterdorf
TRX2026102600001234567
7.30  CHF
2222
BEAT MUSTER
Laden Delta
23.10.2026 19:25
19.80  CHF`;
  const r = parsePastedText(txt, today);
  assert.deepEqual(r.map((x) => [x.date, x.text, x.amount]), [
    ['2026-10-24', 'Laden Gamma, Musterdorf', 7.3],
    ['2026-10-23', 'Laden Delta', 19.8],
  ]);
});

test('Abrechnungszyklen und Uhrzeit-Abgrenzung', () => {
  const st = [{ id: 'a', at: '2026-10-20T08:15' }, { id: 'b', at: '2026-11-26T09:40' }];
  const c = cycleList(st);
  assert.equal(c.closed[0].from, '2026-10-20T08:15');
  assert.equal(c.closed[0].to, '2026-11-26T09:40');
  assert.equal(c.open.from, '2026-11-26T09:40');
  const { from, to } = c.closed[0];
  assert.equal(inPeriod({ date: '2026-10-20', time: '08:00' }, from, to), false); // vor der vorherigen Abrechnung
  assert.equal(inPeriod({ date: '2026-10-20', time: '13:52' }, from, to), true);
  assert.equal(inPeriod({ date: '2026-11-26', time: '09:39' }, from, to), true);
  assert.equal(inPeriod({ date: '2026-11-26', time: '09:41' }, from, to), false); // gehört in den nächsten Zyklus
  assert.equal(inPeriod({ date: '2026-10-20' }, from, to), false); // ohne Uhrzeit am Starttag: Anzeige nein
  assert.equal(inPeriod({ date: '2026-10-20' }, from, to, true), true); // Import ja (Duplikate werden erkannt)
  assert.equal(inPeriod({ date: '2026-11-26' }, from, to), true);
});

test('Eingefügter Text übernimmt die Uhrzeit', () => {
  const r = parsePastedText('Laden Epsilon\n24.10.2026 13:52 Musterdorf\n7.30  CHF\nLaden Zeta\n23.10.2026\n5.00 CHF', new Date(2026, 9, 28));
  assert.deepEqual(r.map((x) => [x.date, x.time]), [['2026-10-24', '13:52'], ['2026-10-23', '']]);
});
