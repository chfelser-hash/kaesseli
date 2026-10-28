// Server-/API-Tests: Anmeldung, Schutz, Buchungen, Budget, Abrechnungen, Sicherung.
// Jeder Test-Block startet einen eigenen Server mit leerem Datenordner (nur erfundene Daten).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, client } from './helpers/server.js';

let srv;
let api;
const year = new Date().getFullYear();

before(async () => {
  srv = await startServer();
  api = client(srv.url).call;
});
after(async () => srv?.stop());

test('frische Installation: Einrichtung nötig, Daten geschützt', async () => {
  const st = await api('GET', '/api/status');
  assert.equal(st.status, 200);
  assert.equal(st.data.needsSetup, true);
  assert.equal(st.data.user, null);
  assert.equal((await api('GET', '/api/data')).status, 401);
});

test('schreibende Aufrufe brauchen den Schutz-Header', async () => {
  const r = await api('POST', '/api/setup', { name: 'Test', password: 'geheim123' }, { header: false });
  assert.equal(r.status, 403);
});

test('erstes Konto anlegen, zweite Einrichtung verboten, Passwortregeln', async () => {
  assert.equal((await api('POST', '/api/setup', { name: 'Test', password: 'kurz' })).status, 400);
  const r = await api('POST', '/api/setup', { name: 'Test', password: 'geheim123' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.name, 'Test');
  assert.equal((await api('POST', '/api/setup', { name: 'Zwei', password: 'geheim123' })).status, 403);
});

test('frische Daten sind vollständig (Budget, Buchungen, Abrechnungen, Einstellungen)', async () => {
  const { status, data } = await api('GET', '/api/data');
  assert.equal(status, 200);
  assert.ok(data.years[year], 'Budget für das aktuelle Jahr fehlt');
  assert.deepEqual(data.transactions, []);
  assert.deepEqual(data.settlements, []);
  assert.ok(Array.isArray(data.settings.accounts) && data.settings.accounts.length);
  assert.ok(Array.isArray(data.settings.rules));
});

test('Buchung erfassen, bearbeiten, Bulk-Erfassung, löschen', async () => {
  const bad = await api('POST', '/api/tx', { date: `${year}-03-01`, amount: 'abc', pot: 'haushalt' });
  assert.equal(bad.status, 400);
  const c = await api('POST', '/api/tx', { date: `${year}-03-01`, time: '09:15', amount: 12.345, pot: 'haushalt', note: 'Laden Test', account: 'Bar' });
  assert.equal(c.status, 200);
  const tx = c.data.created[0];
  assert.equal(tx.amount, 12.35); // auf Rappen gerundet
  assert.equal(tx.time, '09:15');
  assert.equal(tx.by, 'Test');
  const u = await api('PUT', '/api/tx/' + tx.id, { ...tx, amount: 20, cat: 'X' });
  assert.equal(u.data.tx.amount, 20);
  assert.equal(u.data.tx.cat, 'X');
  const bulk = await api('POST', '/api/tx', [1, 2, 3].map((n) => ({ date: `${year}-03-0${n}`, amount: n, pot: 'haushalt' })));
  assert.equal(bulk.data.created.length, 3);
  await api('DELETE', '/api/tx/' + tx.id);
  await api('POST', '/api/tx/delete', { ids: bulk.data.created.map((t) => t.id) });
  assert.equal((await api('GET', '/api/data')).data.transactions.length, 0);
});

test('Budget speichern: Sparen-Haken und Unterkategorien bleiben erhalten', async () => {
  const d = (await api('GET', '/api/data')).data;
  const y = d.years[year];
  const pot = y.pots.find((p) => p.key === 'ferien');
  pot.lines = [
    { id: 'a', name: 'Ferien', expr: '1000', freq: 12 },
    { id: 'b', name: 'Reise A', expr: '0', freq: 1, parent: 'Ferien' },
  ];
  y.pots.find((p) => p.key === 'fix').lines.push({ id: 'c', name: 'Vorsorge', expr: '100', freq: 12, saving: true });
  assert.equal((await api('PUT', '/api/budget/' + year, y)).status, 200);
  const y2 = (await api('GET', '/api/data')).data.years[year];
  assert.equal(y2.pots.find((p) => p.key === 'ferien').lines[1].parent, 'Ferien');
  assert.equal(y2.pots.find((p) => p.key === 'fix').lines.at(-1).saving, true);
});

test('neues Jahr aus Vorlage mit Übertrag', async () => {
  const r = await api('POST', `/api/budget/${year + 1}/create`, { from: year, carryover: { ferien: 500 } });
  assert.equal(r.status, 200);
  assert.equal(r.data.year.pots.find((p) => p.key === 'ferien').carryover, 500);
  assert.equal((await api('POST', `/api/budget/${year + 1}/create`, { from: year })).status, 400);
  await api('DELETE', `/api/budget/${year + 1}`);
});

test('Abrechnungszeitpunkte: speichern, Duplikat verhindern, löschen', async () => {
  assert.equal((await api('POST', '/api/settlements', { at: 'gestern' })).status, 400);
  const s = await api('POST', '/api/settlements', { at: `${year}-02-20T10:05`, note: 'Test' });
  assert.equal(s.status, 200);
  assert.equal((await api('POST', '/api/settlements', { at: `${year}-02-20T10:05` })).status, 400);
  assert.equal((await api('GET', '/api/data')).data.settlements.length, 1);
  await api('DELETE', '/api/settlements/' + s.data.settlement.id);
  assert.equal((await api('GET', '/api/data')).data.settlements.length, 0);
});

test('Sicherung herunterladen und wiederherstellen (mit Sicherheitskopie)', async () => {
  await api('POST', '/api/tx', { date: `${year}-04-01`, amount: 99, pot: 'haushalt', note: 'vor Sicherung' });
  const backup = await api('GET', '/api/backup');
  assert.equal(backup.status, 200);
  assert.match(backup.headers.get('content-disposition') || '', /budget-backup-/);
  const saved = typeof backup.data === 'string' ? JSON.parse(backup.data) : backup.data;
  assert.equal(saved.transactions.length, 1);
  await api('POST', '/api/tx', { date: `${year}-04-02`, amount: 1, pot: 'haushalt', note: 'nach Sicherung' });
  assert.equal((await api('POST', '/api/restore', { nope: true })).status, 400);
  assert.equal((await api('POST', '/api/restore', saved)).status, 200);
  const d = (await api('GET', '/api/data')).data;
  assert.deepEqual(d.transactions.map((t) => t.note), ['vor Sicherung']);
  const files = fs.readdirSync(path.join(srv.dataDir, 'backups'));
  assert.ok(files.some((f) => f.startsWith('vor-wiederherstellung-')), 'Sicherheitskopie fehlt');
  assert.ok(files.some((f) => /^budget-\d{4}-\d{2}-\d{2}\.json$/.test(f)), 'Tageskopie fehlt');
});

test('Daten bleiben nach Neustart erhalten', async () => {
  await srv.stop();
  srv = await startServer({ dataDir: srv.dataDir });
  const c = client(srv.url);
  await c.call('POST', '/api/login', { name: 'test', password: 'geheim123' }); // Name ohne Gross-/Kleinschreibung
  const d = await c.call('GET', '/api/data');
  assert.equal(d.status, 200);
  assert.equal(d.data.transactions.length, 1);
  api = c.call;
});

test('falsches Passwort und Sperre nach vielen Fehlversuchen', async () => {
  const c = client(srv.url);
  const first = await c.call('POST', '/api/login', { name: 'Test', password: 'falsch' });
  assert.equal(first.status, 401);
  let last;
  for (let i = 0; i < 9; i++) last = await c.call('POST', '/api/login', { name: 'Test', password: 'falsch' });
  assert.equal(last.status, 429);
});

test('Abmelden beendet die Sitzung', async () => {
  const r = await api('POST', '/api/logout');
  assert.equal(r.status, 200);
  assert.equal((await api('GET', '/api/data')).status, 401);
});

test('statische Dateien: App wird ausgeliefert, kein Zugriff ausserhalb von public/', async () => {
  const index = await fetch(srv.url + '/');
  assert.equal(index.status, 200);
  assert.match(await index.text(), /<title>Kässeli<\/title>/);
  for (const p of ['/js/app.js', '/styles.css', '/manifest.webmanifest', '/sw.js']) {
    assert.equal((await fetch(srv.url + p)).status, 200, p);
  }
  const trav = await fetch(srv.url + '/..%2f..%2fserver%2findex.js');
  assert.notEqual(trav.status, 200);
  assert.ok(!(await trav.text()).includes('createServer'));
  assert.equal(index.headers.get('x-frame-options'), 'DENY');
  assert.ok(index.headers.get('content-security-policy'));
});
