# 🌸 Sheuli — She blooms while you sleep

Sheuli (শিউলি) is a personal WhatsApp AI auto-reply assistant. When you're busy or asleep, she
replies to your incoming WhatsApp messages using OpenAI's `gpt-4o-mini`, politely, briefly, and
on your behalf — with per-contact memory, a blacklist/whitelist, rate limiting, and a beautiful
dark dashboard to control it all.

> ⚠️ **Honesty note on risk**: Sheuli is built on [`whatsapp-web.js`](https://github.com/pedroslopez/whatsapp-web.js),
> an **unofficial** library that automates the WhatsApp Web client. It is not sanctioned by WhatsApp/Meta,
> and using any automation on WhatsApp carries a small but real risk of your number being temporarily or
> permanently banned. **Test with a secondary/non-critical WhatsApp number first**, and only move Sheuli to
> your main number once you're comfortable with how she behaves.

---

## Contents

- [What Sheuli does](#what-sheuli-does)
- [Tech stack](#tech-stack)
- [Local setup](#local-setup)
- [Getting an OpenAI API key](#getting-an-openai-api-key)
- [Daily API cost guard](#daily-api-cost-guard)
- [Automatic database backups](#automatic-database-backups)
- [🌅 Daily Summary](#-daily-summary)
- [First run & QR scan](#first-run--qr-scan)
- [Using Sheuli](#using-sheuli)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)

---

## What Sheuli does

- Watches your personal WhatsApp chats (never groups, never status/broadcasts).
- When enabled, replies automatically using GPT with a warm, brief, editable personality.
- Remembers the last 10 messages per contact for context.
- Lets you toggle her on/off from the dashboard **or** by texting yourself `/on` / `/off` on WhatsApp.
- Supports a nightly schedule window (e.g. auto-on from 00:00–08:00 Asia/Dhaka).
- Blacklist contacts she should never answer, or flip on whitelist mode to *only* answer approved contacts.
- Rate-limits replies (default: 10 per contact per hour, configurable 1–100 in Settings, or turn it off entirely
  for unlimited replies — the daily cost guard is still your safety net) and adds a human-like typing delay (3–8s).
- Guards against a surprise bill with a **daily API cost limit** (default $0.50) — auto-replies pause for the rest
  of the day if it's hit, with a dashboard banner.
- **Backs up her SQLite database automatically** every night, keeping the last 7 backups.
- Sends you a **🌅 Daily Summary** each morning on your own WhatsApp chat — who messaged, what mattered, and
  whether she replied — in Bangla. Ask for one anytime with `/summary`.

## Tech stack

| Layer        | Choice                                                    |
|--------------|------------------------------------------------------------|
| Runtime      | Node.js 20+, ES Modules                                    |
| WhatsApp     | `whatsapp-web.js` + `LocalAuth` session persistence         |
| AI           | official `openai` SDK, model `gpt-4o-mini`                  |
| Backend      | Express + `socket.io` (live dashboard updates)              |
| Database     | `better-sqlite3` (contacts, messages, settings)              |
| Dashboard    | React + Vite + Tailwind CSS                                  |

## Local setup

**Prerequisites:** Node.js 20+, npm, and a WhatsApp account on your phone.

```bash
# 1. Clone / copy this project, then install everything (root + dashboard)
npm run install:all

# 2. Copy the environment template and fill in your secrets
cp .env.example .env
```

Edit `.env`:

```
OPENAI_API_KEY=sk-...your-key...
DASHBOARD_PASSWORD=choose-a-strong-password
SESSION_SECRET=some-long-random-string
PORT=3000
TIMEZONE=Asia/Dhaka

BACKUP_TIME=03:00
```

```bash
# 3. Build the dashboard (production bundle served by Express)
npm run build

# 4. Start Sheuli
npm start
```

Open **http://localhost:3000**, log in with your `DASHBOARD_PASSWORD`, and you'll land on the
Overview page.

### Developing the dashboard with hot-reload

If you want to edit the dashboard UI with instant refresh, run these two in separate terminals:

```bash
npm start                 # terminal 1: backend + API on :3000
npm run frontend:dev     # terminal 2: Vite dev server on :5173 (proxies /api and /socket.io to :3000)
```

Then browse **http://localhost:5173** while developing.

## Getting an OpenAI API key

1. Go to <https://platform.openai.com/api-keys> and sign in (or create an account).
2. Click **Create new secret key**, name it (e.g. "sheuli"), and copy it immediately — you won't
   be able to see it again.
3. Make sure your OpenAI account has billing set up (Settings → Billing) — `gpt-4o-mini` is very
   inexpensive, but it isn't free.
4. Paste the key into `.env` as `OPENAI_API_KEY`.


## Daily API cost guard

To protect you from a surprise bill (e.g. someone message-flooding Sheuli), she tracks the real per-call OpenAI
cost (from actual token usage, gpt-4o-mini pricing) and keeps a running total for the day, reset at local midnight
(`TIMEZONE`). Once the daily limit is reached (default **$0.50**, configurable on the Settings page):

- Sheuli stops making OpenAI calls for the rest of the day — incoming messages are logged as `skipped-cost-limit`.
- The dashboard Overview page shows a warning banner until the limit resets at midnight.

## Automatic database backups

Once a day (default **03:00**, `TIMEZONE`, configurable via `BACKUP_TIME` in `.env`), Sheuli makes a safe hot
backup of her SQLite database into `backups/sheuli-YYYY-MM-DD.db` using `better-sqlite3`'s online backup API (not
a raw file copy, which could grab a half-written page). Only the last **7** backups are kept — older ones are
deleted automatically.

## 🌅 Daily Summary

Every morning (default **08:00**, `TIMEZONE`, configurable on the Settings page), Sheuli sends a Bangla recap of
everything that happened in your personal chats since the last summary — to your own **"Message Yourself"**
WhatsApp chat and to the dashboard. It groups messages by urgency (🔴 needs action, 🟡 worth replying to, ⚪
casual), mentions contact names, and stays compact enough to read in one glance. If nothing happened, she sends a
short friendly note instead (or nothing at all, if you turn on "skip if empty" in Settings).

You can also ask for one anytime by sending `/summary` to your own chat — it summarizes everything since the last
summary was sent. Past summaries live on the **Logs → Summaries** tab in the dashboard.

## First run & QR scan

The first time Sheuli starts, she has no saved WhatsApp session yet, so she'll generate a QR code:

1. Start Sheuli (`npm start`) and open the dashboard at `http://localhost:3000`.
2. Log in with your dashboard password. On the **Overview** page you'll see "Waiting for QR scan"
   with a live QR code image (it also prints to the terminal as ASCII art).
3. On your phone: **WhatsApp → Settings → Linked Devices → Link a Device**, then scan the code.
4. Once scanned, the dashboard flips to "Connected" and the session is saved to
   `data/wwebjs_auth/` via `LocalAuth` — you won't need to scan again unless you unlink the device
   or delete that folder.

## Using Sheuli

- **Dashboard toggle**: Overview page → the big switch. "Sheuli is awake 🌸" = auto-replying,
  "Sheuli is resting 🌙" = not replying.
- **WhatsApp commands**: open "Message Yourself" in WhatsApp and send `/on` or `/off`. Sheuli
  replies in that same chat to confirm: *"🌸 Sheuli is now ON"* / *"🌙 Sheuli is now OFF"*.
- **Modes from WhatsApp**: in "Message Yourself", send `/` for the numbered mode list, then `/5` or
  `/lunch` to switch. Add a time to end it automatically: `/lunch 30m`, `/5 2h`.
- **Schedule mode** (Settings page): enable an automatic nightly window (e.g. 00:00–08:00) in
  your timezone — Sheuli turns herself on during that window even if the master switch is off.
- **Contacts page**: blacklist people Sheuli should never answer, or (with whitelist mode on in
  Settings) whitelist the only people she's allowed to answer.
- **Live Messages**: a real-time WhatsApp-style feed of everything coming in and going out.
- **Logs**: a searchable/filterable table of every message event and why it was replied to or
  skipped, plus a **Summaries** tab with every past daily summary.
- **Daily Summary**: sent automatically each morning to your own WhatsApp chat, or on-demand with `/summary`.

## Project structure

```
sheuli/
├── backend/
│   ├── index.js           # Express + Socket.IO bootstrap, starts the WhatsApp client
│   ├── whatsapp.js        # whatsapp-web.js client, message handler, safety rules
│   ├── ai.js              # OpenAI call + conversation/prompt building
│   ├── modes.js           # life modes and their reply instructions
│   ├── schedule.js        # schedule window logic
│   ├── costGuard.js       # daily API cost tracking + limit enforcement
│   ├── backup.js          # SQLite hot backup + pruning
│   ├── summary.js         # daily summary collection + GPT generation + send
│   ├── jobs.js            # per-minute scheduler for backups + daily summary
│   ├── db.js              # better-sqlite3 schema + queries
│   ├── logger.js          # pino logger (stdout + file in production)
│   ├── config.js          # env + default settings, STORAGE_DIR path resolution
│   ├── middleware/auth.js # signed-cookie session auth
│   ├── routes/            # REST API
│   ├── services/          # voice notes, calendar events
│   ├── package.json       # backend dependencies
│   ├── scripts/           # postinstall + whatsapp-web.js patch
│   └── tests/
├── frontend/              # React + Vite + Tailwind app (Sheuli UI)
│
│   ── Everything below lives under STORAGE_DIR (defaults to project root
│      locally; or the STORAGE_DIR env var) ──
├── data/                   # SQLite DB (created at runtime)
├── .wwebjs_auth/            # WhatsApp session, created by LocalAuth (created at runtime)
├── backups/                 # daily SQLite backups (created at runtime, last 7 kept)
├── logs/                   # file logs (created at runtime)
│
├── .env.example
└── package.json
```

## Deploy on Railway

Railway builds from the `Dockerfile` (Node 20 + Chromium). Keep the GitHub repo private.

1. **New Project → Deploy from GitHub repo** and pick this repo.
2. Add a **Volume** to the service with mount path `/app/storage`. Without it, every deploy loses the
   WhatsApp session and database.
3. Under **Variables**, add `OPENAI_API_KEY`, `DASHBOARD_PASSWORD`, `SESSION_SECRET`,
   `TIMEZONE=Asia/Dhaka`, `TZ=Asia/Dhaka` and `STORAGE_DIR=/app/storage`. Do not set `PORT`.
4. **Settings → Networking → Generate Domain**, open it, log in and scan the QR code.

## Troubleshooting

- **QR code never appears / Puppeteer crashes**: almost always a missing Chromium
  dependency — check the server log for the
  specific missing browser or library.
- **Phone shows linked, but dashboard is stuck on "Waiting for QR scan" or `ready` times out**: by default Sheuli
  does not pin a WhatsApp Web version — whatsapp-web.js serves the live/current page, which is what stays
  compatible as WhatsApp updates its web frontend. If `ready` does not fire within 90 seconds after
  `authenticated`, Sheuli's watchdog automatically cleans stale lockfiles and re-initializes the client up to 3
  times. If you experience repeated link hangs, open WhatsApp on your
  phone (`Settings → Linked Devices`), log out of old or duplicate "Google Chrome" sessions, and scan the fresh
  QR code on the dashboard.
- **Pairing succeeds, then WhatsApp instantly logs the session back out (`reason: LOGOUT` within ~2 minutes of
  scanning)**: this is WhatsApp rejecting the web-client version right after accepting the pairing — a
  library/version incompatibility, not an account or device-limit issue. Sheuli detects this pattern, logs a
  specific warning, and shows a matching hint on the dashboard's QR card. Try updating `whatsapp-web.js` to its
  latest published version, or as a stopgap set `WA_WEB_VERSION` in `.env` to a known-good version from
  [wa-version](https://github.com/wppconnect-team/wa-version/tree/main/html). This also counts toward the normal
  loop guard (more than 2 LOGOUT-disconnects within 5 minutes stops auto-retry and waits for a manual QR scan).
- **"WhatsApp disconnected" loops repeatedly**: usually means the linked session was invalidated
  from your phone (Settings → Linked Devices). Delete the `.wwebjs_auth/` folder (under `STORAGE_DIR` — the
  project root by default) and re-scan.
- **OpenAI errors in the logs**: check your API key and billing status at
  platform.openai.com — Sheuli will fall back to a polite generic message rather than staying
  silent, but won't retry automatically.
- **Dashboard shows 401 / keeps logging you out**: make sure `SESSION_SECRET` in `.env` is set
  and stable across restarts (changing it invalidates existing sessions).
- **Daily summary never arrives**: check the server log around the scheduled time — if WhatsApp wasn't
  connected at that moment, Sheuli retries on the next minute's check rather than skipping the day. Make sure
  "Enable daily summary" is on in Settings.
