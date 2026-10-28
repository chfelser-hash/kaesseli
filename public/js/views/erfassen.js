// Tab «Erfassen»: Abrechnungen schnell eintragen und den aktuellen Monat im Blick behalten
import { h, toast, modal, chips, confirmDialog } from '../ui.js';
import { state, api, yearForDate, render } from '../app.js';
import { evalExpr, todayStr, ym, shiftMonth, fmt, fmt0, fmtDateShort, fmtDate, MONTHS, potMonthly, potYearly, lineYearly, nowStamp, nowTime, fmtStamp, cycleList, inPeriod } from '../calc.js';

const LS = 'budget.entry';
const saved = (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } })();

const form = {
  amount: '',
  pot: saved.pot || null,
  cat: '',
  account: saved.account || null,
  date: todayStr(),
  note: '',
  bulk: false,
  bulkText: '',
};
let month = null;
let filterPot = '';
let filterCat = null; // Kategorie-Filter (z.B. «Geschenke»), null = alle
let filterAcc = null; // null = alle, '' = ohne Angabe
let accOpen = true;
// Ansicht: Kalendermonat oder Abrechnungszyklus (offen seit letzter Abrechnung, frühere Zyklen, frei wählbar)
const view = { mode: 'month', sel: 'open', from: '', to: '', year: null };
const lastDay = (ymStr) => { const [yy, mm] = ymStr.split('-').map(Number); return `${ymStr}-${String(new Date(yy, mm, 0).getDate()).padStart(2, '0')}`; };
let search = '';

function remember() {
  try { localStorage.setItem(LS, JSON.stringify({ pot: form.pot, account: form.account })); } catch { /* egal */ }
}

const trackedPots = (date) => (yearForDate(date)?.pots || []).filter((p) => p.tracked);
const allPots = (date) => yearForDate(date)?.pots || [];
const potByKey = (key, date) => allPots(date).find((p) => p.key === key);

export function renderErfassen() {
  const prm = state.params;
  if (prm?.month) { month = prm.month; view.mode = 'month'; filterPot = prm.pot || ''; filterCat = null; filterAcc = null; state.params = null; }
  if (prm?.year) { view.mode = 'year'; view.year = Number(prm.year); filterPot = prm.pot || ''; filterCat = prm.cat ?? null; filterAcc = null; search = ''; state.params = null; }
  if (!month) month = ym(todayStr());
  const pots = trackedPots(form.date);
  if (!pots.find((p) => p.key === form.pot)) form.pot = pots[0]?.key || null;
  if (!form.account) form.account = state.data.settings.accounts[0] || '';

  const root = h('div', { class: 'view erfassen' });
  root.append(h('div', { class: 'cols' }, h('div', { class: 'col-form' }, entryCard()), h('div', { class: 'col-list' }, monthPanel())));
  return root;
}

