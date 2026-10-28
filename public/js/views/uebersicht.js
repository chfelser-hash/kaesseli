// Tab «Übersicht»: Budget vs. Ist pro Topf und Monat (ersetzt das Excel-Monitoring)
import { h, s } from '../ui.js';
import { state, currentYear, go, render } from '../app.js';
import { monitorPot, categoryBreakdown, cashflow, todayStr, fmt, fmt0, fmtSigned, fmtDate, MONTHS_SHORT } from '../calc.js';
import { editTx } from './erfassen.js';

let mode = 'cum'; // 'actual' | 'diff' | 'cum'

export function renderUebersicht() {
  const y = currentYear();
  const today = todayStr();
  const root = h('div', { class: 'view uebersicht' });
  if (!y) return root;
  // Sparen = Rest am Zyklusende: Soll pro Monat ist der erwartete Rest (+ 13. Lohn usw. im Auszahlungsmonat)
  const cf = cashflow(y);
  const targetSum = cf.savingPots.reduce((a, p) => a + p.yearly, 0) || 1;
  const expectedFor = (p) => {
    if (p.kind !== 'saving') return null;
    const share = (cf.savingPots.find((x) => x.key === p.key)?.yearly || 0) / targetSum;
    return { regular: cf.savingMonthly * share, byMonth: cf.savingExpectedByMonth.map((v) => v * share) };
  };
  const mons = y.pots.filter((p) => p.tracked).map((p) => monitorPot(p, state.year, state.data.transactions, today, expectedFor(p)));
  for (const m of mons) if (m.saving) m.fixedSaving = cf.fixedSaving;

  root.append(...[
    h('div', { class: 'cards' }, mons.map(potCard)),
    monitorTable(mons),
    ...mons.filter((m) => m.pot.lines.length > 1).map(categoryCard),
    plannedCard(today)
  ].filter(Boolean));
  return root;
}

function potCard(mon) {
  if (mon.saving) return savingCard(mon);
  const { pot, saving } = mon;
  const cur = mon.lastRealized ? mon.months[mon.lastRealized - 1] : null;
  const good = mon.cumDiff >= 0;
  return h('section', { class: 'card pot-card', style: { '--c': pot.color } },
    h('header', null, h('span', { class: 'dot' }), h('h3', null, pot.name), h('span', { class: 'muted small' }, pot.account)),
    h('div', { class: 'kpis' },
      kpi(saving ? 'Ziel / Mt' : 'Budget / Mt', fmt0(mon.budget)),
      kpi(cur ? 'Ist ' + MONTHS_SHORT[cur.month - 1] : 'Ist', cur ? fmt0(cur.actual) : '–'),
      kpi('Kumuliert',mon.lastRealized ? fmtSigned(mon.cumDiff) : '–', mon.lastRealized ? (good ? 'pos' : 'neg') : ''),
    ),
    sparkline(mon),
    h('button', { class: 'link link-year', onclick: () => go('erfassen', { year: state.year, pot: pot.key }) }, `Alle Buchungen ${state.year} →`),
    h('dl', { class: 'facts' },
      h('dt', null, saving ? 'Gespart dieses Jahr' : 'Ausgegeben dieses Jahr'), h('dd', null, fmt0(mon.actualTotal) + ' / ' + fmt0(mon.yearly)),
      mon.plannedTotal ? [h('dt', null, 'Geplant'), h('dd', null, fmt0(mon.plannedTotal))] : null,
      saving ? null : [h('dt', null, 'Saldo Topf heute'), h('dd', { class: mon.balance < 0 ? 'neg' : '' }, fmt0(mon.balance))],
      h('dt', null, saving ? 'Prognose Jahresende' : 'Prognose Saldo Jahresende'), h('dd', { class: mon.forecast < 0 ? 'neg' : '' }, fmt0(mon.forecast)),
    ),
    pot.carryover ? h('p', { class: 'hint' }, `inkl. Übertrag ${fmt0(pot.carryover)}`) : null
  );
}

