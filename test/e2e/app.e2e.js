// Browser-Tests: Die App wird in einem echten Chromium bedient – wie von Hand, mit erfundenen Daten.
// Start: npm run test:e2e   (benötigt das Paket «playwright» mit Chromium)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer } from '../helpers/server.js';

const { chromium } = createRequire(import.meta.url)('playwright');

let srv, browser, page;
const errors = [];
const year = new Date().getFullYear();
const today = new Date();
const dd = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

before(async () => {
  srv = await startServer();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1300, height: 1000 }, locale: 'de-CH' });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|401/.test(m.text()) && errors.push(m.text()));
});
after(async () => {
  await browser?.close();
  await srv?.stop();
});

const go = async (tab) => {
  await page.goto(`${srv.url}/#${tab}`);
  await page.waitForSelector('.view');
  await page.waitForTimeout(150);
};
const noErrors = (where) => assert.deepEqual(errors.splice(0), [], `JavaScript-Fehler in ${where}`);

test('Erstes Konto anlegen', async () => {
  await page.goto(srv.url);
  await page.fill('input[name=name]', 'Testperson');
  await page.fill('input[name=password]', 'geheim123');
  await page.click('button[type=submit]');
  await page.waitForSelector('.view.erfassen');
  noErrors('Einrichtung');
});

test('Alle Tabs laden ohne Fehler', async () => {
  for (const [tab, selector] of [['erfassen', '.entry'], ['uebersicht', 'table.monitor'], ['budget', '.summary'], ['import', '.import-file'], ['einstellungen', '.settings-grid .card']]) {
    await go(tab);
    assert.ok(await page.locator(selector).count(), `Tab ${tab}: ${selector} fehlt`);
    noErrors(`Tab ${tab}`);
  }
  assert.equal(await page.locator('.settings-grid .card').count() >= 4, true, 'Tab «Mehr» unvollständig');
});

test('Budget bearbeiten wird automatisch gespeichert', async () => {
  await go('budget');
  const idx = await page.evaluate(() => [...document.querySelectorAll('.pot-edit')].findIndex((c) => c.querySelector('.pot-name').value === 'Haushalt'));
  const expr = page.locator('.pot-edit').nth(idx).locator('input.expr').first();
  await expr.fill('1000+200');
  await page.waitForFunction(() => document.querySelector('.save-status')?.textContent.includes('Gespeichert'), null, { timeout: 5000 });
  await page.reload();
  await page.waitForSelector('.view');
  await go('budget');
  const val = await page.locator('.pot-edit').nth(idx).locator('input.expr').first().inputValue();
  assert.equal(val, '1000+200');
  assert.ok(await page.locator('.verdict').count(), 'Zusammenfassung «Geht das Budget auf?» fehlt');
  noErrors('Budget');
});

test('Ausgabe erfassen mit Rechnung, erscheint in Liste und Kacheln', async () => {
  await go('erfassen');
  await page.click('.month-head .seg >> text=Monat');
  await page.fill('.amount-input', '40+12.5');
  await page.click('.chips.pots >> text=Haushalt');
  await page.fill('.entry input[list]', 'Testeinkauf');
  await page.click('.entry button[type=submit]');
  await page.waitForSelector('.tx-note:has-text("Testeinkauf")');
  assert.match(await page.locator('.tx', { hasText: 'Testeinkauf' }).innerText(), /52\.50/);
  assert.match(await page.locator('.pot-tile', { hasText: 'Haushalt' }).innerText(), /53/); // gerundet
  noErrors('Erfassen');
});

test('Löschen fragt nach – «Abbrechen» behält die Buchung', async () => {
  await page.click('.tx:has-text("Testeinkauf")');
  await page.click('dialog footer >> text=Löschen');
  assert.match(await page.locator('dialog >> nth=-1').innerText(), /löschen\?/i);
  await page.click('dialog >> nth=-1 >> footer >> text=Abbrechen');
  await page.waitForTimeout(150);
  // Rückfrage ist zu, der Bearbeiten-Dialog bleibt offen und wird ebenfalls abgebrochen
  assert.equal(await page.locator('dialog').count(), 1, 'Rückfrage bleibt offen');
  await page.click('dialog footer >> text=Abbrechen');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('dialog').count(), 0, 'Bearbeiten-Dialog bleibt offen');
  assert.equal(await page.locator('.tx', { hasText: 'Testeinkauf' }).count(), 1);
  noErrors('Löschen-Rückfrage');
});