// ---------- Eingabeformular ----------
function entryCard() {
  const card = h('section', { class: 'card entry', 'aria-label': 'Neue Ausgabe' });
  const pots = trackedPots(form.date);

  const preview = h('span', { class: 'amount-preview' });
  const amount = h('input', {
    class: 'amount-input',
    inputmode: 'decimal',
    autocomplete: 'off',
    placeholder: '0.00',
    'aria-label': 'Betrag in CHF',
    value: form.amount,
    oninput: (e) => {
      form.amount = e.target.value;
      state.busy = !!form.amount;
      updatePreview();
    },
  });
  const updatePreview = () => {
    const v = evalExpr(form.amount);
    preview.textContent = /[+\-*/(]/.test(form.amount.replace(/^-/, '')) && Number.isFinite(v) ? '= ' + fmt(v) : '';
    amount.classList.toggle('invalid', !!form.amount && !Number.isFinite(v));
  };
  updatePreview();

  // Kategorie hängt vom Topf ab
  const catWrap = h('div', { class: 'field cat-field' });
  const renderCats = () => {
    const pot = potByKey(form.pot, form.date);
    const lines = pot?.lines || [];
    if (lines.length < 2) {
      form.cat = lines[0]?.name || '';
      catWrap.replaceChildren();
      catWrap.hidden = true;
      return;
    }
    if (!lines.some((l) => l.name === form.cat)) form.cat = '';
    catWrap.hidden = false;
    catWrap.replaceChildren(
      h('span', { class: 'label' }, 'Kategorie'),
      chips([{ value: '', label: '–' }, ...lines.map((l) => ({ value: l.name, label: l.name }))], form.cat, (v) => (form.cat = v), 'small')
    );
  };

  const potChips = chips(pots.map((p) => ({ value: p.key, label: p.name, color: p.color })), form.pot, (v) => {
    form.pot = v;
    form.cat = '';
    remember();
    renderCats();
  }, 'pots');

  const accChips = chips(state.data.settings.accounts.map((a) => ({ value: a, label: a })), form.account, (v) => { form.account = v; remember(); }, 'small');

  const date = h('input', { type: 'date', value: form.date, required: true, onchange: (e) => { form.date = e.target.value || todayStr(); dateHint(); } });
  const dateHint = () => {
    const future = form.date > todayStr();
    dateInfo.textContent = future ? 'liegt in der Zukunft → wird als «geplant» gezählt' : '';
  };
  const dateInfo = h('span', { class: 'hint' });
  const setDate = (d) => { form.date = d; date.value = d; dateHint(); };
  const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return todayStr(d); };

  // Notiz mit Vorschlägen aus bisherigen Buchungen
  const notes = recentNotes();
  const dl = h('datalist', { id: 'notes-dl' }, notes.map((n) => h('option', { value: n })));
  const note = h('input', {
    list: 'notes-dl', value: form.note, placeholder: 'z.B. Coop, Zahnarzt, Geschenk …', autocomplete: 'off',
    oninput: (e) => { form.note = e.target.value; },
    onchange: (e) => applyNoteMemory(e.target.value, potChips, accChips, renderCats),
  });

  const bulkArea = h('textarea', {
    rows: 8, value: form.bulkText,
    placeholder: 'Ein Betrag pro Zeile, optional mit Text:\n21.70 Coop\n5\n39 Migros\n86.50 Tankstelle',
    oninput: (e) => { form.bulkText = e.target.value; state.busy = !!form.bulkText; bulkInfo(); },
  });
  const bulkSum = h('span', { class: 'hint' });
  const bulkInfo = () => {
    const rows = parseBulk(form.bulkText);
    const bad = rows.filter((r) => !Number.isFinite(r.amount)).length;
    bulkSum.textContent = rows.length ? `${rows.length} Beträge · Total CHF ${fmt(rows.reduce((a, r) => a + (Number.isFinite(r.amount) ? r.amount : 0), 0))}${bad ? ` · ${bad} unlesbar` : ''}` : '';
  };
  bulkInfo();

  const submit = async (e) => {
    e?.preventDefault();
    if (!form.pot) return toast('Bitte zuerst im Budget einen Topf anlegen', { error: true });
    let list;
    if (form.bulk) {
      const rows = parseBulk(form.bulkText);
      if (!rows.length) return toast('Keine Beträge erfasst', { error: true });
      if (rows.some((r) => !Number.isFinite(r.amount))) return toast('Mindestens eine Zeile ist unlesbar', { error: true });
      list = rows.map((r) => ({ amount: r.amount, note: r.text || form.note, pot: form.pot, cat: form.cat, account: form.account, date: form.date, time: entryTime() }));
    } else {
      const v = evalExpr(form.amount);
      if (!form.amount || !Number.isFinite(v)) { amount.focus(); return toast('Betrag fehlt oder ist ungültig', { error: true }); }
      list = [{ amount: v, note: form.note, pot: form.pot, cat: form.cat, account: form.account, date: form.date, time: entryTime() }];
    }
    try {
      const res = await api('POST', '/api/tx', list);
      state.data.transactions.push(...res.created);
      const total = res.created.reduce((a, t) => a + t.amount, 0);
      const pot = potByKey(form.pot, form.date);
      toast(`${res.created.length > 1 ? res.created.length + ' Buchungen' : 'Gespeichert'}: CHF ${fmt(total)} → ${pot?.name}`, {
        action: { label: 'Rückgängig', fn: () => undo(res.created.map((t) => t.id)) },
      });
      form.amount = '';
      form.note = '';
      form.bulkText = '';
      state.busy = false;
      if (view.mode === 'month') month = ym(form.date);
      render();
      setTimeout(() => document.querySelector(form.bulk ? '.entry textarea' : '.amount-input')?.focus(), 0);
    } catch (ex) {
      toast(ex.message, { error: true });
    }
  };

  renderCats();
  dateHint();

  card.append(
    h('form', { onsubmit: submit, autocomplete: 'off' },
      h('div', { class: 'entry-head' },
        h('h2', null, form.bulk ? 'Sammelerfassung' : 'Ausgabe erfassen'),
        h('button', { type: 'button', class: 'link', onclick: () => { form.bulk = !form.bulk; render(); } }, form.bulk ? 'Einzeln erfassen' : 'Mehrere Beträge auf einmal')
      ),
      form.bulk
        ? h('div', { class: 'field' }, bulkArea, bulkSum)
        : h('div', { class: 'amount-row' }, h('span', { class: 'cur' }, 'CHF'), amount, preview),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Topf'), potChips),
      catWrap,
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Bezahlt mit'), accChips),
      h('div', { class: 'field row' },
        h('label', { class: 'grow' }, h('span', { class: 'label' }, 'Datum'), date),
        h('div', { class: 'quick-dates' },
          h('button', { type: 'button', class: 'chip', onclick: () => setDate(todayStr()) }, 'Heute'),
          h('button', { type: 'button', class: 'chip', onclick: () => setDate(yesterday()) }, 'Gestern')
        )
      ),
      dateInfo,
      h('label', { class: 'field' }, h('span', { class: 'label' }, form.bulk ? 'Notiz für Zeilen ohne Text' : 'Notiz'), note, dl),
      h('button', { class: 'btn primary block big', type: 'submit' }, form.bulk ? 'Alle speichern' : 'Speichern'),
      h('p', { class: 'hint center' }, 'Tipp: Beträge dürfen gerechnet werden, z.B. 1500+120')
    )
  );

  if (matchMedia('(pointer:fine)').matches) setTimeout(() => (form.bulk ? bulkArea : amount).focus(), 0);
  return card;
}

