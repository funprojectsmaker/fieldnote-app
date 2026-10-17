# Fieldnote — working signup, login & dashboard

A demo SaaS built by Shreyas for his portfolio. The landing page is connected to a real
backend: people can create an account, log in, and manage jobs that are saved in a database.

**Stack:** Node.js + Express 5 · SQLite (built into Node) · plain HTML/CSS/JS frontend

---

## Run it on your computer (Windows)

1. Install **Node.js 22 LTS or newer** from <https://nodejs.org> (choose "LTS").
2. Open the `fieldnote-app` folder, click the address bar, type `cmd`, press Enter.
3. Run:
   ```
   npm install
   npm start
   ```
4. Open <http://localhost:3000> in your browser.
5. Click **Start free trial**, create an account, and you land on the dashboard.

Use `npm run dev` while editing — the server restarts on every save.
The database file is created automatically at `data/fieldnote.db`.

---

## Project structure

```
fieldnote-app/
├── server.js        Express app: pages + JSON API
├── auth.js          password hashing (scrypt) and sessions
├── db.js            SQLite tables: users, sessions, jobs
├── package.json
└── public/          everything the browser loads
    ├── index.html   landing page
    ├── signup.html  create account
    ├── login.html   log in
    ├── app.html     dashboard (logged-in only)
    ├── 404.html
    ├── css/app.css
    └── js/api.js    fetch helper used by every page
```

## API

| Method | Route | What it does | Login needed |
|---|---|---|---|
| POST | `/api/auth/signup` | `{name, company, email, password}` → creates account + logs in | no |
| POST | `/api/auth/login` | `{email, password}` → logs in | no |
| POST | `/api/auth/logout` | ends the session | – |
| GET | `/api/auth/me` | returns the logged-in user | yes |
| GET | `/api/jobs` | lists your jobs | yes |
| POST | `/api/jobs` | `{title, customer, address, scheduled_for, price}` | yes |
| PATCH | `/api/jobs/:id` | `{status: "scheduled" \| "done"}` | yes |
| DELETE | `/api/jobs/:id` | deletes a job | yes |

## How login works (and why it's safe)

1. **Signup:** the password is hashed with `scrypt` and a random salt. The real password is never stored.
2. **Login:** the server checks the hash, then creates a random 256-bit session token.
   Only a SHA-256 hash of the token is stored in the `sessions` table.
3. The token goes to the browser in a cookie that is:
   - `HttpOnly` — page JavaScript can't read it, so an XSS bug can't steal it
   - `SameSite=Lax` + `Secure` in production — not sent on cross-site requests, HTTPS only
4. Every API call that changes data must send the header `X-Requested-With: fetch`.
   Other websites can't add that header, which blocks CSRF attacks.
5. Login and signup are rate-limited (20 tries per 15 minutes per IP) to stop password guessing.
6. "Wrong email" and "wrong password" give the same message and take the same time,
   so attackers can't find out which emails have accounts.
7. Every jobs query includes `WHERE user_id = ?`, so users can only ever see their own data.
8. User input is shown with `textContent`, never `innerHTML`, so it can't inject HTML.
9. Sessions expire after 7 days. `/app` redirects to `/login` when you're logged out.

---

## Put it online (free) with Render

Netlify only hosts static files, so the backend needs a Node host. Render's free plan works:

1. Create a GitHub repository and upload the `fieldnote-app` folder
   (the `.gitignore` already leaves out `node_modules` and `data`).
2. Go to <https://render.com> → **New → Web Service** → connect the repo.
3. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Environment variable:** `NODE_ENV` = `production`
4. Deploy. You get a link like `https://fieldnote-xxxx.onrender.com` to use in your Upwork portfolio.

**Note about the free plan:** the free server sleeps after 15 minutes without visits, and the
first visit after that takes about a minute to wake it. Its disk is temporary: the SQLite file is
wiped when the server sleeps, restarts or redeploys, so demo accounts don't last. That's fine for
a portfolio demo (new signups always work). To keep data permanently, move the database to a
hosted Postgres (for example Neon or Render Postgres), or use a paid Render instance with a disk
mounted at `/var/data` and set `DATABASE_PATH=/var/data/fieldnote.db`.

**If the build fails with an error about `node:sqlite`:** add an environment variable
`NODE_VERSION` = `22` in Render and redeploy.

## Environment variables

| Name | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | port the server listens on (Render sets this for you) |
| `NODE_ENV` | – | set to `production` online so cookies are HTTPS-only |
| `DATABASE_PATH` | `./data/fieldnote.db` | where the SQLite file lives |

## Ideas to extend it (good talking points with clients)

- "Forgot password" email using Resend or SendGrid
- Log in with Google (OAuth)
- Teams: invite techs to the same company account
- Stripe for real subscription billing
