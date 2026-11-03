// Copies the database to data/backups/ and keeps the newest 14. Run nightly by the systemd timer.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../src/config.ts';
import { loadEnvFile } from '../src/env.ts';

loadEnvFile();
const config = loadConfig();
const dir = path.join(config.dataDir, 'backups');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `cheatwall-${new Date().toISOString().slice(0, 10)}.db`);
fs.rmSync(file, { force: true });
const db = new DatabaseSync(config.dbPath);
db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
db.close();
const old = fs.readdirSync(dir).filter((f) => /^cheatwall-.*\.db$/.test(f)).sort().reverse().slice(14);
for (const f of old) fs.rmSync(path.join(dir, f));
console.log(`backup written: ${file}, removed ${old.length} old`);
