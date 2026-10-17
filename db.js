// Database setup. Uses Node's built-in SQLite (no native packages to install).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.DATABASE_PATH || path.join(import.meta.dirname, 'data', 'fieldnote.db');
fs.mkdirSync(path.dirname(file), { recursive: true });

export const db = new DatabaseSync(file);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    company       TEXT,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- We store a SHA-256 hash of each session token, never the token itself.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    customer      TEXT,
    address       TEXT,
    scheduled_for TEXT,
    price_cents   INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'done')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);
