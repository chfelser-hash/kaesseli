// Tab «Mehr»: Konten, Regeln, Benutzer, Sicherung
import { h, toast, modal, confirmDialog } from '../ui.js';
import { state, api, render, reload, currentYear } from '../app.js';
import { fmtStamp } from '../calc.js';
import { settleNow } from './erfassen.js';

export function renderEinstellungen() {
  return h('div', { class: 'view settings' },
    h('div', { class: 'settings-grid' },
      settlementsCard(),
      accountsCard(),
      rulesCard(),
      usersCard(),
      backupCard(),
      profilesCard()
    )
  );
}

async function saveSettings(patch) {
  try {
    const res = await api('PUT', '/api/settings', patch);
    state.data.settings = res.settings;
    render();
  } catch (e) {
    toast(e.message, { error: true });
  }
}

function settlementsCard() {
  const list = [...state.data.settlements].sort((a, b) => b.at.localeCompare(a.at));
  return h('section', { class: 'card' },
    h('h2', null, 'Abrechnungen'),
    h('p', { class: 'hint' }, 'Zeitpunkte von «Jetzt abrechnen». Sie begrenzen den Import und die Ansicht «Abrechnung». Frühere Zeitpunkte kannst du hier nachtragen.'),
    list.length
      ? h('ul', { class: 'plain-list' }, list.slice(0, 24).map((x) => h('li', null,
        h('span', null, fmtStamp(x.at), h('small', { class: 'muted' }, [x.note, x.by].filter(Boolean).map((v) => ' · ' + v).join(''))),
        h('button', { class: 'icon-btn sm', title: 'Löschen', onclick: async () => {
          if (!(await confirmDialog('Abrechnung löschen?', `Abrechnung vom ${fmtStamp(x.at)} löschen? Buchungen bleiben erhalten.`, 'Löschen', true))) return;
          await api('DELETE', '/api/settlements/' + x.id);
          state.data.settlements = state.data.settlements.filter((y) => y.id !== x.id);
          render();
        } }, '✕'))))
      : h('p', { class: 'empty' }, 'Noch keine Abrechnung gespeichert.'),
    h('div', { class: 'row gap' }, h('button', { class: 'btn', onclick: settleNow }, '+ Abrechnung erfassen / nachtragen'))
  );
}

function accountsCard() {
  const accounts = state.data.settings.accounts;
  let input;
  const add = () => {
    const v = input.value.trim();
    if (!v || accounts.includes(v)) return;
    saveSettings({ accounts: [...accounts, v] });
  };
  return h('section', { class: 'card' },
    h('h2', null, 'Zahlungsmittel'),
    h('p', { class: 'hint' }, 'Erscheinen beim Erfassen unter «Bezahlt mit». Die Reihenfolge bestimmt den Vorschlag.'),
    h('ul', { class: 'plain-list' }, accounts.map((a, i) =>
      h('li', null, h('span', null, a),
        h('span', { class: 'row-actions' },
          h('button', { class: 'icon-btn sm', title: 'Nach oben', disabled: i === 0, onclick: () => { const n = [...accounts]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; saveSettings({ accounts: n }); } }, '↑'),
          h('button', { class: 'icon-btn sm', title: 'Entfernen', onclick: async () => { if (await confirmDialog('Zahlungsmittel entfernen', `«${a}» entfernen? Bestehende Buchungen behalten ihre Angabe.`, 'Entfernen', true)) saveSettings({ accounts: accounts.filter((x) => x !== a) }); } }, '✕')))
    )),
    h('form', { class: 'row gap', onsubmit: (e) => { e.preventDefault(); add(); } },
      (input = h('input', { placeholder: 'z.B. Migros Kreditkarte', class: 'grow' })),
      h('button', { class: 'btn', type: 'submit' }, 'Hinzufügen'))
  );
}

function rulesCard() {
  const rules = state.data.settings.rules;
  const pots = currentYear()?.pots || [];
  const potName = (k) => (k === '__ignore' ? 'ignorieren' : pots.find((p) => p.key === k)?.name || k);
  return h('section', { class: 'card' },
    h('h2', null, 'Import-Regeln'),
    h('p', { class: 'hint' }, 'Werden beim CSV-Import angewendet. Neue Regeln entstehen im Import mit «Regel».'),
    rules.length
      ? h('table', { class: 'simple' },
        h('thead', null, h('tr', null, h('th', null, 'Text enthält'), h('th', null, 'Topf / Kategorie'), h('th'))),
        h('tbody', null, rules.map((r) => h('tr', null,
          h('td', null, r.match),
          h('td', null, potName(r.pot) + (r.cat ? ' / ' + r.cat : '')),
          h('td', { class: 'row-actions' }, h('button', { class: 'icon-btn sm', title: 'Löschen', onclick: async () => { if (await confirmDialog('Regel löschen', `Regel «${r.match}» löschen?`, 'Löschen', true)) saveSettings({ rules: rules.filter((x) => x !== r) }); } }, '✕'))
        ))))
      : h('p', { class: 'empty' }, 'Noch keine Regeln.')
  );
}

