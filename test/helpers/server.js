// Startet den Kässeli-Server für Tests mit eigenem, leerem Datenordner.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function startServer({ dataDir, env = {} } = {}) {
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'kaesseli-test-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    // Aktualisieren standardmässig aus (kein Zugriff auf GitHub in Tests)
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, UPDATE_ENABLED: 'false', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url + '/api/status');
      if (r.ok) break;
    } catch { /* noch nicht bereit */ }
    if (proc.exitCode !== null) throw new Error('Server beendet:\n' + log);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url,
    dataDir: dir,
    log: () => log,
    async stop() {
      if (proc.exitCode !== null) return;
      proc.kill();
      await new Promise((r) => proc.once('exit', r));
    },
  };
}

/** Kleiner API-Client mit Session-Cookie und dem nötigen Schutz-Header */
export function client(url) {
  let cookie = '';
  const call = async (method, p, body, { header = true } = {}) => {
    const res = await fetch(url + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(header ? { 'X-Budget': '1' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  };
  return { call, get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
}
