// Tab «Budget»: Jahresbudget bearbeiten, neues Jahr aus Vorlage erstellen
import { h, toast, modal, confirmDialog, debounce } from '../ui.js';
import { state, api, render, setYear, yearList, reload } from '../app.js';
import { FREQS, evalExpr, lineMonthly, lineYearly, cashflow, monitorPot, fmt, fmt0 } from '../calc.js';

let draft = null; // Arbeitskopie des Jahres
let draftYear = null;
let draftRev = null;
let calcFns = [];
let saveState = 'saved';
let statusEl;

const rid = () => Math.random().toString(36).slice(2, 10);

function ensureDraft() {
  if (draft && draftYear === state.year && (saveState !== 'saved' || draftRev === state.data.rev)) return;
  draft = structuredClone(state.data.years[state.year]);
  draftYear = state.year;
  draftRev = state.data.rev;
}

const persist = debounce(async () => {
  setStatus('saving');
  try {
    const res = await api('PUT', '/api/budget/' + draftYear, draft);
    state.data.years[draftYear] = res.year;
    draftRev = state.data.rev;
    setStatus('saved');
  } catch (e) {
    setStatus('error');
    toast(e.message, { error: true });
  }
}, 700);

function setStatus(s) {
  saveState = s;
  state.busy = s !== 'saved';
  if (statusEl) {
    statusEl.textContent = { saving: 'Speichert …', saved: 'Gespeichert ✓', dirty: 'Änderungen …', error: 'Nicht gespeichert!' }[s];
    statusEl.className = 'save-status ' + s;
  }
}

function changed() {
  setStatus('dirty');
  recompute();
  persist();
}

function recompute() {
  for (const fn of calcFns) fn();
}

export function renderBudget() {
  const root = h('div', { class: 'view budget' });
  if (!state.data.years[state.year]) {
    root.append(h('section', { class: 'card' }, h('p', null, 'Noch kein Budget vorhanden.'), newYearButton()));
    return root;
  }
  ensureDraft();
  calcFns = [];
  statusEl = h('span', { class: 'save-status' });
  setStatus(saveState === 'error' ? 'error' : saveState === 'saved' ? 'saved' : saveState);

  root.append(
    h('div', { class: 'budget-toolbar' },
      h('h1', null, `Budget ${state.year}`),
      statusEl,
      h('div', { class: 'spacer' }),
      newYearButton(),
      h('button', { class: 'btn ghost', onclick: deleteYear }, 'Jahr löschen')
    ),
    summaryCard(),
    h('div', { class: 'budget-main' },
      linesCard('Einkommen', draft.income, { income: true }),
      ...draft.pots.map((p, i) => potCard(p, i)),
      h('button', { class: 'btn block dashed', onclick: addPot }, '+ Topf hinzufügen')
    )
  );
  recompute();
  return root;
}

// ---------- Zeilen (Einkommen oder Budgetposten) ----------
function linesCard(title, lines, opts = {}) {
  const body = h('tbody');
  const rebuild = () => {
    body.replaceChildren(...lines.map((l, i) => lineRow(l, i, lines, rebuild, opts)));
    recompute();
  };
  rebuild();
  const totalM = h('span');
  const totalY = h('span');
  calcFns.push(() => {
    totalM.textContent = fmt(lines.reduce((a, l) => a + lineMonthly(l), 0));
    totalY.textContent = fmt(lines.reduce((a, l) => a + lineYearly(l), 0));
  });
  const table = h('table', { class: 'lines' },
    h('thead', null, h('tr', null, h('th', null, 'Posten'), h('th', null, 'Betrag'), h('th', null, 'Rhythmus'), h('th', { class: 'num' }, 'pro Monat'), h('th', { class: 'num' }, 'pro Jahr'), h('th'))),
    body,
    h('tfoot', null, h('tr', null, h('th', null, 'Total'), h('td'), h('td'), h('td', { class: 'num' }, totalM), h('td', { class: 'num' }, totalY), h('td')))
  );
  const add = h('button', { class: 'link', onclick: () => { lines.push({ id: rid(), name: '', expr: '0', freq: 12 }); rebuild(); changed(); body.lastChild?.querySelector('input')?.focus(); } }, '+ Posten');
  if (opts.embed) return h('div', null, h('div', { class: 'table-scroll' }, table), add);
  return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, title)), h('div', { class: 'table-scroll' }, table), add);
}

