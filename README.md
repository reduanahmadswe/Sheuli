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
- [Telegram alerts (optional but recommended)](#telegram-alerts-optional-but-recommended)
- [Daily API cost guard](#daily-api-cost-guard)
- [Automatic database backups](#automatic-database-backups)
- [🌅 Daily Summary](#-daily-summary)
- [First run & QR scan](#first-run--qr-scan)
- [Using Sheuli](#using-sheuli)
- [Project structure](#project-structure)
- [Deploying to a Hostinger VPS (Ubuntu)](#deploying-to-a-hostinger-vps-ubuntu)
- [Deploy on Railway](#deploy-on-railway)
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
- Logs every message event (replied / skipped / rate-limited / blacklisted / error) to SQLite.
- Sends **Telegram alerts** if she loses WhatsApp connection, crashes, or OpenAI starts failing repeatedly — and
  tells you when she's back online.
- Guards against a surprise bill with a **daily API cost limit** (default $0.50) — auto-replies pause for the rest
  of the day if it's hit, with a dashboard banner and a Telegram alert.
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
| Process mgmt | PM2 (`ecosystem.config.cjs`, process name `sheuli`)          |

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
OWNER_NAME=Reduan

# Optional — see "Telegram alerts" and "Automatic database backups" below
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
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
npm run dashboard:dev     # terminal 2: Vite dev server on :5173 (proxies /api and /socket.io to :3000)
```

Then browse **http://localhost:5173** while developing.

## Getting an OpenAI API key

1. Go to <https://platform.openai.com/api-keys> and sign in (or create an account).
2. Click **Create new secret key**, name it (e.g. "sheuli"), and copy it immediately — you won't
   be able to see it again.
3. Make sure your OpenAI account has billing set up (Settings → Billing) — `gpt-4o-mini` is very
   inexpensive, but it isn't free.
4. Paste the key into `.env` as `OPENAI_API_KEY`.

## Telegram alerts (optional but recommended)

Sheuli runs unattended on a VPS, so it's worth knowing the moment she loses her WhatsApp connection, crashes, or
starts hitting OpenAI errors. She can alert you on Telegram — it's free and takes two minutes to set up.

**1. Create a bot with @BotFather:**

1. Open Telegram and search for **@BotFather** (the official bot for creating bots).
2. Send `/newbot`, give it a name (e.g. "Sheuli Alerts") and a username (must end in `bot`, e.g. `sheuli_alerts_bot`).
3. BotFather replies with a token like `123456789:AAExampleTokenValueHere` — copy it into `.env` as
   `TELEGRAM_BOT_TOKEN`.

**2. Find your chat ID:**

1. Open a chat with your new bot in Telegram and send it any message (e.g. "hi") — you have to message it first,
   bots can't message you until you do.
2. Visit `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates` in a browser (replace `<YOUR_BOT_TOKEN>` with
   the token from step 1).
3. Look for `"chat":{"id":123456789,...}` in the JSON response — that number is your chat ID. Copy it into `.env`
   as `TELEGRAM_CHAT_ID`.
4. Restart Sheuli, then use the **Send test alert** button on the Settings page to confirm it works.

Leave both variables empty to disable alerting entirely — every other feature keeps working normally.

## Daily API cost guard

To protect you from a surprise bill (e.g. someone message-flooding Sheuli), she tracks the real per-call OpenAI
cost (from actual token usage, gpt-4o-mini pricing) and keeps a running total for the day, reset at local midnight
(`TIMEZONE`). Once the daily limit is reached (default **$0.50**, configurable on the Settings page):

- Sheuli stops making OpenAI calls for the rest of the day — incoming messages are logged as `skipped-cost-limit`.
- You get a one-time Telegram alert.
- The dashboard Overview page shows a warning banner until the limit resets at midnight.

## Automatic database backups

Once a day (default **03:00**, `TIMEZONE`, configurable via `BACKUP_TIME` in `.env`), Sheuli makes a safe hot
backup of her SQLite database into `backups/sheuli-YYYY-MM-DD.db` using `better-sqlite3`'s online backup API (not
a raw file copy, which could grab a half-written page). Only the last **7** backups are kept — older ones are
deleted automatically. A failed backup sends a Telegram alert.

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
- **Schedule mode** (Settings page): enable an automatic nightly window (e.g. 00:00–08:00) in
  your timezone — Sheuli turns herself on during that window even if the master switch is off.
- **Contacts page**: blacklist people Sheuli should never answer, or (with whitelist mode on in
  Settings) whitelist the only people she's allowed to answer.
- **Live Messages**: a real-time WhatsApp-style feed of everything coming in and going out.
- **Logs**: a searchable/filterable table of every message event and why it was replied to or
  skipped, plus a **Summaries** tab with every past daily summary.
- **Daily Summary**: sent automatically each morning to your own WhatsApp chat, or on-demand with `/summary`.
- **Telegram alerts**: pings you on disconnects, crashes, repeated OpenAI failures, and cost-limit hits.

## Project structure

```
sheuli/
├── server/
│   ├── index.js          # Express + Socket.IO bootstrap, starts the WhatsApp client
│   ├── whatsapp.js        # whatsapp-web.js client, message handler, safety rules
│   ├── ai.js              # OpenAI call + conversation/prompt building
│   ├── alerts.js          # Telegram alert sender (FEATURE 1)
│   ├── costGuard.js        # daily API cost tracking + limit enforcement (FEATURE 2)
│   ├── backup.js           # SQLite hot backup + pruning (FEATURE 3)
│   ├── summary.js          # daily summary collection + GPT generation + send (FEATURE 4)
│   ├── jobs.js             # per-minute scheduler for backups + daily summary
│   ├── db.js              # better-sqlite3 schema + queries
│   ├── logger.js          # pino logger (stdout + file in production)
│   ├── config.js          # env + default settings, STORAGE_DIR path resolution
│   ├── middleware/auth.js # signed-cookie session auth
│   └── routes/            # REST API (auth, settings, contacts, logs, status, summaries)
├── dashboard/              # React + Vite + Tailwind app (Sheuli UI)
├── scripts/
│   └── postinstall.js     # conditionally downloads Puppeteer's Chromium (skipped in Docker)
├── Dockerfile               # multi-stage build for Railway/any container platform
├── .dockerignore
│
│   ── Everything below lives under STORAGE_DIR (defaults to project root
│      locally; a mounted Volume path like /app/storage on Railway) ──
├── data/                   # SQLite DB (created at runtime)
├── .wwebjs_auth/            # WhatsApp session, created by LocalAuth (created at runtime)
├── backups/                 # daily SQLite backups (created at runtime, last 7 kept)
├── logs/                   # file logs (created at runtime)
│
├── ecosystem.config.cjs    # PM2 config for VPS deploys (process name: sheuli)
├── .env.example
└── package.json
```

## Deploying to a Hostinger VPS (Ubuntu 22.04 / 24.04)

These steps assume a fresh Hostinger VPS running Ubuntu, accessed via SSH as a sudo-capable user.

### 1. Update the system and install Node.js 20

```bash
sudo apt update && sudo apt upgrade -y

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should print v20.x
```

### 2. Install Chromium/Puppeteer dependencies

`whatsapp-web.js` drives a headless Chromium via Puppeteer, which needs a set of system libraries
that aren't installed on a minimal Ubuntu server:

```bash
sudo apt install -y \
  libnss3 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
  libpangocairo-1.0-0 libpango-1.0-0 libgtk-3-0 libx11-xcb1 \
  fonts-liberation libappindicator3-1 xdg-utils ca-certificates wget
```

### 3. Install PM2 globally

```bash
sudo npm install -g pm2
```

### 4. Upload the project and install dependencies

```bash
# From your local machine
scp -r sheuli/ your-user@your-vps-ip:/home/your-user/

# On the VPS
cd ~/sheuli
npm run install:all
```

### 5. Configure environment

```bash
cp .env.example .env
nano .env   # fill in OPENAI_API_KEY, DASHBOARD_PASSWORD, SESSION_SECRET, etc.
```

Set `DASHBOARD_PASSWORD` to something strong — this dashboard will be reachable from the public
internet unless you firewall it. Consider also restricting the port via `ufw` to your own IP, or
putting it behind an SSH tunnel / reverse proxy with HTTPS (e.g. Nginx + Let's Encrypt) since the
login form transmits your password in plaintext over HTTP if you don't add TLS.

### 6. Build the dashboard

```bash
npm run build
```

### 7. Start Sheuli with PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

### 8. Enable PM2 auto-start on reboot

```bash
pm2 startup systemd
# PM2 will print a command starting with "sudo env PATH=..." — copy/paste and run that exact command
pm2 save
```

Now if the VPS reboots, PM2 will bring Sheuli back up automatically.

### 9. Scan the QR code on a headless VPS

You have two options:

- **Via the dashboard (recommended)**: open `http://your-vps-ip:3000` (or your domain, ideally
  behind HTTPS), log in, and scan the QR shown on the Overview page with your phone.
- **Via SSH terminal**: run `pm2 logs sheuli` right after starting — the QR is also printed as
  ASCII art in the logs, and can be scanned directly from a terminal that renders it clearly
  (a wide enough terminal window, monospace font).

Once scanned, the session persists in `data/wwebjs_auth/` on the VPS, so Sheuli reconnects
automatically after restarts without scanning again.

### Useful PM2 commands

```bash
pm2 status            # check if sheuli is running
pm2 logs sheuli        # tail logs
pm2 restart sheuli     # restart after a config change
pm2 stop sheuli        # stop
```

### Downloading backups off the VPS

Sheuli keeps her last 7 nightly backups in `backups/` on the VPS (see
[Automatic database backups](#automatic-database-backups)). To copy the latest one to your local machine:

```bash
scp your-user@your-vps-ip:~/sheuli/backups/sheuli-2026-07-17.db ./
```

## Deploy on Railway

Sheuli ships with a `Dockerfile`, so Railway can build and run her directly from your GitHub repo — no VPS/SSH
required. A headless browser session (WhatsApp) and a SQLite database need a real disk to survive redeploys, so
this setup uses a Railway **Volume** for persistence.

> ⚠️ **Push to a PRIVATE repo.** Your repo will contain your dashboard's auth flow and (once deployed) implicitly
> represent your linked WhatsApp number. Never make it public, and never commit `.env` or any session folder
> (`.wwebjs_auth/`, `data/`, `backups/`, `logs/`) — `.gitignore` already excludes all of these, but double-check
> `git status` before your first push if you've ever run Sheuli locally in this same folder.

### 1. Push to a private GitHub repo

```bash
git init                      # if not already a git repo
git add .
git commit -m "Sheuli — ready for Railway"
```

Create a new **private** repository on GitHub and push this project to it.

### 2. Create the Railway project

1. Go to [railway.app](https://railway.app), sign in, and click **New Project**.
2. Choose **Deploy from GitHub repo**, and select your private Sheuli repo.
3. Railway detects the `Dockerfile` and builds from it automatically — no extra configuration needed for the
   build itself.

### 3. Add a persistent Volume

Everything outside a mounted Volume is wiped on every deploy/restart, so this step is required — without it,
Sheuli would lose her WhatsApp session and database every time you redeploy.

1. In your Railway service, open the **Volumes** tab (or **Settings → Volumes**).
2. Create a new Volume and set its **mount path** to `/app/storage`.

### 4. Set environment variables

In **Settings → Variables**, add:

| Variable | Value |
|---|---|
| `OPENAI_API_KEY` | your OpenAI key |
| `DASHBOARD_PASSWORD` | a strong password |
| `SESSION_SECRET` | a long random string |
| `TIMEZONE` | `Asia/Dhaka` |
| `OWNER_NAME` | `Reduan` |
| `TELEGRAM_BOT_TOKEN` | *(optional — see [Telegram alerts](#telegram-alerts-optional-but-recommended))* |
| `TELEGRAM_CHAT_ID` | *(optional)* |
| `STORAGE_DIR` | `/app/storage` — **must match the Volume's mount path from step 3** |

Do **not** set `PORT` — Railway injects it automatically, and `config.js` already reads `process.env.PORT`.

### 5. Generate a domain and open the dashboard

1. In **Settings → Networking**, click **Generate Domain**.
2. Railway will build the image (installing system Chromium per the `Dockerfile`) and start the container.
3. Once the deploy is healthy, open the generated `https://your-app.up.railway.app` URL.
4. Log in with your `DASHBOARD_PASSWORD`.
5. On the **Overview** page, scan the QR code with WhatsApp (**Settings → Linked Devices → Link a Device**), same
   as local/VPS setup.

Because `STORAGE_DIR` points at the mounted Volume, the linked session and SQLite database persist across every
future redeploy — you won't need to re-scan unless you unlink the device or delete the Volume.

### Notes

- **Healthcheck**: Sheuli exposes `GET /health` (no login required), returning
  `{ status: 'ok', whatsapp: 'connected' | 'disconnected', uptime }` — Railway can use this as a healthcheck path
  in **Settings → Deploy** if you want one.
- **Redeploys**: Railway sends `SIGTERM` before stopping the old container; Sheuli shuts down cleanly (closes the
  WhatsApp client and the database) before the new one starts.
- **Logs**: Sheuli logs to stdout in production (in addition to a file under the Volume), so `railway logs` /
  the Railway dashboard's log viewer shows everything in real time.
- **Local dev is unaffected**: `STORAGE_DIR` only needs to be set on Railway (or any container deploy). Leave it
  unset locally and everything — DB, session, backups, logs — stays exactly where it always has, at the project
  root.

## Troubleshooting

- **QR code never appears / Puppeteer crashes on the VPS**: almost always a missing Chromium
  dependency — re-run the `apt install` command in step 2 and check `pm2 logs sheuli` for the
  specific missing `.so` file.
- **"WhatsApp disconnected" loops repeatedly**: usually means the linked session was invalidated
  from your phone (Settings → Linked Devices). Delete the `.wwebjs_auth/` folder (under `STORAGE_DIR` — the
  project root locally, the Volume on Railway/a VPS) and re-scan.
- **OpenAI errors in the logs**: check your API key and billing status at
  platform.openai.com — Sheuli will fall back to a polite generic message rather than staying
  silent, but won't retry automatically.
- **Dashboard shows 401 / keeps logging you out**: make sure `SESSION_SECRET` in `.env` is set
  and stable across restarts (changing it invalidates existing sessions).
- **Telegram test alert fails**: double-check `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`, and that
  you've sent the bot at least one message first (bots can't message you until you message them). Restart Sheuli
  after editing `.env`.
- **Daily summary never arrives**: check `pm2 logs sheuli` around the scheduled time — if WhatsApp wasn't
  connected at that moment, Sheuli retries on the next minute's check rather than skipping the day. Make sure
  "Enable daily summary" is on in Settings.
- **(Railway) Lost the WhatsApp session / database after a redeploy**: `STORAGE_DIR` almost certainly isn't set
  to the same path as the Volume's mount path — double-check both are exactly `/app/storage` (or whatever path
  you chose), and that the Volume is actually attached to the service.
- **(Railway) Deploy succeeds but WhatsApp never connects / Puppeteer errors in logs**: check the build logs for
  the `apt-get install` step — if it failed, `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` will point at a
  Chromium that doesn't exist. Also confirm you didn't override `PUPPETEER_EXECUTABLE_PATH` yourself in Railway's
  Variables — the `Dockerfile` already sets it correctly.
- **(Railway) Bengali text renders as boxes/tofu in a debug screenshot**: shouldn't happen — the `Dockerfile`
  installs `fonts-noto-core`/`fonts-noto-ui-core` (Bengali) and `fonts-noto-color-emoji` — but if you customized
  the `Dockerfile`'s font list, restore those three packages.