// Heute erfasste Ausgaben bekommen die aktuelle Uhrzeit (wichtig für die Abgrenzung zur Abrechnung)
const entryTime = () => (form.date === todayStr() ? nowTime() : '');

function parseBulk(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    let m = l.match(/^(-?[\d'’.,]+(?:\s*[+\-*/]\s*[\d'’.,]+)*)\s*(.*)$/);
    if (m) return { amount: evalExpr(m[1]), text: m[2].trim() };
    m = l.match(/^(.*?)\s+(-?[\d'’.,]+)$/);
    if (m) return { amount: evalExpr(m[2]), text: m[1].trim() };
    return { amount: NaN, text: l };
  });
}

function recentNotes() {
  const seen = new Set();
  const out = [];
  const tx = [...state.data.transactions].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  for (const t of tx) {
    if (t.note && !seen.has(t.note)) {
      seen.add(t.note);
      out.push(t.note);
      if (out.length > 300) break;
    }
  }
  return out;
}

/** Wurde dieser Text schon einmal verwendet, übernehmen wir Topf, Kategorie und Konto. */
function applyNoteMemory(text, potChips, accChips, renderCats) {
  if (!text) return;
  const last = [...state.data.transactions].reverse().find((t) => t.note === text);
  if (!last) return;
  if (potByKey(last.pot, form.date)?.tracked) {
    form.pot = last.pot;
    potChips.setValue(last.pot);
    form.cat = last.cat || '';
    renderCats();
  }
  if (last.account && state.data.settings.accounts.includes(last.account)) {
    form.account = last.account;
    accChips.setValue(last.account);
  }
}

async function undo(ids) {
  try {
    await api('POST', '/api/tx/delete', { ids });
    const set = new Set(ids);
    state.data.transactions = state.data.transactions.filter((t) => !set.has(t.id));
    render();
    toast('Rückgängig gemacht');
  } catch (e) {
    toast(e.message, { error: true });
  }
}