function lineRow(l, i, lines, rebuild, opts) {
  const m = h('td', { class: 'num' });
  const y = h('td', { class: 'num' });
  const exprInput = h('input', {
    class: 'expr', value: l.expr, inputmode: 'decimal', 'aria-label': 'Betrag oder Rechnung',
    oninput: (e) => { l.expr = e.target.value; changed(); },
  });
  calcFns.push(() => {
    m.textContent = fmt(lineMonthly(l));
    y.textContent = fmt(lineYearly(l));
    exprInput.classList.toggle('invalid', !Number.isFinite(evalExpr(l.expr)));
    exprInput.title = Number.isFinite(evalExpr(l.expr)) ? '= ' + fmt(evalExpr(l.expr)) : 'Ungültige Rechnung';
  });
  let oldName = l.name;
  return h('tr', null,
    h('td', null, h('input', {
      value: l.name, placeholder: 'Bezeichnung', 'aria-label': 'Bezeichnung',
      onfocus: () => (oldName = l.name),
      oninput: (e) => { l.name = e.target.value; changed(); },
      onchange: () => opts.pot && renameCategory(opts.pot, oldName, l.name),
    })),
    h('td', null, exprInput),
    h('td', null, h('select', { 'aria-label': 'Rhythmus', onchange: (e) => { l.freq = Number(e.target.value); changed(); } },
      FREQS.filter((f) => opts.income || f.v !== 13).map((f) => h('option', { value: f.v, selected: f.v === Number(l.freq) }, f.label)))),
    m, y,
    h('td', { class: 'row-actions' },
      h('button', { class: 'icon-btn sm', title: 'Nach oben', disabled: i === 0, onclick: () => { [lines[i - 1], lines[i]] = [lines[i], lines[i - 1]]; rebuild(); changed(); } }, '↑'),
      h('button', { class: 'icon-btn sm', title: 'Entfernen', onclick: () => { lines.splice(i, 1); rebuild(); changed(); } }, '✕')
    )
  );
}

async function renameCategory(pot, from, to) {
  if (!from || from === to) return;
  const used = state.data.transactions.some((t) => t.pot === pot.key && t.cat === from && t.date.startsWith(draftYear + '-'));
  if (!used) return;
  if (!(await confirmDialog('Kategorie umbenennen', `Sollen die bestehenden Buchungen ${draftYear} von «${from}» auf «${to}» umgestellt werden?`, 'Umstellen'))) return;
  try {
    const r = await api('POST', '/api/tx/rename-cat', { year: draftYear, pot: pot.key, from, to });
    for (const t of state.data.transactions) if (t.pot === pot.key && t.cat === from && t.date.startsWith(draftYear + '-')) t.cat = to;
    toast(`${r.count} Buchungen umgestellt`);
  } catch (e) {
    toast(e.message, { error: true });
  }
}