function profilesCard() {
  const profiles = state.data.settings.importProfiles;
  if (!profiles.length) return null;
  return h('section', { class: 'card' },
    h('h2', null, 'Import-Profile'),
    h('ul', { class: 'plain-list' }, profiles.map((p) => h('li', null, h('span', null, p.name, h('small', { class: 'muted' }, ' · ' + p.account)),
      h('button', { class: 'icon-btn sm', title: 'Löschen', onclick: async () => { if (await confirmDialog('Import-Profil löschen', `Profil «${p.name}» löschen?`, 'Löschen', true)) saveSettings({ importProfiles: profiles.filter((x) => x !== p) }); } }, '✕'))))
  );
}

function usersCard() {
  const me = state.data.user;
  return h('section', { class: 'card' },
    h('h2', null, 'Benutzer'),
    h('ul', { class: 'plain-list' }, state.data.users.map((u) => h('li', null,
      h('span', null, u.name, u.id === me.id ? h('small', { class: 'muted' }, ' (du)') : null),
      u.id !== me.id ? h('button', { class: 'icon-btn sm', title: 'Entfernen', onclick: async () => {
        if (!(await confirmDialog('Benutzer entfernen?', `${u.name} kann sich danach nicht mehr anmelden. Die Daten bleiben.`, 'Entfernen', true))) return;
        await api('DELETE', '/api/users/' + u.id);
        await reload();
        render();
      } }, '✕') : null))),
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn', onclick: addUser }, '+ Person hinzufügen'),
      h('button', { class: 'btn', onclick: changePassword }, 'Passwort ändern'),
      h('button', { class: 'btn ghost', onclick: async () => { await api('POST', '/api/logout'); location.reload(); } }, 'Abmelden'))
  );
}

async function addUser() {
  const f = { name: '', password: '' };
  const ok = await modal('Person hinzufügen', h('div', { class: 'form-grid' },
    h('label', null, 'Name', h('input', { autocomplete: 'off', oninput: (e) => (f.name = e.target.value) })),
    h('label', null, 'Passwort (mind. 8 Zeichen)', h('input', { type: 'password', autocomplete: 'new-password', oninput: (e) => (f.password = e.target.value) }))
  ), [{ label: 'Abbrechen', value: false }, {
    label: 'Hinzufügen', primary: true,
    onClick: async () => {
      try { await api('POST', '/api/users', f); return true; } catch (e) { toast(e.message, { error: true }); return false; }
    },
  }]);
  if (ok) { await reload(); render(); toast('Person hinzugefügt'); }
}

async function changePassword() {
  const f = { oldPassword: '', newPassword: '' };
  const ok = await modal('Passwort ändern', h('div', { class: 'form-grid' },
    h('label', null, 'Aktuelles Passwort', h('input', { type: 'password', autocomplete: 'current-password', oninput: (e) => (f.oldPassword = e.target.value) })),
    h('label', null, 'Neues Passwort', h('input', { type: 'password', autocomplete: 'new-password', oninput: (e) => (f.newPassword = e.target.value) }))
  ), [{ label: 'Abbrechen', value: false }, {
    label: 'Ändern', primary: true,
    onClick: async () => {
      try { await api('POST', '/api/password', f); return true; } catch (e) { toast(e.message, { error: true }); return false; }
    },
  }]);
  if (ok) toast('Passwort geändert');
}

function backupCard() {
  const file = h('input', {
    type: 'file', accept: '.json,application/json', class: 'file-input',
    onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        const n = data.transactions?.length ?? 0;
        const years = Object.keys(data.years || {}).join(', ');
        if (!(await confirmDialog('Sicherung wiederherstellen?', `Die Datei enthält ${n} Buchungen und Budgets für ${years || '–'}. Der aktuelle Stand wird ersetzt (vorher automatisch gesichert).`, 'Wiederherstellen', true))) return;
        await api('POST', '/api/restore', data);
        await reload();
        render();
        toast('Wiederhergestellt');
      } catch (ex) {
        toast('Wiederherstellen fehlgeschlagen: ' + ex.message, { error: true });
      } finally {
        e.target.value = '';
      }
    },
  });
  return h('section', { class: 'card' },
    h('h2', null, 'Sicherung'),
    h('p', { class: 'hint' }, 'Der Server legt täglich automatisch eine Kopie im Ordner data/backups an (30 Tage). Zusätzlich kannst du hier alles als Datei sichern oder eine Sicherung bzw. den Excel-Import einspielen.'),
    h('div', { class: 'row gap wrap' },
      h('a', { class: 'btn', href: '/api/backup', download: '' }, 'Sicherung herunterladen'),
      h('label', { class: 'btn file-btn' }, 'Sicherung einspielen …', file)),
    h('p', { class: 'hint' }, `Stand: ${state.data.transactions.length} Buchungen · Version ${state.data.rev}`)
  );
}