/** Sparen: bisher gespart (Sparkonto + feste Spar-Posten wie Säule 3a anteilig), keine Prognose */
function savingCard(mon) {
  const { pot } = mon;
  const cur = mon.lastRealized ? mon.months[mon.lastRealized - 1] : null;
  const fixed = mon.fixedSaving || [];
  const months = mon.lastRealized; // gelaufene Monate des Jahres
  const fixedToDate = fixed.map((x) => ({ ...x, toDate: (x.yearly / 12) * months }));
  const fixedSum = fixedToDate.reduce((a, x) => a + x.toDate, 0);
  const open = mon.target - mon.actualTotal;
  const upTo = months ? MONTHS_SHORT[months - 1] : '';
  return h('section', { class: 'card pot-card', style: { '--c': pot.color } },
    h('header', null, h('span', { class: 'dot' }), h('h3', null, pot.name), h('span', { class: 'muted small' }, pot.account)),
    h('div', { class: 'kpis' },
      kpi('Erwartet / Mt', fmt0(mon.budget)),
      kpi(cur ? 'Ist ' + MONTHS_SHORT[cur.month - 1] : 'Ist', cur ? fmt0(cur.actual) : '–'),
      kpi('Kumuliert', mon.lastRealized ? fmtSigned(mon.cumDiff) : '–', mon.lastRealized ? (mon.cumDiff >= 0 ? 'pos' : 'neg') : ''),
    ),
    sparkline(mon),
    h('button', { class: 'link link-year', onclick: () => go('erfassen', { year: state.year, pot: pot.key }) }, 'Alle Buchungen ' + state.year + ' →'),
    h('dl', { class: 'facts' },
      h('dt', null, 'Sparziel Sparkonto'), h('dd', null, fmt0(mon.target)),
      h('dt', null, 'Eingezahlt Sparkonto'), h('dd', null, fmt0(mon.actualTotal)),
      h('dt', null, open > 0 ? 'noch offen bis Ziel' : 'über dem Ziel'), h('dd', { class: open > 0 ? '' : 'pos' }, fmt0(Math.abs(open))),
      fixed.length ? [h('dt', null, 'Feste Sparposten' + (upTo ? ' bis ' + upTo : ''), h('small', { class: 'muted' }, ' (' + fixed.map((x) => x.name).join(', ') + ', ' + fmt0(fixed.reduce((a, x) => a + x.yearly, 0) / 12) + '/Mt)')), h('dd', null, fmt0(fixedSum))] : null,
      fixed.length ? [h('dt', { class: 'strong' }, 'Total gespart' + (upTo ? ' bis ' + upTo : '')), h('dd', { class: 'strong' }, fmt0(mon.actualTotal + fixedSum))] : null,
    ),
    h('p', { class: 'hint' }, 'Erwartet = was nach den festen Überweisungen jeden Monat übrig bleibt; im Dezember inkl. 13. Lohn.' + (fixed.length ? ' Feste Sparposten = Budgetposten mit Haken «Sparen»; sie werden monatlich zurückgestellt und hier anteilig gezählt.' : ''))
  );
}

const kpi = (label, value, cls = '') => h('div', { class: 'kpi' }, h('span', { class: 'kl' }, label), h('span', { class: 'kv ' + cls }, value));

