// Haushaltsbudget – Server ohne externe Abhängigkeiten (nur Node.js >= 20).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, newId } from './store.js';
import { Auth, httpError } from './auth.js';
import { createYearTemplate } from './template.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

fs.mkdirSync(DATA_DIR, { recursive: true });
const store = new Store(DATA_DIR);
const auth = new Auth(DATA_DIR);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------- Hilfsfunktionen ----------
function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(httpError(413, 'Daten zu gross'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(httpError(400, 'Ungültiges JSON'));
      }
    });
    req.on('error', reject);
  });
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(req, token, maxAge) {
  const secure = process.env.COOKIE_SECURE === 'true' || req.headers['x-forwarded-proto'] === 'https';
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const str = (v, max = 300) => String(v ?? '').slice(0, max);

function cleanTx(input, user, existing = {}) {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount)) throw httpError(400, 'Betrag ungültig');
  if (!isDate(input.date)) throw httpError(400, 'Datum ungültig');
  if (!input.pot) throw httpError(400, 'Topf fehlt');
  return {
    id: existing.id || newId(),
    date: input.date,
    amount: Math.round(amount * 100) / 100,
    pot: str(input.pot, 40),
    cat: str(input.cat, 120),
    account: str(input.account, 80),
    note: str(input.note, 300),
    time: /^\d{2}:\d{2}$/.test(input.time || '') ? input.time : '',
    src: input.src ? str(input.src, 200) : existing.src || '',
    by: existing.by || user.name,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: existing.id ? new Date().toISOString() : undefined,
  };
}

function cleanYear(y, year) {
  if (!y || !Array.isArray(y.pots) || !Array.isArray(y.income)) throw httpError(400, 'Budget ungültig');
  const line = (l) => ({ id: str(l.id || newId(), 20), name: str(l.name, 120), expr: str(l.expr ?? '0', 200), freq: Number(l.freq) || 12, note: str(l.note, 300) });
  const keys = new Set();
  return {
    year: Number(year),
    income: y.income.map(line),
    pots: y.pots.map((p) => {
      const key = str(p.key || newId(), 40);
      if (keys.has(key)) throw httpError(400, 'Doppelter Topf-Schlüssel');
      keys.add(key);
      return {
        key,
        name: str(p.name, 80),
        account: str(p.account, 80),
        color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#64748b',
        tracked: !!p.tracked,
        kind: p.kind === 'saving' ? 'saving' : 'expense',
        carryover: Number(p.carryover) || 0,
        lines: (p.lines || []).map(line),
      };
    }),
    note: str(y.note, 2000),
  };
}

function publicData(user) {
  const d = store.data;
  return { rev: d.rev, updatedAt: d.updatedAt, years: d.years, transactions: d.transactions, settlements: d.settlements, settings: d.settings, user, users: auth.listUsers() };
}