// ---------- Monatsübersicht & Liste ----------
function monthPanel() {
  const today = todayStr();
  const isRange = view.mode === 'cycle';
  const isYear = view.mode === 'year';
  if (!view.year) view.year = Number(month.slice(0, 4));
  const cyc = cycleList(state.data.settlements);
  // Zeitraum bestimmen
  let from, to, pFrom = null, pTo = null, inclFrom = false, periodLabel = '';
  if (isYear) {
    from = `${view.year}-01-01`;
    to = `${view.year}-12-31`;
  } else if (!isRange) {
    from = month + '-01';
    to = lastDay(month);
  } else if (view.sel === 'custom') {
    if (!view.from) { view.from = cyc.last ? cyc.last.at.slice(0, 10) : month + '-01'; view.to = today; }
    from = view.from; to = view.to; pFrom = from; pTo = to + 'T23:59'; inclFrom = true;
    periodLabel = `${fmtDate(from)} – ${fmtDate(to)}`;
  } else {
    const c = view.sel === 'open' ? cyc.open : cyc.closed.find((x) => x.id === view.sel) || cyc.open;
    if (c === cyc.open) view.sel = 'open';
    pFrom = c.from; pTo = c.to;
    from = c.from ? c.from.slice(0, 10) : '0000-01-01';
    to = c.to ? c.to.slice(0, 10) : '9999-12-31';
    periodLabel = `${c.from ? fmtStamp(c.from) : 'Beginn'} – ${c.to ? fmtStamp(c.to) : 'heute'}`;
  }
  const [y, m] = month.split('-').map(Number);
  // Töpfe aus allen Budgetjahren im Zeitraum (gleicher Schlüssel = gleicher Topf)
  const potMap = new Map();
  const y0 = Math.max(Number(from.slice(0, 4)), 2000), y1 = Math.min(Number(to.slice(0, 4)), Number(today.slice(0, 4)) + 2);
  for (let yy = y0; yy <= y1; yy++) {
    for (const p of state.data.years[yy]?.pots || []) if (!potMap.has(p.key)) potMap.set(p.key, p);
  }
  if (!potMap.size) for (const p of state.data.years[isYear ? view.year : y]?.pots || []) potMap.set(p.key, p);
  const yearBudget = { pots: [...potMap.values()] };
  const pots = yearBudget.pots.filter((p) => p.tracked);
  const txMonth = isRange
    ? state.data.transactions.filter((t) => inPeriod(t, pFrom, pTo, inclFrom))
    : state.data.transactions.filter((t) => t.date >= from && t.date <= to);

  const sumBy = (key, planned = null) => txMonth.filter((t) => t.pot === key && (planned === null || (t.date > today) === planned)).reduce((a, t) => a + t.amount, 0);

  const modeSegs = h('div', { class: 'segs', role: 'tablist' },
    h('button', { class: 'seg' + (view.mode === 'month' ? ' on' : ''), onclick: () => { view.mode = 'month'; render(); } }, 'Monat'),
    h('button', { class: 'seg' + (isRange ? ' on' : ''), onclick: () => { view.mode = 'cycle'; render(); } }, 'Abrechnung'),
    h('button', { class: 'seg' + (isYear ? ' on' : ''), onclick: () => { view.mode = 'year'; view.year = Number(month.slice(0, 4)); render(); } }, 'Jahr')
  );
  const settleBtn = h('button', { class: 'btn primary settle-btn', onclick: settleNow, title: 'Abrechnungszeitpunkt speichern' }, 'Jetzt abrechnen');
  const setCustom = (f, t) => {
    if (!f || !t) return;
    if (f > t) [f, t] = [t, f];
    view.from = f;
    view.to = t;
    render();
  };
  const cycleSelect = h('select', { class: 'cycle-select', 'aria-label': 'Abrechnungszyklus', onchange: (e) => { view.sel = e.target.value; if (view.sel === 'custom') { view.from = ''; } render(); } },
    h('option', { value: 'open', selected: view.sel === 'open' }, cyc.last ? `Seit letzter Abrechnung (${fmtStamp(cyc.last.at)})` : 'Seit Beginn (noch keine Abrechnung)'),
    cyc.closed.map((c) => h('option', { value: c.id, selected: view.sel === c.id }, `Abrechnung ${fmtStamp(c.to)}${c.from ? ` (ab ${fmtStamp(c.from)})` : ''}`)),
    h('option', { value: 'custom', selected: view.sel === 'custom' }, 'Zeitraum frei wählen …')
  );
  const head = isRange
    ? h('div', { class: 'month-head range' },
      modeSegs,
      cycleSelect,
      view.sel === 'custom' ? [
        h('label', null, 'von', h('input', { type: 'date', value: from, onchange: (e) => setCustom(e.target.value, to) })),
        h('label', null, 'bis', h('input', { type: 'date', value: to, onchange: (e) => setCustom(from, e.target.value) }))] : null,
      h('div', { class: 'spacer' }),
      settleBtn)
    : isYear ? h('div', { class: 'month-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Vorheriges Jahr', onclick: () => { view.year--; render(); } }, '‹'),
      h('h2', null, `Jahr ${view.year}`),
      h('button', { class: 'icon-btn', 'aria-label': 'Nächstes Jahr', onclick: () => { view.year++; render(); } }, '›'),
      view.year !== Number(today.slice(0, 4)) ? h('button', { class: 'link', onclick: () => { view.year = Number(today.slice(0, 4)); render(); } }, 'Heute') : null,
      h('div', { class: 'spacer' }),
      modeSegs)
    : h('div', { class: 'month-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Vorheriger Monat', onclick: () => { month = shiftMonth(month, -1); render(); } }, '‹'),
      h('h2', null, `${MONTHS[m - 1]} ${y}`),
      h('button', { class: 'icon-btn', 'aria-label': 'Nächster Monat', onclick: () => { month = shiftMonth(month, 1); render(); } }, '›'),
      month !== ym(today) ? h('button', { class: 'link', onclick: () => { month = ym(today); render(); } }, 'Heute') : null,
      h('div', { class: 'spacer' }),
      modeSegs
    );

  // Im Zeitraum-Modus gibt es kein Monatsbudget → Kacheln zeigen nur die Summe
  const rangeTiles = h('div', { class: 'pot-tiles' },
    pots.map((p) => {
      const n = txMonth.filter((t) => t.pot === p.key).length;
      return h('button', {
        class: 'pot-tile' + (filterPot === p.key ? ' on' : ''),
        style: { '--c': p.color },
        onclick: () => { filterPot = filterPot === p.key ? '' : p.key; filterCat = null; render(); },
        title: 'Liste nach diesem Topf filtern',
      },
        h('span', { class: 'pt-name' }, p.name),
        h('span', { class: 'pt-val' }, fmt0(sumBy(p.key))),
        h('span', { class: 'pt-rest' }, n === 1 ? '1 Buchung' : `${n} Buchungen`)
      );
    })
  );

  const tiles = h('div', { class: 'pot-tiles' },
    pots.map((p) => {
      // Jahresansicht: bisher ausgegeben vs. Jahresbudget (geplante Ausgaben separat)
      const actual = isYear ? sumBy(p.key, false) : sumBy(p.key);
      const planned = isYear ? sumBy(p.key, true) : 0;
      const budget = isYear ? potYearly(p) : potMonthly(p);
      const ratio = budget > 0 ? actual / budget : 0;
      const saving = p.kind === 'saving';
      const over = !saving && ratio > 1;
      return h('button', {
        class: 'pot-tile' + (filterPot === p.key ? ' on' : '') + (over ? ' over' : ''),
        style: { '--c': p.color },
        onclick: () => { filterPot = filterPot === p.key ? '' : p.key; filterCat = null; render(); },
        title: 'Liste nach diesem Topf filtern',
      },
        h('span', { class: 'pt-name' }, p.name),
        h('span', { class: 'pt-val' }, fmt0(actual), h('small', null, ' / ' + fmt0(budget))),
        h('span', { class: 'bar' + (over ? ' over' : '') }, h('span', { style: { width: Math.min(100, ratio * 100) + '%' } })),
        h('span', { class: 'pt-rest' }, saving
          ? (actual >= budget ? 'Ziel erreicht' : `noch ${fmt0(budget - actual)} einzahlen`)
          : (over ? `${fmt0(actual - budget)} über Budget` : `${fmt0(budget - actual)} übrig`) + (planned ? ` · ${fmt0(planned)} geplant` : ''))
      );
    })
  );

  const searchInput = h('input', {
    type: 'search', placeholder: 'Suchen …', value: search, 'aria-label': 'Buchungen durchsuchen',
    oninput: (e) => { search = e.target.value; listWrap.replaceChildren(list()); },
  });

  const list = () => {
    let rows = txMonth;
    if (filterPot) rows = rows.filter((t) => t.pot === filterPot);
    if (filterCat !== null) rows = rows.filter((t) => (t.cat || '') === filterCat);
    if (filterAcc !== null) rows = rows.filter((t) => (t.account || '') === filterAcc);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((t) => `${t.note} ${t.cat} ${t.account} ${fmt(t.amount)}`.toLowerCase().includes(q));
    }
    rows = [...rows].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
    if (!rows.length) return h('p', { class: 'empty' }, txMonth.length ? 'Keine Treffer.' : isRange ? 'Keine Buchungen in diesem Zeitraum.' : isYear ? 'Keine Buchungen in diesem Jahr.' : 'Noch keine Buchungen in diesem Monat.');

    const groups = filterPot ? [[filterPot, rows]] : pots.map((p) => [p.key, rows.filter((t) => t.pot === p.key)]).filter(([, r]) => r.length);
    // Buchungen in Töpfen, die (nicht mehr) getrackt sind
    if (!filterPot) {
      const known = new Set(pots.map((p) => p.key));
      const other = rows.filter((t) => !known.has(t.pot));
      if (other.length) groups.push(['__other', other]);
    }
    return h('div', null, groups.map(([key, items]) => {
      const pot = (yearBudget?.pots || []).find((p) => p.key === key);
      const sum = items.reduce((a, t) => a + t.amount, 0);
      return h('section', { class: 'tx-group' },
        h('header', { style: { '--c': pot?.color || '#888' } }, h('span', { class: 'dot' }), h('strong', null, pot?.name || 'Andere'), h('span', { class: 'sum' }, fmt(sum))),
        h('ul', { class: 'tx-list' }, items.map((t) =>
          h('li', null, h('button', { class: 'tx' + (t.date > today ? ' planned' : ''), onclick: () => editTx(t) },
            h('span', { class: 'tx-date' }, fmtDateShort(t.date), isRange && t.time ? h('small', null, t.time) : null),
            h('span', { class: 'tx-main' },
              h('span', { class: 'tx-note' }, t.note || t.cat || pot?.name || '–'),
              h('span', { class: 'tx-meta' }, [t.note && t.cat ? t.cat : null, t.account, t.date > today ? 'geplant' : null].filter(Boolean).join(' · '))
            ),
            h('span', { class: 'tx-amt' + (t.amount < 0 ? ' neg' : '') }, fmt(t.amount))
          ))
        ))
      );
    }));
  };
  const listWrap = h('div', { class: 'tx-wrap' }, list());

  return h('section', { class: 'card month' },
    head,
    pots.length ? (isRange ? rangeTiles : tiles) : h('p', { class: 'empty' }, isRange ? 'Für diesen Zeitraum gibt es kein Budget.' : `Für ${isYear ? view.year : y} gibt es noch kein Budget. Lege es im Tab «Budget» an.`),
    isYear && filterPot && filterCat !== null ? catSummary(txMonth, potMap.get(filterPot), filterCat, today) : null,
    isRange ? h('p', { class: 'hint period' }, `${periodLabel} · ${txMonth.length === 1 ? '1 Buchung' : txMonth.length + ' Buchungen'} · Total CHF ${fmt(txMonth.reduce((a, t) => a + t.amount, 0))}`) : null,
    accountTable(txMonth, yearBudget),
    h('div', { class: 'list-tools' }, searchInput,
      filterPot || filterAcc !== null || filterCat !== null ? h('button', { class: 'chip on', onclick: () => { filterPot = ''; filterAcc = null; filterCat = null; render(); } },
        filterCat !== null ? `${filterCat || 'Ohne Kategorie'} ✕` : 'Filter ✕') : null),
    listWrap
  );
}

