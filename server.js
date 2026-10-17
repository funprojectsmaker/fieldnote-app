// Fieldnote demo backend: serves the website and a small JSON API.
import express from 'express';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { db } from './db.js';
import {
  hashPassword, verifyPassword, DUMMY_HASH,
  createSession, getSessionUser, deleteSession, deleteExpiredSessions,
  cookieOptions, COOKIE_NAME,
} from './auth.js';

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(import.meta.dirname, 'public');

app.set('trust proxy', 1);          // correct client IPs behind Render/Railway proxies
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());

// Basic security headers
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  next();
});

// ---------- helpers ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function currentUser(req) {
  return getSessionUser(req.cookies[COOKIE_NAME]);
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Please log in to continue.' });
  req.user = user;
  next();
}

// Every API request that changes data must come from our own pages' fetch() calls.
// Browsers won't let another website add this header without our permission (CSRF protection).
function requireFetchHeader(req, res, next) {
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'fetch') {
    return res.status(403).json({ error: 'Request blocked.' });
  }
  next();
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait 15 minutes and try again.' },
});

function startSession(res, userId) {
  const { token, expiresAt } = createSession(userId);
  res.cookie(COOKIE_NAME, token, cookieOptions(expiresAt));
}

// ---------- auth API ----------
const api = express.Router();
api.use(requireFetchHeader);

api.post('/auth/signup', authLimiter, async (req, res) => {
  const name = clean(req.body?.name, 80);
  const company = clean(req.body?.company, 120);
  const email = clean(req.body?.email, 254).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  const errors = {};
  if (!name) errors.name = 'Enter your name.';
  if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';
  if (password.length < 8) errors.password = 'Use at least 8 characters.';
  else if (password.length > 128) errors.password = 'Use 128 characters or fewer.';
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'An account with this email already exists.', fields: { email: 'This email is already registered. Try logging in.' } });
  }

  const hash = await hashPassword(password);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (name, company, email, password_hash) VALUES (?, ?, ?, ?)')
    .run(name, company || null, email, hash);

  const userId = Number(lastInsertRowid);
  seedDemoJobs(userId);
  startSession(res, userId);
  res.status(201).json({ user: { id: userId, name, company, email } });
});

api.post('/auth/login', authLimiter, async (req, res) => {
  const email = clean(req.body?.email, 254).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  const row = db.prepare('SELECT id, name, company, email, password_hash FROM users WHERE email = ?').get(email);
  const ok = await verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) return res.status(401).json({ error: 'Email or password is incorrect.' });

  startSession(res, row.id);
  const { password_hash, ...user } = row;
  res.json({ user });
});

api.post('/auth/logout', (req, res) => {
  deleteSession(req.cookies[COOKIE_NAME]);
  res.clearCookie(COOKIE_NAME, cookieOptions());
  res.json({ ok: true });
});

api.get('/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

// ---------- jobs API (each user only ever sees their own rows) ----------
const jobSelect = 'SELECT id, title, customer, address, scheduled_for, price_cents, status, created_at FROM jobs';

api.get('/jobs', requireAuth, (req, res) => {
  const jobs = db.prepare(`${jobSelect} WHERE user_id = ? ORDER BY status = 'done', scheduled_for IS NULL, scheduled_for, id DESC`).all(req.user.id);
  res.json({ jobs });
});

api.post('/jobs', requireAuth, (req, res) => {
  const title = clean(req.body?.title, 120);
  const customer = clean(req.body?.customer, 120);
  const address = clean(req.body?.address, 200);
  const scheduled = clean(req.body?.scheduled_for, 16);
  const price = Number(req.body?.price);

  const errors = {};
  if (!title) errors.title = 'Describe the job.';
  if (scheduled && Number.isNaN(Date.parse(scheduled))) errors.scheduled_for = 'Pick a valid date and time.';
  if (req.body?.price !== '' && req.body?.price != null && (!Number.isFinite(price) || price < 0 || price > 1e6)) errors.price = 'Enter a price between 0 and 1,000,000.';
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });

  const priceCents = Number.isFinite(price) ? Math.round(price * 100) : 0;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO jobs (user_id, title, customer, address, scheduled_for, price_cents) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user.id, title, customer || null, address || null, scheduled || null, priceCents);
  const job = db.prepare(`${jobSelect} WHERE id = ?`).get(lastInsertRowid);
  res.status(201).json({ job });
});

api.patch('/jobs/:id', requireAuth, (req, res) => {
  const status = req.body?.status;
  if (!['scheduled', 'done'].includes(status)) return res.status(400).json({ error: 'Status must be "scheduled" or "done".' });
  const result = db.prepare('UPDATE jobs SET status = ? WHERE id = ? AND user_id = ?').run(status, Number(req.params.id), req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Job not found.' });
  res.json({ job: db.prepare(`${jobSelect} WHERE id = ?`).get(Number(req.params.id)) });
});

api.delete('/jobs/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM jobs WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Job not found.' });
  res.json({ ok: true });
});

api.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use('/api', api);

// New accounts start with a few example jobs so the dashboard isn't empty.
function seedDemoJobs(userId) {
  const day = (offset, hour) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(hour, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  };
  const insert = db.prepare('INSERT INTO jobs (user_id, title, customer, address, scheduled_for, price_cents, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insert.run(userId, 'Water heater replacement (example)', 'Dana Whitfield', '1148 Elm St', day(0, 9), 145000, 'scheduled');
  insert.run(userId, 'Kitchen drain clear (example)', 'Oakwood Apartments #4', '220 Oak Ave', day(0, 13), 14900, 'scheduled');
  insert.run(userId, 'Furnace tune-up (example)', 'Raj Patel', '22 Maple Ct', day(1, 10), 11900, 'scheduled');
  insert.run(userId, 'Leak repair under sink (example)', 'Mia Chen', '87 Birch Ln', day(-1, 15), 18900, 'done');
}

// ---------- pages ----------
// Logged-in users skip the login/signup pages; logged-out users can't open the dashboard.
app.get(['/login', '/login.html', '/signup', '/signup.html'], (req, res, next) => {
  if (currentUser(req)) return res.redirect('/app');
  next();
});
app.get(['/app', '/app.html'], (req, res, next) => {
  if (!currentUser(req)) return res.redirect('/login?next=/app');
  next();
});

app.use(express.static(PUBLIC, { extensions: ['html'] }));

app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, '404.html')));

// Catch-all error handler: log the real error, show a safe message.
app.use((err, req, res, next) => {
  console.error(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request body.' });
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

deleteExpiredSessions();
setInterval(deleteExpiredSessions, 60 * 60 * 1000).unref();

app.listen(PORT, () => console.log(`Fieldnote running at http://localhost:${PORT}`));
