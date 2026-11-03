import fs from 'node:fs';
import path from 'node:path';

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface LogOptions {
  dir: string;
  maxBytes: number;
  keep: number;
  stdout?: boolean;
  file?: string;
}

// Writes to stdout (journald picks that up) and to a size-limited file that can be copied off the VM.
// Log lines carry poster ids, stages, timings and errors. Never IP addresses or topics.
export function createLogger(opts: LogOptions): Logger {
  const file = path.join(opts.dir, opts.file ?? 'cheatwall.log');
  fs.mkdirSync(opts.dir, { recursive: true });

  function rotate(): void {
    for (let i = opts.keep - 1; i >= 1; i--) {
      const from = i === 1 ? file : `${file}.${i - 1}`;
      const to = `${file}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    if (opts.keep <= 1 && fs.existsSync(file)) fs.rmSync(file);
  }

  function write(level: string, msg: string, fields?: Record<string, unknown>): void {
    const line = `${new Date().toISOString()} ${level} ${msg}${fields ? ' ' + JSON.stringify(fields) : ''}\n`;
    if (opts.stdout !== false) process.stdout.write(line);
    try {
      let size = 0;
      try { size = fs.statSync(file).size; } catch { /* no file yet */ }
      if (size + line.length > opts.maxBytes && size > 0) rotate();
      fs.appendFileSync(file, line);
    } catch {
      // A broken log file must never take the service down.
    }
  }

  return {
    info: (m, f) => write('INFO', m, f),
    warn: (m, f) => write('WARN', m, f),
    error: (m, f) => write('ERROR', m, f),
  };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