/** Jahresübersicht einer Kategorie: Budget, bisher, geplant, verbleibend */
function catSummary(tx, pot, cat, today) {
  const rows = tx.filter((t) => t.pot === pot?.key && (t.cat || '') === cat);
  const done = rows.filter((t) => t.date <= today).reduce((a, t) => a + t.amount, 0);
  const planned = rows.filter((t) => t.date > today).reduce((a, t) => a + t.amount, 0);
  const line = pot?.lines.find((l) => l.name === cat);
  const budget = line ? lineYearly(line) : 0;
  const rest = budget - done - planned;
  return h('div', { class: 'cat-summary', style: { '--c': pot?.color || '#888' } },
    h('strong', null, `${pot?.name || ''} · ${cat || 'Ohne Kategorie'}`),
    h('span', null, `Budget ${fmt0(budget)}`),
    h('span', null, `bisher ${fmt0(done)}`),
    planned ? h('span', null, `geplant ${fmt0(planned)}`) : null,
    h('span', { class: rest < 0 ? 'neg' : 'pos' }, `${rest < 0 ? 'überzogen' : 'verbleibend'} ${fmt0(Math.abs(rest))}`));
}

// ---------- Abrechnen ----------
/** Speichert den Abrechnungszeitpunkt (Standard: jetzt, anpassbar zum Nachtragen). */
export async function settleNow() {
  const cyc = cycleList(state.data.settlements);
  let at = nowStamp();
  let note = '';
  const ok = await modal('Abrechnung speichern', h('div', null,
    h('p', null, cyc.last ? `Letzte Abrechnung: ${fmtStamp(cyc.last.at)}` : 'Noch keine Abrechnung gespeichert.'),
    h('div', { class: 'form-grid' },
      h('label', null, 'Zeitpunkt', h('input', { type: 'datetime-local', value: at, oninput: (e) => (at = e.target.value.slice(0, 16)) })),
      h('label', null, 'Notiz (optional)', h('input', { placeholder: 'z.B. Monatsabrechnung November', oninput: (e) => (note = e.target.value) }))),
    h('p', { class: 'hint' }, 'Danach Kreditkarte und Post importieren: Der Import berücksichtigt nur Buchungen zwischen der vorherigen und dieser Abrechnung.')
  ), [{ label: 'Abbrechen', value: false }, { label: 'Abrechnung speichern', primary: true, value: true }]);
  if (!ok) return;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) return toast('Zeitpunkt ungültig', { error: true });
  try {
    const res = await api('POST', '/api/settlements', { at, note });
    state.data.settlements.push(res.settlement);
    // Abgeschlossenen Zyklus anzeigen
    view.mode = 'cycle';
    view.sel = res.settlement.id;
    render();
    toast(`Abrechnung ${fmtStamp(at)} gespeichert`, { action: { label: 'Zum Import', fn: () => (location.hash = 'import') }, duration: 8000 });
  } catch (e) {
    toast(e.message, { error: true });
  }
}

