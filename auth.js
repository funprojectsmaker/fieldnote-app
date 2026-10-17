// Password hashing and session helpers. Only Node's built-in crypto is used.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';

const scrypt = promisify(crypto.scrypt);
const KEY_LEN = 64;
export const SESSION_DAYS = 7;
export const COOKIE_NAME = 'fn_session';

// ---------- passwords ----------
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, KEY_LEN);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, salt, hex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hex) return false;
  const key = await scrypt(password, salt, KEY_LEN);
  const expected = Buffer.from(hex, 'hex');
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}

// A fixed hash we check against when the email doesn't exist,
// so "unknown email" and "wrong password" take the same time.
export const DUMMY_HASH = await hashPassword(crypto.randomBytes(12).toString('hex'));

// ---------- sessions ----------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, expiresAt);
  return { token, expiresAt };
}

export function getSessionUser(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.name, u.company, u.email, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?`).get(sha256(token));
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    deleteSession(token);
    return null;
  }
  const { expires_at, ...user } = row;
  return user;
}

export function deleteSession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function deleteExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

export function cookieOptions(expiresAt) {
  return {
    httpOnly: true,                                   // JavaScript can't read it (stops XSS token theft)
    secure: process.env.NODE_ENV === 'production',    // HTTPS only when deployed
    sameSite: 'lax',                                  // not sent on cross-site POSTs (CSRF protection)
    path: '/',
    ...(expiresAt ? { expires: new Date(expiresAt) } : {}),
  };
}
