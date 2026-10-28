// Tab «Import»: Kontoauszüge (CSV) einlesen, Töpfen zuordnen, Regeln lernen
import { h, toast, modal } from '../ui.js';
import { state, api, render, yearForDate } from '../app.js';
import { readFileText, parseCsv, guessMapping, applyMapping } from '../csv.js';
import { fmt, fmtDate, hashStr } from '../calc.js';

const IGNORE = '__ignore';
let imp = null; // { fileName, rows, map, account, profileId, items }

export function renderImport() {
  const root = h('div', { class: 'view import' });
  root.append(fileCard());
  if (imp) {
    root.append(mappingCard());
    root.append(previewCard());
  } else {
    root.append(helpCard());
  }
  return root;
}

function helpCard() {
  return h('section', { class: 'card' },
    h('h2', null, 'So funktioniert der Import'),
    h('ol', { class: 'steps' },
      h('li', null, 'Im E-Banking (z.B. PostFinance) bzw. im Kreditkarten-Portal die Bewegungen als CSV exportieren.'),
      h('li', null, 'Datei hier auswählen und das Konto angeben. Spalten werden automatisch erkannt; einmal geprüft, wird das Format als Profil gespeichert.'),
      h('li', null, 'Jede Zeile einem Topf zuordnen oder ignorieren (z.B. Lohn, Miete, Umbuchungen). Mit «Regel» merkt sich die App die Zuordnung für das nächste Mal.'),
      h('li', null, 'Bereits importierte Zeilen werden erkannt und nicht doppelt übernommen.')
    ),
    h('p', { class: 'hint' }, 'Die Datei wird nur im Browser gelesen; gespeichert werden nur die übernommenen Buchungen.')
  );
}

function fileCard() {
  const accounts = state.data.settings.accounts;
  const input = h('input', {
    type: 'file', accept: '.csv,.txt,text/csv', class: 'file-input',
    onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await readFileText(file);
        const { rows } = parseCsv(text);
        if (rows.length < 2) throw new Error('Keine Daten gefunden');
        startImport(file.name, rows);
      } catch (ex) {
        toast('Datei konnte nicht gelesen werden: ' + ex.message, { error: true });
      }
    },
  });
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Auszug importieren'), imp ? h('button', { class: 'link', onclick: () => { imp = null; state.busy = false; render(); } }, 'Abbrechen') : null),
    h('div', { class: 'import-file' },
      h('label', { class: 'btn primary file-btn' }, imp ? 'Andere Datei …' : 'CSV-Datei wählen …', input),
      imp ? h('span', { class: 'muted' }, imp.fileName) : null
    ),
    imp ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Konto dieses Auszugs'),
      h('select', { onchange: (e) => { imp.account = e.target.value; recalcItems(); render(); } },
        accounts.map((a) => h('option', { value: a, selected: a === imp.account }, a)))) : null
  );
}

function startImport(fileName, rows) {
  let map = guessMapping(rows);
  const profiles = state.data.settings.importProfiles;
  const profile = profiles.find((p) => p.signature && p.signature === map.signature);
  let account = state.data.settings.accounts[0] || '';
  if (profile) {
    map = { ...map, ...profile.map, header: map.header };
    account = profile.account || account;
    toast(`Profil «${profile.name}» erkannt`);
  }
  imp = { fileName, rows, map, account, profileId: profile?.id || null, items: [] };
  state.busy = true;
  recalcItems();
  render();
}

function recalcItems() {
  const parsed = applyMapping(imp.rows, imp.map);
  const existingSrc = new Set(state.data.transactions.map((t) => t.src).filter(Boolean));
  const byDateAmt = new Set(state.data.transactions.map((t) => `${t.date}|${t.amount.toFixed(2)}`));
  const rules = state.data.settings.rules;
  imp.items = parsed.map((r) => {
    const src = 'imp:' + hashStr(`${imp.account}|${r.date}|${r.amount}|${r.text}`);
    const rule = rules.find((ru) => r.text.toLowerCase().includes(ru.match.toLowerCase()));
    let status = '';
    if (existingSrc.has(src)) status = 'dup';
    else if (byDateAmt.has(`${r.date}|${r.amount.toFixed(2)}`)) status = 'maybe';
    const pot = rule ? rule.pot : r.amount < 0 ? IGNORE : '';
    return { ...r, src, status, rule: rule?.match || '', pot, cat: rule?.cat || '', include: status === '' && pot !== IGNORE };
  });
}

