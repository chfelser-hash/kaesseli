// Version, Änderungsliste und Update-Schnittstelle des Servers (Aktualisieren ausgeschaltet bzw. lokales Git-Repo)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, client } from './helpers/server.js';
import { parseChangelog } from '../server/update.js';
import { makeRepos } from './git-helpers.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const servers = [];
after(async () => Promise.all(servers.map((s) => s.stop())));

async function loggedIn(env) {
  const srv = await startServer({ env });
  servers.push(srv);
  const c = client(srv.url);
  await c.call('POST', '/api/setup', { name: 'Test', password: 'geheim123' });
  return { srv, api: c.call };
}

test('CHANGELOG enthält die aktuelle Version mit Datum und Änderungen', () => {
  const log = parseChangelog(fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'));
  assert.equal(log[0].version, pkg.version, 'Neueste CHANGELOG-Version ≠ package.json');
  assert.match(log[0].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(log[0].changes.length > 0);
});

test('Server meldet Version in Status, Daten, rev und Änderungsliste', async () => {
  const { srv, api } = await loggedIn();
  assert.equal((await (await fetch(srv.url + '/api/status')).json()).version, pkg.version);
  const d = (await api('GET', '/api/data')).data;
  assert.equal(d.version, pkg.version);
  assert.match(d.versionDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal((await api('GET', '/api/rev')).data.version, pkg.version);
  const cl = (await api('GET', '/api/changelog')).data;
  assert.equal(cl.changelog[0].version, pkg.version);
  // Service Worker: Cache-Name enthält die Version (neue Version → Oberfläche frisch laden)
  assert.match(await (await fetch(srv.url + '/sw.js')).text(), new RegExp(`kaesseli-shell-${pkg.version.replace(/\./g, '\\.')}`));
});

test('Update-Schnittstelle: nur angemeldet; ausgeschaltet → verständlicher Grund', async () => {
  const { srv, api } = await loggedIn();
  assert.equal((await fetch(srv.url + '/api/update')).status, 401);
  const r = (await api('GET', '/api/update')).data;
  assert.equal(r.enabled, false);
  assert.match(r.reason, /ausgeschaltet/);
  assert.equal((await api('POST', '/api/update', { version: '9.9.9' })).status, 400);
});

test('Update über den Server: Sicherung vor dem Update, Programmordner auf neue Version', async () => {
  const repos = makeRepos(['1.0.0', '1.1.0']);
  try {
    const { srv, api } = await loggedIn({ UPDATE_ENABLED: 'true', UPDATE_ROOT: repos.clone });
    const c = (await api('GET', '/api/update')).data;
    assert.equal(c.enabled, true);
    assert.ok(c.versions.includes('1.1.0'));
    const r = await api('POST', '/api/update', { version: '1.1.0' });
    assert.equal(r.status, 200);
    assert.match(r.data.backup, /^vor-update-1\.1\.0-/);
    assert.ok(fs.existsSync(`${srv.dataDir}/backups/${r.data.backup}`));
    assert.equal(repos.version(), '1.1.0');
    assert.equal(r.data.restart, false);
  } finally {
    repos.cleanup();
  }
});