// ---------- Töpfe ----------
function potCard(p, idx) {
  const sum = h('span', { class: 'pot-sum' });
  calcFns.push(() => {
    const mo = p.lines.reduce((a, l) => a + lineMonthly(l), 0);
    sum.textContent = `${fmt0(mo)} / Monat`;
  });
  const move = (d) => {
    const j = idx + d;
    if (j < 0 || j >= draft.pots.length) return;
    [draft.pots[idx], draft.pots[j]] = [draft.pots[j], draft.pots[idx]];
    changed();
    render();
  };
  return h('section', { class: 'card pot-edit', style: { '--c': p.color } },
    h('div', { class: 'pot-edit-head' },
      h('input', { type: 'color', value: p.color, 'aria-label': 'Farbe', oninput: (e) => { p.color = e.target.value; e.target.closest('.pot-edit').style.setProperty('--c', p.color); changed(); } }),
      h('input', { class: 'pot-name', value: p.name, 'aria-label': 'Name des Topfs', oninput: (e) => { p.name = e.target.value; changed(); } }),
      sum,
      h('div', { class: 'row-actions' },
        h('button', { class: 'icon-btn sm', title: 'Nach oben', disabled: idx === 0, onclick: () => move(-1) }, '↑'),
        h('button', { class: 'icon-btn sm', title: 'Nach unten', disabled: idx === draft.pots.length - 1, onclick: () => move(1) }, '↓'),
        h('button', { class: 'icon-btn sm', title: 'Topf entfernen', onclick: () => removePot(idx) }, '✕')
      )
    ),
    h('div', { class: 'pot-opts' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: p.tracked, onchange: (e) => { p.tracked = e.target.checked; changed(); } }), ' Ausgaben erfassen & überwachen'),
      h('label', null, 'Art ', h('select', { onchange: (e) => { p.kind = e.target.value; changed(); } },
        h('option', { value: 'expense', selected: p.kind !== 'saving' }, 'Ausgaben'),
        h('option', { value: 'saving', selected: p.kind === 'saving' }, 'Sparziel'))),
      h('label', null, 'Konto ', h('input', { class: 'short', value: p.account, oninput: (e) => { p.account = e.target.value; changed(); } })),
      h('label', { title: 'Saldo aus dem Vorjahr (z.B. Ferienkonto)' }, 'Übertrag ', h('input', { class: 'short num', inputmode: 'decimal', value: p.carryover || 0, oninput: (e) => { p.carryover = evalExpr(e.target.value) || 0; changed(); } }))
    ),
    linesCard('', p.lines, { embed: true, pot: p })
  );
}

function addPot() {
  const key = 'topf-' + rid();
  draft.pots.push({ key, name: 'Neuer Topf', account: '', color: '#475569', tracked: true, kind: 'expense', carryover: 0, lines: [{ id: rid(), name: 'Neuer Posten', expr: '0', freq: 12 }] });
  changed();
  render();
}

async function removePot(idx) {
  const p = draft.pots[idx];
  const n = state.data.transactions.filter((t) => t.pot === p.key && t.date.startsWith(draftYear + '-')).length;
  const msg = n ? `Achtung: ${n} Buchungen ${draftYear} gehören zu «${p.name}». Sie bleiben erhalten, erscheinen aber nicht mehr in der Übersicht.` : `«${p.name}» entfernen?`;
  if (!(await confirmDialog('Topf entfernen', msg, 'Entfernen', true))) return;
  draft.pots.splice(idx, 1);
  changed();
  render();
}

