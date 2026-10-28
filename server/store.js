// Einfacher, robuster JSON-Datenspeicher.
// - Atomares Schreiben (tmp-Datei + rename), damit bei Stromausfall nichts kaputt geht
// - Tägliche Sicherungskopie in data/backups (die letzten 30 Tage werden behalten)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createTemplate } from './template.js';

export class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'budget.json');
    this.backupDir = path.join(dataDir, 'backups');
    fs.mkdirSync(this.backupDir, { recursive: true });
    this.data = this.#load();
  }

  #load() {
    if (fs.existsSync(this.file)) {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return migrate(raw);
    }
    const fresh = createTemplate(new Date().getFullYear());
    this.#write(fresh);
    return fresh;
  }

  #write(obj) {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
    fs.renameSync(tmp, this.file);
  }

  #dailyBackup() {
    const day = new Date().toISOString().slice(0, 10);
    const target = path.join(this.backupDir, `budget-${day}.json`);
    if (!fs.existsSync(target) && fs.existsSync(this.file)) {
      fs.copyFileSync(this.file, target);
      const files = fs.readdirSync(this.backupDir).filter((f) => /^budget-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      for (const old of files.slice(0, Math.max(0, files.length - 30))) {
        fs.unlinkSync(path.join(this.backupDir, old));
      }
    }
  }

  get rev() {
    return this.data.rev;
  }

  /** Führt eine Änderung aus und speichert. fn bekommt die Daten und darf sie verändern. */
  mutate(fn) {
    this.#dailyBackup();
    const result = fn(this.data);
    this.data.rev = (this.data.rev || 0) + 1;
    this.data.updatedAt = new Date().toISOString();
    this.#write(this.data);
    return result;
  }

  replaceAll(newData) {
    this.#dailyBackup();
    // Vor einer Wiederherstellung immer den aktuellen Stand sichern
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(this.backupDir, `vor-wiederherstellung-${stamp}.json`), JSON.stringify(this.data));
    const migrated = migrate(newData);
    migrated.rev = (this.data.rev || 0) + 1;
    migrated.updatedAt = new Date().toISOString();
    this.data = migrated;
    this.#write(this.data);
  }
}

export function newId() {
  return crypto.randomBytes(6).toString('base64url');
}

/** Bringt ältere/importierte Datenstände auf die aktuelle Struktur. */
export function migrate(d) {
  const out = d && typeof d === 'object' ? d : {};
  out.schema = 1;
  out.rev = out.rev || 1;
  out.years = out.years || {};
  out.transactions = Array.isArray(out.transactions) ? out.transactions : [];
  out.settings = out.settings || {};
  out.settings.accounts = out.settings.accounts || ['Kreditkarte', 'Postkonto', 'Bar'];
  out.settings.rules = out.settings.rules || [];
  out.settings.importProfiles = out.settings.importProfiles || [];
  return out;
}