// ---------- Auswertung nach Zahlungsmittel ----------
/** Wie viel wurde im Monat mit welchem Zahlungsmittel bezahlt – aufgeteilt nach Topf. */
function accountTable(txMonth, yearBudget) {
  if (!txMonth.length) return null;
  const potList = yearBudget?.pots || [];
  const potKeys = [...new Set(txMonth.map((t) => t.pot))];
  const cols = [...potList.filter((p) => potKeys.includes(p.key)), ...potKeys.filter((k) => !potList.some((p) => p.key === k)).map((k) => ({ key: k, name: 'Andere', color: '#888' }))];
  const accs = [...new Set([...state.data.settings.accounts, ...txMonth.map((t) => t.account || '')])].filter((a) => txMonth.some((t) => (t.account || '') === a));
  const sum = (acc, pot) => txMonth.filter((t) => (acc === undefined || (t.account || '') === acc) && (pot === undefined || t.pot === pot)).reduce((a, t) => a + t.amount, 0);
  const cell = (v) => h('td', { class: 'num' + (v ? '' : ' muted') }, v ? fmt(v) : '–');
  const det = h('details', { class: 'acc-sum', open: accOpen, ontoggle: () => (accOpen = det.open) },
    h('summary', null, 'Nach Zahlungsmittel'),
    h('div', { class: 'table-scroll' },
      h('table', { class: 'acc-table' },
        h('thead', null, h('tr', null, h('th', null, ''), cols.map((c) => h('th', { class: 'num', style: { '--c': c.color } }, h('span', { class: 'dot' }), c.name)), h('th', { class: 'num' }, 'Total'))),
        h('tbody', null, accs.map((a) =>
          h('tr', { class: 'clickable' + (filterAcc === a ? ' on' : ''), title: 'Liste nach diesem Zahlungsmittel filtern', onclick: () => { filterAcc = filterAcc === a ? null : a; render(); } },
            h('th', { scope: 'row' }, a || 'ohne Angabe'),
            cols.map((c) => cell(sum(a, c.key))),
            h('td', { class: 'num total' }, fmt(sum(a)))
          ))),
        h('tfoot', null, h('tr', null, h('th', null, 'Total'), cols.map((c) => h('td', { class: 'num' }, fmt(sum(undefined, c.key)))), h('td', { class: 'num' }, fmt(sum()))))
      )
    )
  );
  return det;
}