test('Dialoge schliessen mit «Abbrechen»', async () => {
  await go('budget');
  await page.click('text=+ Neues Jahr');
  await page.click('dialog footer >> text=Abbrechen');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('dialog').count(), 0);
  noErrors('Dialoge');
});

test('Jetzt abrechnen speichert den Zeitpunkt', async () => {
  await go('erfassen');
  await page.click('.month-head .seg >> text=Abrechnung');
  await page.click('text=Jetzt abrechnen');
  await page.click('dialog footer >> text=Abrechnung speichern');
  await page.waitForSelector('.hint.period');
  await go('einstellungen');
  assert.equal(await page.locator('.settings-grid .card', { hasText: 'Abrechnungen' }).locator('.plain-list li').count(), 1);
  noErrors('Abrechnung');
});

test('Kreditkarten-Text einfügen und importieren, Duplikate werden erkannt', async () => {
  const d1 = new Date(today); d1.setDate(d1.getDate() - 1);
  const text = [
    'Alle KartenVisa **** 1111 CHF Anna MusterVisa **** 2222 CHF Beat Muster',
    '1111ANNA MUSTER', 'Laden Eins', `${dd(today)} 00:00 Musterdorf`, '8.20  CHF',
    'Laden Zwei', `${dd(d1)} 13:52`, '7.30  CHF',
  ].join('\n');
  const run = async () => {
    await go('import');
    await page.click('text=Text einfügen …');
    await page.fill('dialog textarea', text);
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.paste-sample li').count(), 2);
    await page.click('dialog footer >> text=Weiter');
    await page.selectOption('.field select >> nth=-1', 'all'); // alle Buchungen der Datei
  };
  await run();
  await page.locator('.bulk-bar select').selectOption('haushalt');
  await page.click('.bulk-bar >> text=Zuweisen');
  await page.click('.imp-footer button');
  await page.waitForTimeout(500);
  await run();
  assert.equal(await page.locator('.imp-row .tag', { hasText: 'schon importiert' }).count(), 2);
  noErrors('Import');
});

test('Übersicht und Jahresansicht mit Kategorie-Link', async () => {
  await go('uebersicht');
  assert.ok(await page.locator('.pot-card').count() >= 3);
  await page.locator('.pot-card', { hasText: 'Haushalt' }).locator('.link-year').click();
  await page.waitForSelector('.month-head h2:has-text("Jahr")');
  assert.ok(await page.locator('.tx-list li').count() >= 1);
  noErrors('Übersicht');
});

test('Handy-Ansicht: kein seitliches Scrollen, Tab-Leiste unten', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ['erfassen', 'uebersicht', 'budget', 'import', 'einstellungen']) {
    await go(tab);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `Tab ${tab} ist ${overflow}px zu breit`);
  }
  const bar = await page.locator('.tabs').boundingBox();
  assert.ok(bar.y > 700, 'Tab-Leiste nicht unten');
  noErrors('Handy');
});

test('Über Kässeli: Version, Änderungen, Aktualisieren ausgeschaltet', async () => {
  await page.setViewportSize({ width: 1300, height: 1000 });
  await go('einstellungen');
  const about = page.locator('.card.about');
  assert.match(await about.innerText(), /Version \d+\.\d+\.\d+/);
  await about.locator('summary', { hasText: 'Was ist neu?' }).click();
  await page.waitForSelector('.about .cl-entry');
  await about.locator('button', { hasText: 'Nach Updates suchen' }).click();
  await page.waitForSelector('.update-box p');
  assert.match(await page.locator('.update-box').innerText(), /ausgeschaltet/);
  noErrors('Über Kässeli');
});

test('Abmelden führt zur Anmeldung', async () => {
  await page.setViewportSize({ width: 1300, height: 1000 });
  await go('einstellungen');
  await page.click('text=Abmelden');
  await page.waitForSelector('form.login');
  noErrors('Abmelden');
});
