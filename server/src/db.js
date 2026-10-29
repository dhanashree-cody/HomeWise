import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
mkdirSync(dataDir, { recursive: true });

export const DB_PATH = process.env.HEMOWISE_DB || join(dataDir, 'hemowise.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');

export function migrate() {
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
}

/** Run a statement and return { changes, lastInsertRowid }. */
export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}
/** First matching row, or undefined. */
export function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}
/** All matching rows. */
export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

/**
 * Wrap fn in a transaction. node:sqlite has no helper for this, so we drive
 * BEGIN/COMMIT/ROLLBACK directly. Nested calls reuse the outer transaction.
 */
let depth = 0;
export function tx(fn) {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}

export const nowIso = () => new Date().toISOString();