// ---------- Bearbeiten ----------
export async function editTx(t) {
  const f = { ...t, amountStr: String(t.amount) };
  const pots = allPots(t.date);
  const catSel = h('select');
  const fillCats = () => {
    const pot = pots.find((p) => p.key === f.pot);
    const names = (pot?.lines || []).map((l) => l.name);
    if (f.cat && !names.includes(f.cat)) names.push(f.cat);
    catSel.replaceChildren(h('option', { value: '' }, '–'), ...names.map((n) => h('option', { value: n, selected: n === f.cat }, n)));
  };
  catSel.onchange = (e) => (f.cat = e.target.value);
  fillCats();
  const accounts = [...new Set([...state.data.settings.accounts, t.account].filter(Boolean))];
  const body = h('div', { class: 'form-grid' },
    h('label', null, 'Betrag (CHF)', h('input', { inputmode: 'decimal', value: f.amountStr, oninput: (e) => (f.amountStr = e.target.value) })),
    h('label', null, 'Datum', h('input', { type: 'date', value: f.date, oninput: (e) => (f.date = e.target.value) })),
    h('label', null, 'Uhrzeit (optional)', h('input', { type: 'time', value: f.time || '', oninput: (e) => (f.time = e.target.value) })),
    h('label', null, 'Topf', h('select', { onchange: (e) => { f.pot = e.target.value; f.cat = ''; fillCats(); } },
      pots.map((p) => h('option', { value: p.key, selected: p.key === f.pot }, p.name + (p.tracked ? '' : ' (nicht getrackt)'))))),
    h('label', null, 'Kategorie', catSel),
    h('label', null, 'Bezahlt mit', h('select', { onchange: (e) => (f.account = e.target.value) },
      h('option', { value: '' }, '–'), accounts.map((a) => h('option', { value: a, selected: a === f.account }, a)))),
    h('label', { class: 'span2' }, 'Notiz', h('input', { value: f.note, oninput: (e) => (f.note = e.target.value) })),
    h('p', { class: 'hint span2' }, `Erfasst von ${t.by || '?'}${t.src ? ' · importiert' : ''}`)
  );
  await modal('Buchung bearbeiten', body, [
    {
      label: 'Löschen', danger: true,
      onClick: async () => {
        if (!(await confirmDialog('Buchung löschen?', `CHF ${fmt(t.amount)} – ${t.note || ''}`, 'Löschen', true))) return false;
        await api('DELETE', '/api/tx/' + t.id);
        state.data.transactions = state.data.transactions.filter((x) => x.id !== t.id);
        render();
        toast('Gelöscht');
      },
    },
    { label: 'Abbrechen' },
    {
      label: 'Speichern', primary: true,
      onClick: async () => {
        const amount = evalExpr(f.amountStr);
        if (!Number.isFinite(amount)) { toast('Betrag ungültig', { error: true }); return false; }
        try {
          const res = await api('PUT', '/api/tx/' + t.id, { ...f, amount });
          const i = state.data.transactions.findIndex((x) => x.id === t.id);
          state.data.transactions[i] = res.tx;
          render();
          toast('Gespeichert');
        } catch (e) {
          toast(e.message, { error: true });
          return false;
        }
      },
    },
  ]);
}