// ---------- Spaltenzuordnung ----------
function mappingCard() {
  const m = imp.map;
  const head = m.header >= 0 ? imp.rows[m.header] : imp.rows[0].map((_, i) => `Spalte ${i + 1}`);
  const colSel = (key, allowNone = false) => h('select', { onchange: (e) => { m[key] = Number(e.target.value); recalcItems(); render(); } },
    allowNone ? h('option', { value: -1, selected: m[key] < 0 }, '– keine –') : null,
    head.map((c, i) => h('option', { value: i, selected: m[key] === i }, c || `Spalte ${i + 1}`)));
  const profiles = state.data.settings.importProfiles;
  const n = imp.items.length;

  return h('details', { class: 'card mapping', open: !imp.profileId || !n },
    h('summary', null, h('h2', null, 'Spalten'), h('span', { class: 'muted' }, ` ${n} Zeilen erkannt${imp.profileId ? ' · Profil: ' + (profiles.find((p) => p.id === imp.profileId)?.name || '') : ''}`)),
    h('div', { class: 'form-grid' },
      h('label', null, 'Kopfzeile ist Zeile', h('input', { type: 'number', min: 0, value: m.header + 1, onchange: (e) => { m.header = Number(e.target.value) - 1; recalcItems(); render(); } })),
      h('label', null, 'Datum', colSel('date')),
      h('label', null, 'Text', colSel('text')),
      h('label', null, 'Zusatztext', colSel('text2', true)),
      h('label', null, 'Beträge', h('select', { onchange: (e) => { m.mode = e.target.value; recalcItems(); render(); } },
        h('option', { value: 'single', selected: m.mode === 'single' }, 'eine Spalte'),
        h('option', { value: 'split', selected: m.mode === 'split' }, 'Belastung / Gutschrift getrennt'))),
      m.mode === 'split'
        ? [h('label', null, 'Belastung (Ausgabe)', colSel('debit')), h('label', null, 'Gutschrift (Eingang)', colSel('credit', true))]
        : [h('label', null, 'Betrag', colSel('amount')),
          h('label', null, 'Vorzeichen', h('select', { onchange: (e) => { m.expenseNegative = e.target.value === 'neg'; recalcItems(); render(); } },
            h('option', { value: 'pos', selected: !m.expenseNegative }, 'Ausgaben sind positiv (Kreditkarte)'),
            h('option', { value: 'neg', selected: m.expenseNegative }, 'Ausgaben sind negativ (Bankkonto)')))]
    ),
    h('div', { class: 'row gap' },
      h('button', { class: 'btn', onclick: saveProfile }, imp.profileId ? 'Profil aktualisieren' : 'Als Profil speichern'),
      h('span', { class: 'hint' }, 'Ein Profil merkt sich Spalten und Konto für dieses Dateiformat.')
    )
  );
}

async function saveProfile() {
  const existing = state.data.settings.importProfiles.find((p) => p.id === imp.profileId);
  let name = existing?.name || imp.account;
  const r = await modal('Import-Profil', h('label', null, 'Name', h('input', { value: name, oninput: (e) => (name = e.target.value) })), [
    { label: 'Abbrechen', value: false }, { label: 'Speichern', primary: true, value: true },
  ]);
  if (!r) return;
  const { header, ...map } = imp.map;
  const profile = { id: existing?.id || Math.random().toString(36).slice(2, 10), name, signature: imp.map.signature, account: imp.account, map };
  const profiles = [...state.data.settings.importProfiles.filter((p) => p.id !== profile.id), profile];
  await saveSettings({ importProfiles: profiles });
  imp.profileId = profile.id;
  toast('Profil gespeichert');
  render();
}

async function saveSettings(patch) {
  const res = await api('PUT', '/api/settings', patch);
  state.data.settings = res.settings;
}

// ---------- Vorschau & Zuordnung ----------
function potOptions(date) {
  const pots = (yearForDate(date)?.pots || []).filter((p) => p.tracked);
  return pots;
}

function previewCard() {
  const items = imp.items;
  const sel = items.filter((i) => i.include);
  const missing = sel.filter((i) => !i.pot || i.pot === IGNORE).length;
  const counts = {
    dup: items.filter((i) => i.status === 'dup').length,
    maybe: items.filter((i) => i.status === 'maybe').length,
  };
  const anyDate = items[0]?.date || new Date().toISOString().slice(0, 10);
  let bulkPot = '';

  return h('section', { class: 'card preview' },
    h('div', { class: 'card-head' },
      h('h2', null, 'Zuordnen'),
      h('span', { class: 'muted' }, `${sel.length} von ${items.length} ausgewählt · CHF ${fmt(sel.reduce((a, i) => a + i.amount, 0))}`)
    ),
    counts.dup || counts.maybe ? h('p', { class: 'hint' }, [counts.dup ? `${counts.dup} bereits importiert` : null, counts.maybe ? `${counts.maybe} evtl. schon manuell erfasst (gleiches Datum und Betrag)` : null].filter(Boolean).join(' · ') + ' – diese sind abgewählt.') : null,
    h('div', { class: 'bulk-bar' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: sel.length === items.length, onchange: (e) => { items.forEach((i) => (i.include = e.target.checked)); render(); } }), ' alle'),
      h('select', { onchange: (e) => (bulkPot = e.target.value) },
        h('option', { value: '' }, 'Ausgewählte ohne Topf →'),
        potOptions(anyDate).map((p) => h('option', { value: p.key }, p.name))),
      h('button', { class: 'btn', onclick: () => { if (!bulkPot) return; sel.forEach((i) => { if (!i.pot || i.pot === IGNORE) { i.pot = bulkPot; i.cat = ''; } }); render(); } }, 'Zuweisen')
    ),
    h('ul', { class: 'imp-list' }, items.map((it) => importRow(it))),
    h('div', { class: 'imp-footer' },
      missing ? h('span', { class: 'warn' }, `${missing} ausgewählte Zeilen haben noch keinen Topf`) : null,
      h('button', { class: 'btn primary big', disabled: !sel.length || missing > 0, onclick: doImport }, `${sel.length} Buchungen übernehmen`)
    )
  );
}

