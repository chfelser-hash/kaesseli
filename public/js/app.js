// Hauptmodul: Daten laden, Anmeldung, Navigation, Synchronisation
import { h, s, toast } from './ui.js';
import { todayStr } from './calc.js';
import { renderErfassen } from './views/erfassen.js';
import { renderUebersicht } from './views/uebersicht.js';
import { renderBudget } from './views/budget.js';
import { renderImport } from './views/importer.js';
import { renderEinstellungen } from './views/einstellungen.js';

export const state = {
  data: null, // { rev, years, transactions, settings, user, users }
  year: null,
  view: 'erfassen',
  busy: false, // true während in einer Ansicht ungespeicherte Eingaben laufen
};

// Einfache Strich-Icons (SVG-Pfade, 24×24)
const ICONS = {
  erfassen: 'M12 5v14M5 12h14',
  uebersicht: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  budget: 'M4 6h16M4 12h16M4 18h10',
  import: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  einstellungen: 'M5 12h.01M12 12h.01M19 12h.01',
};
const VIEWS = [
  { id: 'erfassen', label: 'Erfassen', render: renderErfassen },
  { id: 'uebersicht', label: 'Übersicht', render: renderUebersicht },
  { id: 'budget', label: 'Budget', render: renderBudget },
  { id: 'import', label: 'Import', render: renderImport },
  { id: 'einstellungen', label: 'Mehr', render: renderEinstellungen },
];
const icon = (id) => s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': id === 'einstellungen' ? 3.2 : 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, s('path', { d: ICONS[id] }));

// ---------- API ----------
export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Budget': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (res.status === 401 && !url.startsWith('/api/login')) {
    showLogin(false);
    throw new Error('Nicht angemeldet');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || 'Fehler ' + res.status);
  if (data && typeof data.rev === 'number' && state.data) state.data.rev = data.rev;
  return data;
}

export async function reload() {
  state.data = await api('GET', '/api/data');
  const years = yearList();
  if (!state.year || !state.data.years[state.year]) {
    const cur = Number(todayStr().slice(0, 4));
    state.year = years.includes(cur) ? cur : years[years.length - 1];
  }
}

export const yearList = () => Object.keys(state.data?.years || {}).map(Number).sort((a, b) => a - b);
export const currentYear = () => state.data.years[state.year];
export const yearData = (y) => state.data.years[y];

/** Budget des Jahres, in das ein Datum fällt (fällt zurück auf das aktuell gewählte Jahr) */
export const yearForDate = (date) => state.data.years[Number(date.slice(0, 4))] || currentYear();

export function setYear(y) {
  state.year = Number(y);
  render();
}

export function go(view, params = {}) {
  state.params = params;
  location.hash = view;
  if (state.view === view) render();
}

// ---------- Rendering ----------
const main = () => document.getElementById('main');

export function render() {
  if (!state.data) return;
  renderChrome();
  const v = VIEWS.find((x) => x.id === state.view) || VIEWS[0];
  const el = v.render();
  main().replaceChildren(el);
  document.title = `${v.label} · Budget`;
}

function renderChrome() {
  const years = yearList();
  const header = document.getElementById('topbar');
  header.replaceChildren(
    h('div', { class: 'brand' }, h('span', { class: 'logo' }, 'CHF'), h('span', null, 'Budget')),
    h('nav', { class: 'tabs' },
      VIEWS.map((v) => h('a', { href: '#' + v.id, class: 'tab' + (state.view === v.id ? ' on' : '') }, h('span', { class: 'ti' }, icon(v.id)), h('span', null, v.label)))
    ),
    h('label', { class: 'year-select' },
      h('span', { class: 'sr' }, 'Jahr'),
      h('select', { onchange: (e) => setYear(e.target.value), 'aria-label': 'Jahr' },
        years.map((y) => h('option', { value: y, selected: y === state.year }, y))
      )
    )
  );
}

// ---------- Anmeldung ----------
async function showLogin(needsSetup) {
  document.getElementById('topbar').replaceChildren();
  const err = h('p', { class: 'form-error', role: 'alert' });
  const name = h('input', { name: 'name', autocomplete: 'username', required: true, placeholder: 'Vorname' });
  const pw = h('input', { name: 'password', type: 'password', autocomplete: needsSetup ? 'new-password' : 'current-password', required: true, minlength: needsSetup ? 8 : null });
  const form = h('form', {
    class: 'login card',
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      try {
        await api('POST', needsSetup ? '/api/setup' : '/api/login', { name: name.value, password: pw.value });
        await start();
      } catch (ex) {
        err.textContent = ex.message;
      }
    },
  },
    h('div', { class: 'brand big' }, h('span', { class: 'logo' }, 'CHF'), h('span', null, 'Budget')),
    h('h1', null, needsSetup ? 'Erstes Konto anlegen' : 'Anmelden'),
    needsSetup ? h('p', { class: 'muted' }, 'Weitere Personen kannst du danach unter «Mehr» hinzufügen.') : null,
    h('label', null, 'Name', name),
    h('label', null, needsSetup ? 'Passwort (mind. 8 Zeichen)' : 'Passwort', pw),
    err,
    h('button', { class: 'btn primary block', type: 'submit' }, needsSetup ? 'Konto anlegen' : 'Anmelden')
  );
  main().replaceChildren(h('div', { class: 'login-wrap' }, form));
  name.focus();
}

// ---------- Synchronisation zwischen Geräten ----------
let polling;
function startPolling() {
  clearInterval(polling);
  const check = async () => {
    if (document.hidden || !state.data || state.busy) return;
    try {
      const { rev } = await api('GET', '/api/rev');
      if (rev !== state.data.rev) {
        await reload();
        render();
        toast('Daten wurden aktualisiert');
      }
    } catch { /* offline – später nochmals */ }
  };
  polling = setInterval(check, 20000);
  document.addEventListener('visibilitychange', () => !document.hidden && check());
}

async function start() {
  const st = await (await fetch('/api/status', { credentials: 'same-origin' })).json();
  if (!st.user) return showLogin(st.needsSetup);
  await reload();
  state.view = (location.hash || '#erfassen').slice(1);
  render();
  startPolling();
}

window.addEventListener('hashchange', () => {
  state.view = location.hash.slice(1) || 'erfassen';
  render();
  window.scrollTo(0, 0);
});

window.addEventListener('beforeunload', (e) => {
  if (state.busy) e.preventDefault();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

start().catch((e) => {
  main().replaceChildren(h('div', { class: 'card' }, h('h2', null, 'Server nicht erreichbar'), h('p', null, e.message)));
});