/** Kleines Balkendiagramm: Ist pro Monat (geplant heller), Budgetlinie gestrichelt */
function sparkline(mon) {
  const W = 300, H = 70, pad = 2;
  const max = Math.max(mon.budget * 1.25, ...mon.months.map((m) => m.actual + m.planned), 1);
  const bw = (W - pad * 2) / 12;
  // Bei Töpfen mit Jahresposten (z.B. Steuern) sind einzelne hohe Monate normal → nicht rot färben
  const monthlyOnly = mon.pot.lines.every((l) => Number(l.freq) >= 12);
  const y = (v) => H - (v / max) * (H - 4);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H + 12}`, class: 'spark', role: 'img', 'aria-label': `Monatsverlauf ${mon.pot.name}` });
  mon.months.forEach((m, i) => {
    const x = pad + i * bw + 2;
    const over = !mon.saving && monthlyOnly && m.actual > mon.budget;
    if (m.actual) svg.append(s('rect', { x, y: y(m.actual), width: bw - 4, height: H - y(m.actual), rx: 2, class: over ? 'b-over' : 'b-act' }, s('title', {}, `${MONTHS_SHORT[i]}: ${fmt(m.actual)}`)));
    if (m.planned) svg.append(s('rect', { x, y: y(m.actual + m.planned), width: bw - 4, height: Math.max(1, y(m.actual) - y(m.actual + m.planned)), rx: 2, class: 'b-plan' }, s('title', {}, `${MONTHS_SHORT[i]} geplant: ${fmt(m.planned)}`)));
    svg.append(s('text', { x: x + (bw - 4) / 2, y: H + 10, class: 'b-lbl' + (m.realized ? '' : ' future') }, MONTHS_SHORT[i][0]));
  });
  svg.append(s('line', { x1: pad, x2: W - pad, y1: y(mon.budget), y2: y(mon.budget), class: 'b-budget' }));
  return svg;
}

function monitorTable(mons) {
  const seg = (id, label) => h('button', { class: 'seg' + (mode === id ? ' on' : ''), onclick: () => { mode = id; render(); } }, label);
  const today = todayStr();
  const cell = (mon, m) => {
    const ym = `${state.year}-${String(m.month).padStart(2, '0')}`;
    let val, cls = '';
    if (mode === 'actual') {
      val = m.actual || m.planned ? fmt0(m.actual + m.planned) : '';
      if (m.planned && !m.actual) cls = 'planned';
    } else {
      const v = mode === 'diff' ? m.diff : m.cum;
      val = v === null ? '' : fmtSigned(v);
      cls = v === null ? '' : v >= 0 ? 'pos' : 'neg';
    }
    return h('td', { class: 'num ' + cls + (ym === today.slice(0, 7) ? ' cur' : '') },
      h('button', { class: 'cell-btn', onclick: () => go('erfassen', { month: ym, pot: mon.pot.key }), title: `${mon.pot.name} ${MONTHS_SHORT[m.month - 1]}: Budget ${fmt(m.budget)}, Ist ${fmt(m.actual)}${m.planned ? ', geplant ' + fmt(m.planned) : ''}` }, val || '·')
    );
  };
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', null, `Monitoring ${state.year}`),
      h('div', { class: 'segs', role: 'tablist' }, seg('actual', 'Ist'), seg('diff', 'Differenz'), seg('cum', 'Kumuliert'))
    ),
    h('p', { class: 'hint' }, mode === 'actual' ? 'Ausgaben bzw. Einzahlungen pro Monat (hell = geplant).' : 'Grün = besser als Budget, Rot = schlechter. Bei «Sparen» ist das Soll der erwartete Rest (Dezember inkl. 13. Lohn); mehr eingezahlt zählt positiv.'),
    h('div', { class: 'table-scroll' },
      h('table', { class: 'monitor' },
        h('thead', null, h('tr', null, h('th', null, ''), MONTHS_SHORT.map((mo) => h('th', { class: 'num' }, mo)), h('th', { class: 'num' }, 'Jahr'))),
        h('tbody', null, mons.map((mon) =>
          h('tr', { style: { '--c': mon.pot.color } },
            h('th', { scope: 'row' }, h('span', { class: 'dot' }), mon.pot.name, h('small', { class: 'muted' }, ' ' + fmt0(mon.budget) + '/Mt')),
            mon.months.map((m) => cell(mon, m)),
            h('td', { class: 'num total ' + (mode === 'actual' ? '' : mon.cumDiff >= 0 ? 'pos' : 'neg') },
              mode === 'actual' ? fmt0(mon.actualTotal + mon.plannedTotal) : mon.lastRealized ? fmtSigned(mon.cumDiff) : '')
          )
        ))
      )
    )
  );
}

function categoryCard(mon) {
  const rows = categoryBreakdown(mon);
  const tot = rows.reduce((a, r) => ({ yearly: a.yearly + r.yearly, actual: a.actual + r.actual, planned: a.planned + r.planned }), { yearly: 0, actual: 0, planned: 0 });
  const rest = (r) => r.yearly - r.actual - r.planned;
  return h('section', { class: 'card', style: { '--c': mon.pot.color } },
    h('div', { class: 'card-head' }, h('h2', null, h('span', { class: 'dot' }), `${mon.pot.name} nach Kategorie`)),
    h('div', { class: 'table-scroll' },
      h('table', { class: 'cats' },
        h('thead', null, h('tr', null, h('th', null, 'Kategorie'), h('th', { class: 'num' }, 'Budget Jahr'), h('th', { class: 'num' }, 'Bisher'), h('th', { class: 'num' }, 'Geplant'), h('th', { class: 'num' }, 'Verbleibend'), h('th', { class: 'bar-col' }, ''), h('th'))),
        h('tbody', null, rows.map((r) => {
          const used = r.yearly > 0 ? (r.actual + r.planned) / r.yearly : r.actual + r.planned > 0 ? 1.01 : 0;
          const open = () => go('erfassen', { year: state.year, pot: mon.pot.key, cat: r.key });
          return h('tr', { class: 'clickable' + (r.unbudgeted ? ' unbudgeted' : ''), title: `Alle Buchungen «${r.name}» ${state.year} anzeigen`, onclick: open },
            h('td', null, h('button', { class: 'link cat-link', onclick: (e) => { e.stopPropagation(); open(); } }, r.name), h('small', { class: 'muted' }, r.count ? ` (${r.count})` : '')),
            h('td', { class: 'num' }, fmt0(r.yearly)),
            h('td', { class: 'num' }, fmt0(r.actual)),
            h('td', { class: 'num muted' }, r.planned ? fmt0(r.planned) : ''),
            h('td', { class: 'num ' + (rest(r) < 0 ? 'neg' : '') }, fmt0(rest(r))),
            h('td', { class: 'bar-col' }, h('span', { class: 'bar' + (used > 1 ? ' over' : '') }, h('span', { style: { width: Math.min(100, used * 100) + '%' } }))),
            h('td', { class: 'go-col' }, '→')
          );
        })),
        h('tfoot', null, h('tr', null, h('th', null, 'Total'), h('td', { class: 'num' }, fmt0(tot.yearly)), h('td', { class: 'num' }, fmt0(tot.actual)), h('td', { class: 'num' }, fmt0(tot.planned)), h('td', { class: 'num ' + (tot.yearly - tot.actual - tot.planned < 0 ? 'neg' : '') }, fmt0(tot.yearly - tot.actual - tot.planned)), h('td'), h('td')))
      )
    )
  );
}

function plannedCard(today) {
  const y = currentYear();
  const pots = new Map(y.pots.map((p) => [p.key, p]));
  const planned = state.data.transactions.filter((t) => t.date > today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 40);
  if (!planned.length) return null;
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Geplante Ausgaben')),
    h('p', { class: 'hint' }, 'Buchungen mit Datum in der Zukunft – z.B. Krankenkasse im Dezember oder Ferien im nächsten Jahr.'),
    h('ul', { class: 'tx-list' }, planned.map((t) => {
      const p = pots.get(t.pot) || state.data.years[t.date.slice(0, 4)]?.pots.find((x) => x.key === t.pot);
      return h('li', null, h('button', { class: 'tx planned', onclick: () => editTx(t) },
        h('span', { class: 'tx-date' }, fmtDate(t.date)),
        h('span', { class: 'tx-main' }, h('span', { class: 'tx-note' }, t.note || t.cat || '–'), h('span', { class: 'tx-meta' }, [p?.name, t.cat].filter(Boolean).join(' · '))),
        h('span', { class: 'tx-amt' }, fmt(t.amount))
      ));
    }))
  );
}