function importRow(it) {
  const pots = potOptions(it.date);
  const pot = pots.find((p) => p.key === it.pot);
  const lines = pot?.lines || [];
  return h('li', { class: 'imp-row' + (it.include ? '' : ' off') + (it.status ? ' ' + it.status : '') },
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: it.include, 'aria-label': 'übernehmen', onchange: (e) => { it.include = e.target.checked; render(); } })),
    h('div', { class: 'imp-info' },
      h('span', { class: 'imp-text', title: it.text }, it.text || '–'),
      h('span', { class: 'imp-meta' }, fmtDate(it.date),
        it.status === 'dup' ? h('b', { class: 'tag' }, 'schon importiert') : null,
        it.status === 'maybe' ? h('b', { class: 'tag' }, 'evtl. doppelt') : null,
        it.rule ? h('b', { class: 'tag rule' }, 'Regel: ' + it.rule) : null)
    ),
    h('span', { class: 'imp-amt' + (it.amount < 0 ? ' neg' : '') }, fmt(it.amount)),
    h('div', { class: 'imp-assign' },
      h('select', { 'aria-label': 'Topf', class: it.pot ? '' : 'empty', onchange: (e) => { it.pot = e.target.value; it.cat = ''; it.include = it.pot !== IGNORE && it.status !== 'dup'; render(); } },
        h('option', { value: '', selected: !it.pot }, 'Topf wählen …'),
        pots.map((p) => h('option', { value: p.key, selected: p.key === it.pot }, p.name)),
        h('option', { value: IGNORE, selected: it.pot === IGNORE }, '— ignorieren —')),
      lines.length > 1 ? h('select', { 'aria-label': 'Kategorie', onchange: (e) => (it.cat = e.target.value) },
        h('option', { value: '' }, 'Kategorie …'),
        lines.map((l) => h('option', { value: l.name, selected: l.name === it.cat }, l.name))) : null,
      it.pot ? h('button', { class: 'link', onclick: () => makeRule(it) }, 'Regel') : null
    )
  );
}

async function makeRule(it) {
  const guess = (it.text.match(/[A-Za-zÄÖÜäöüé][\wÄÖÜäöüé&.'-]{2,}/g) || [it.text]).slice(0, 2).join(' ');
  let match = guess;
  const r = await modal('Regel erstellen', h('div', null,
    h('p', null, 'Zeilen, deren Text Folgendes enthält, werden automatisch zugeordnet:'),
    h('label', null, 'Text enthält', h('input', { value: match, oninput: (e) => (match = e.target.value) })),
    h('p', { class: 'hint' }, `→ ${it.pot === IGNORE ? 'ignorieren' : (potOptions(it.date).find((p) => p.key === it.pot)?.name || it.pot) + (it.cat ? ' / ' + it.cat : '')}`)
  ), [{ label: 'Abbrechen', value: false }, { label: 'Regel speichern', primary: true, value: true }]);
  if (!r || !match.trim()) return;
  const rules = [...state.data.settings.rules.filter((x) => x.match.toLowerCase() !== match.trim().toLowerCase()), { match: match.trim(), pot: it.pot, cat: it.cat }];
  await saveSettings({ rules });
  // Regel sofort auf alle passenden Zeilen anwenden
  let n = 0;
  for (const x of imp.items) {
    if (x.text.toLowerCase().includes(match.trim().toLowerCase())) {
      x.pot = it.pot;
      x.cat = it.cat;
      x.rule = match.trim();
      x.include = x.pot !== IGNORE && x.status === '';
      n++;
    }
  }
  toast(`Regel gespeichert · ${n} Zeilen zugeordnet`);
  render();
}

async function doImport() {
  const list = imp.items.filter((i) => i.include && i.pot && i.pot !== IGNORE).map((i) => ({
    date: i.date, amount: i.amount, pot: i.pot, cat: i.cat, account: imp.account, note: i.text, src: i.src,
  }));
  try {
    const res = await api('POST', '/api/tx', list);
    state.data.transactions.push(...res.created);
    toast(`${res.created.length} Buchungen importiert`);
    imp = null;
    state.busy = false;
    location.hash = 'uebersicht';
  } catch (e) {
    toast(e.message, { error: true });
  }
}