// ---------- Zusammenfassung ----------
/** «Geht das Budget auf?» – Monat, Einmalzahlungen (13. Lohn), ganzes Jahr + Überweisungen pro Topf */
function summaryCard() {
  const verdict = h('div', { class: 'verdict' });
  const steps = h('div', { class: 'flow-steps' });
  const tbody = h('tbody');
  const tfoot = h('tfoot');
  const signed = (v) => (v > 0.5 ? '+' : v < -0.5 ? '−' : '') + fmt0(Math.abs(v));
  const row = (label, value, cls = '') => h('div', { class: 'flow-row ' + cls }, h('span', null, label), h('span', { class: 'num' }, signed(value)));
  const step = (title, sub, rows, result) => h('section', { class: 'flow-step' }, h('h3', null, title), h('p', { class: 'hint' }, sub), rows, result);

  calcFns.push(() => {
    const c = cashflow(draft);
    const mb = c.monthBalance, yb = c.yearBalance;
    // Fazit in einem Satz
    let cls, text;
    if (yb < -0.5) { cls = 'bad'; text = `Geht nicht auf: Übers Jahr fehlen ${fmt0(-yb)}.`; }
    else if (mb < -0.5 && c.incomeExtra > 0) { cls = 'warn'; text = `Geht auf – aber nur dank ${c.extras.every((e) => e.name.includes('13.')) ? 'dem 13. Lohn' : 'den Einmalzahlungen'}: Jeden Monat fehlen ${fmt0(-mb)}, übers Jahr bleiben ${fmt0(yb)}.`; }
    else if (mb < -0.5) { cls = 'bad'; text = `Jeden Monat fehlen ${fmt0(-mb)}.`; }
    else { cls = 'good'; text = `Geht auf: Jeden Monat bleiben ${fmt0(mb)}, übers Jahr ${fmt0(yb)}.`; }
    verdict.className = 'verdict ' + cls;
    verdict.replaceChildren(h('span', { class: 'verdict-icon' }, cls === 'good' ? '✓' : cls === 'warn' ? '!' : '✕'), h('span', null, text));

    steps.replaceChildren(
      step('1 · Jeden Monat', 'Lohn, der jeden Monat kommt, gegen alles, was jeden Monat auf die Konten muss.', [
        row('Lohn', c.incomeMonthly, 'in'),
        row('Überweisungen auf die Konten', -c.outMonthly, 'out'),
      ], row(mb < 0 ? 'fehlen pro Monat' : 'bleiben pro Monat', mb, 'result ' + (mb < -0.5 ? 'neg' : 'pos'))),
      step('2 · Einmal im Jahr', c.extras.length ? 'Zusätzliche Zahlungen gleichen die Monate aus.' : 'Keine Einmalzahlungen budgetiert.', [
        ...c.extras.map((e) => row(e.name, e.amount, 'in')),
        row(mb < 0 ? '12 Monate Fehlbetrag' : '12 Monate Überschuss', mb * 12, mb < 0 ? 'out' : 'in'),
      ], row('bleiben nach Ausgleich', yb, 'result ' + (yb < -0.5 ? 'neg' : 'pos'))),
      step('3 · Ganzes Jahr', 'Kontrolle: Jahreseinkommen gegen alle Jahresausgaben.', [
        row('Einkommen im Jahr', c.incomeYearly, 'in'),
        row('Ausgaben im Jahr', -c.outYearly, 'out'),
      ], row(yb < 0 ? 'fehlen im Jahr' : `Reserve im Jahr${c.incomeYearly ? ` (${Math.round((yb / c.incomeYearly) * 1000) / 10} %)` : ''}`, yb, 'result ' + (yb < -0.5 ? 'neg' : 'pos')))
    );

    tbody.replaceChildren(...c.pots.map((p) => h('tr', { style: { '--c': p.color } },
      h('th', null, h('span', { class: 'dot' }), p.name, p.account ? h('small', { class: 'muted' }, ' → ' + p.account) : null),
      h('td', { class: 'num' }, p.running ? fmt0(p.running) : '–'),
      h('td', { class: 'num' }, p.reserve ? fmt0(p.reserve) : '–'),
      h('td', { class: 'num strong' }, fmt0(p.monthly)),
      h('td', { class: 'num muted' }, fmt0(p.yearly)))));
    tfoot.replaceChildren(h('tr', null, h('th', null, 'Total'), h('td', { class: 'num' }, fmt0(c.runningTotal)), h('td', { class: 'num' }, fmt0(c.reserveTotal)), h('td', { class: 'num' }, fmt0(c.outMonthly)), h('td', { class: 'num' }, fmt0(c.outYearly))));
  });

  return h('section', { class: 'card summary' },
    h('div', { class: 'card-head' }, h('h2', null, 'Geht das Budget auf?')),
    verdict,
    steps,
    h('details', { class: 'transfers', open: true },
      h('summary', null, 'Monatliche Überweisungen pro Topf'),
      h('div', { class: 'table-scroll' },
        h('table', { class: 'sum-table' },
          h('thead', null, h('tr', null, h('th', null, 'Topf → Konto'), h('th', { class: 'num', title: 'Monatliche Posten' }, 'laufend'), h('th', { class: 'num', title: 'Jährliche/halbjährliche Rechnungen ÷ 12' }, '+ Rückstellung'), h('th', { class: 'num' }, '= pro Monat'), h('th', { class: 'num' }, 'pro Jahr'))),
          tbody, tfoot)),
      h('p', { class: 'hint' }, '«Rückstellung» = jährliche Rechnungen (z.B. Steuern, Krankenkasse, Serafe) geteilt durch 12. So viel muss jeden Monat aufs Konto, damit die Rechnung bei Fälligkeit gedeckt ist.')),
    h('p', { class: 'hint' }, 'Beträge dürfen Rechnungen sein (z.B. 1500+120 oder 2*7000). Beim Lohn bedeutet «13×»: 12 Monatslöhne plus ein 13. Lohn einmal im Jahr.')
  );
}

