// Tab «Budget»: Jahresbudget bearbeiten, neues Jahr aus Vorlage erstellen
import { h, toast, modal, confirmDialog, debounce } from '../ui.js';
import { state, api, render, setYear, yearList, reload } from '../app.js';
import { FREQS, evalExpr, lineMonthly, lineYearly, budgetSummary, monitorPot, fmt, fmt0 } from '../calc.js';

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
    h('div', { class: 'budget-layout' },
      h('div', { class: 'budget-main' },
        linesCard('Einkommen', draft.income, { income: true }),
        ...draft.pots.map((p, i) => potCard(p, i)),
        h('button', { class: 'btn block dashed', onclick: addPot }, '+ Topf hinzufügen')
      ),
      summaryCard()
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
function summaryCard() {
  const tbody = h('tbody');
  const foot = h('tfoot');
  calcFns.push(() => {
    const s = budgetSummary(draft);
    tbody.replaceChildren(
      h('tr', { class: 'income' }, h('th', null, 'Einkommen'), h('td', { class: 'num' }, fmt0(s.incomeMonthly)), h('td', { class: 'num' }, fmt0(s.incomeYearly))),
      ...s.pots.map((p) => h('tr', { style: { '--c': p.color } }, h('th', null, h('span', { class: 'dot' }), p.name), h('td', { class: 'num' }, fmt0(p.monthly)), h('td', { class: 'num' }, fmt0(p.yearly))))
    );
    foot.replaceChildren(
      h('tr', null, h('th', null, 'Total Ausgaben'), h('td', { class: 'num' }, fmt0(s.totalMonthly)), h('td', { class: 'num' }, fmt0(s.totalYearly))),
      h('tr', { class: 'rest ' + (s.rest < 0 ? 'neg' : 'pos') }, h('th', null, 'Rest'), h('td', { class: 'num' }, fmt0(s.rest)), h('td', { class: 'num' }, fmt0(s.restYearly))),
      h('tr', { class: 'rest ' + (s.restNo13 < 0 ? 'neg' : 'pos') }, h('th', null, 'Rest ohne 13.'), h('td', { class: 'num' }, fmt0(s.restNo13)), h('td'))
    );
  });
  return h('aside', { class: 'card summary' },
    h('h2', null, 'Zusammenfassung'),
    h('table', { class: 'sum-table' }, h('thead', null, h('tr', null, h('th'), h('th', { class: 'num' }, 'Monat'), h('th', { class: 'num' }, 'Jahr'))), tbody, foot),
    h('p', { class: 'hint' }, 'Beträge dürfen Rechnungen sein (z.B. 1500+120 oder 2*7000). «13×» verteilt einen 13. Monatslohn aufs Jahr.')
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