// ---------- API ----------
async function api(req, res, url) {
  const method = req.method;
  const p = url.pathname;

  // Schutz gegen Cross-Site-Requests: alle schreibenden Aufrufe brauchen diesen Header
  if (method !== 'GET' && req.headers['x-budget'] !== '1') throw httpError(403, 'Fehlender Header');

  if (p === '/api/status' && method === 'GET') {
    const user = auth.userForToken(cookies(req).sid);
    return send(res, 200, { needsSetup: !auth.hasUsers, user });
  }
  if (p === '/api/setup' && method === 'POST') {
    if (auth.hasUsers) throw httpError(403, 'Bereits eingerichtet');
    const b = await readBody(req);
    auth.createUser(b.name, b.password);
    const { token, user } = auth.login(b.name, b.password, clientIp(req));
    return send(res, 200, { user }, { 'Set-Cookie': sessionCookie(req, token, 90 * 86400) });
  }
  if (p === '/api/login' && method === 'POST') {
    const b = await readBody(req);
    const { token, user } = auth.login(b.name, b.password, clientIp(req));
    return send(res, 200, { user }, { 'Set-Cookie': sessionCookie(req, token, 90 * 86400) });
  }
  if (p === '/api/logout' && method === 'POST') {
    auth.logout(cookies(req).sid);
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  // Ab hier nur angemeldet
  const user = auth.userForToken(cookies(req).sid);
  if (!user) throw httpError(401, 'Nicht angemeldet');

  if (p === '/api/data' && method === 'GET') return send(res, 200, publicData(user));
  if (p === '/api/rev' && method === 'GET') return send(res, 200, { rev: store.rev });

  // Buchungen
  if (p === '/api/tx' && method === 'POST') {
    const b = await readBody(req);
    const list = Array.isArray(b) ? b : [b];
    const created = store.mutate((d) => {
      const out = list.map((t) => cleanTx(t, user));
      d.transactions.push(...out);
      return out;
    });
    return send(res, 200, { rev: store.rev, created });
  }
  let m = p.match(/^\/api\/tx\/([\w-]+)$/);
  if (m && method === 'PUT') {
    const b = await readBody(req);
    const tx = store.mutate((d) => {
      const i = d.transactions.findIndex((t) => t.id === m[1]);
      if (i < 0) throw httpError(404, 'Buchung nicht gefunden');
      d.transactions[i] = cleanTx(b, user, d.transactions[i]);
      return d.transactions[i];
    });
    return send(res, 200, { rev: store.rev, tx });
  }
  if (m && method === 'DELETE') {
    store.mutate((d) => {
      d.transactions = d.transactions.filter((t) => t.id !== m[1]);
    });
    return send(res, 200, { rev: store.rev });
  }
  if (p === '/api/tx/delete' && method === 'POST') {
    const b = await readBody(req);
    const ids = new Set(b.ids || []);
    store.mutate((d) => {
      d.transactions = d.transactions.filter((t) => !ids.has(t.id));
    });
    return send(res, 200, { rev: store.rev });
  }

  // Abrechnungszeitpunkte («Jetzt abrechnen»)
  if (p === '/api/settlements' && method === 'POST') {
    const b = await readBody(req);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(b.at || '')) throw httpError(400, 'Zeitpunkt ungültig');
    const s = store.mutate((d) => {
      if (d.settlements.some((x) => x.at === b.at)) throw httpError(400, 'Diese Abrechnung existiert bereits');
      const item = { id: newId(), at: b.at, note: str(b.note, 200), by: user.name, createdAt: new Date().toISOString() };
      d.settlements.push(item);
      return item;
    });
    return send(res, 200, { rev: store.rev, settlement: s });
  }
  m = p.match(/^\/api\/settlements\/([\w-]+)$/);
  if (m && method === 'DELETE') {
    store.mutate((d) => { d.settlements = d.settlements.filter((x) => x.id !== m[1]); });
    return send(res, 200, { rev: store.rev });
  }

  // Kategorie umbenennen (wenn im Budget eine Zeile umbenannt wird)
  if (p === '/api/tx/rename-cat' && method === 'POST') {
    const b = await readBody(req);
    const year = String(b.year);
    const count = store.mutate((d) => {
      let n = 0;
      for (const t of d.transactions) {
        if (t.pot === b.pot && t.cat === b.from && t.date.startsWith(year + '-')) {
          t.cat = str(b.to, 120);
          n++;
        }
      }
      return n;
    });
    return send(res, 200, { rev: store.rev, count });
  }

  // Budget pro Jahr
  m = p.match(/^\/api\/budget\/(\d{4})$/);
  if (m && method === 'PUT') {
    const b = await readBody(req);
    const year = cleanYear(b, m[1]);
    store.mutate((d) => {
      d.years[m[1]] = year;
    });
    return send(res, 200, { rev: store.rev, year });
  }
  if (m && method === 'DELETE') {
    store.mutate((d) => {
      delete d.years[m[1]];
    });
    return send(res, 200, { rev: store.rev });
  }
  m = p.match(/^\/api\/budget\/(\d{4})\/create$/);
  if (m && method === 'POST') {
    const b = await readBody(req);
    const year = Number(m[1]);
    const created = store.mutate((d) => {
      if (d.years[year]) throw httpError(400, 'Jahr existiert bereits');
      const src = b.from && d.years[b.from];
      const base = src ? structuredClone(src) : createYearTemplate(year);
      base.year = year;
      // Überträge (z.B. Saldo Ferienkonto) kann der Client mitschicken
      if (b.carryover && typeof b.carryover === 'object') {
        for (const pot of base.pots) pot.carryover = Number(b.carryover[pot.key]) || 0;
      } else {
        for (const pot of base.pots) pot.carryover = 0;
      }
      d.years[year] = base;
      return base;
    });
    return send(res, 200, { rev: store.rev, year: created });
  }

  // Einstellungen (Konten, Regeln, Import-Profile)
  if (p === '/api/settings' && method === 'PUT') {
    const b = await readBody(req);
    const settings = store.mutate((d) => {
      if (Array.isArray(b.accounts)) d.settings.accounts = b.accounts.map((a) => str(a, 80)).filter(Boolean);
      if (Array.isArray(b.rules))
        d.settings.rules = b.rules.map((r) => ({ id: str(r.id || newId(), 20), match: str(r.match, 120), pot: str(r.pot, 40), cat: str(r.cat, 120) })).filter((r) => r.match);
      if (Array.isArray(b.importProfiles)) d.settings.importProfiles = b.importProfiles.slice(0, 50);
      return d.settings;
    });
    return send(res, 200, { rev: store.rev, settings });
  }

  // Benutzer
  if (p === '/api/users' && method === 'POST') {
    const b = await readBody(req);
    return send(res, 200, auth.createUser(b.name, b.password));
  }
  m = p.match(/^\/api\/users\/([\w-]+)$/);
  if (m && method === 'DELETE') {
    auth.deleteUser(m[1], user.id);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/password' && method === 'POST') {
    const b = await readBody(req);
    auth.changePassword(user.id, b.oldPassword, b.newPassword);
    return send(res, 200, { ok: true });
  }

  // Sicherung
  if (p === '/api/backup' && method === 'GET') {
    const day = new Date().toISOString().slice(0, 10);
    const { years, transactions, settings, settlements } = store.data;
    return send(res, 200, JSON.stringify({ schema: 1, exportedAt: new Date().toISOString(), years, transactions, settlements, settings }, null, 1), {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="budget-backup-${day}.json"`,
    });
  }
  if (p === '/api/restore' && method === 'POST') {
    const b = await readBody(req);
    if (!b || typeof b.years !== 'object' || !Array.isArray(b.transactions)) throw httpError(400, 'Keine gültige Sicherungsdatei');
    store.replaceAll({ years: b.years, transactions: b.transactions, settlements: b.settlements, settings: b.settings });
    return send(res, 200, { rev: store.rev });
  }

  throw httpError(404, 'Unbekannter API-Aufruf');
}

// ---------- Statische Dateien ----------
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Verboten');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Nicht gefunden');
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // HTML/JS/CSS immer frisch prüfen, damit Updates sofort ankommen
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'"
  );
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Interner Fehler' : e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Kässeli läuft auf http://localhost:${PORT}  (Daten: ${DATA_DIR})`);
  if (!auth.hasUsers) console.log('Noch kein Benutzer vorhanden – beim ersten Aufruf wird ein Konto angelegt.');
});