// ---------- Jahre ----------
function newYearButton() {
  return h('button', { class: 'btn primary', onclick: newYearDialog }, '+ Neues Jahr');
}

async function newYearDialog() {
  const years = yearList();
  const next = (years[years.length - 1] || new Date().getFullYear() - 1) + 1;
  const f = { year: next, from: years.includes(state.year) ? state.year : years[years.length - 1] || '' };
  const carryWrap = h('div');
  const carry = {};
  const fillCarry = () => {
    const src = state.data.years[f.from];
    carryWrap.replaceChildren();
    if (!src) return;
    const pots = src.pots.filter((p) => p.tracked && p.kind !== 'saving');
    carryWrap.append(
      h('p', { class: 'hint' }, 'Übertrag = voraussichtlicher Saldo Ende Jahr (inkl. geplanter Ausgaben). Kann angepasst werden.'),
      h('div', { class: 'form-grid' }, pots.map((p) => {
        const mon = monitorPot(p, Number(f.from), state.data.transactions);
        carry[p.key] = Math.round(mon.forecast);
        return h('label', null, `Übertrag ${p.name}`, h('input', { inputmode: 'decimal', value: carry[p.key], oninput: (e) => (carry[p.key] = evalExpr(e.target.value) || 0) }));
      }))
    );
  };
  fillCarry();
  const body = h('div', null,
    h('div', { class: 'form-grid' },
      h('label', null, 'Jahr', h('input', { type: 'number', value: f.year, min: 2000, max: 2100, oninput: (e) => (f.year = Number(e.target.value)) })),
      h('label', null, 'Vorlage', h('select', { onchange: (e) => { f.from = e.target.value; fillCarry(); } },
        years.map((y) => h('option', { value: y, selected: y === f.from }, `Budget ${y} kopieren`)),
        h('option', { value: '' }, 'Leere Vorlage')))
    ),
    carryWrap
  );
  const ok = await modal('Neues Budgetjahr', body, [
    { label: 'Abbrechen', value: false },
    { label: 'Erstellen', primary: true, value: true },
  ]);
  if (!ok) return;
  try {
    await api('POST', `/api/budget/${f.year}/create`, { from: f.from || null, carryover: f.from ? carry : null });
    await reload();
    draft = null;
    setYear(f.year);
    location.hash = 'budget';
    toast(`Budget ${f.year} erstellt`);
  } catch (e) {
    toast(e.message, { error: true });
  }
}

async function deleteYear() {
  const n = state.data.transactions.filter((t) => t.date.startsWith(state.year + '-')).length;
  const ok = await confirmDialog(`Budget ${state.year} löschen?`, `Das Budget wird gelöscht. ${n} Buchungen bleiben erhalten, werden aber ohne Budget nicht mehr ausgewertet.`, 'Löschen', true);
  if (!ok) return;
  await api('DELETE', '/api/budget/' + state.year);
  await reload();
  draft = null;
  render();
}
