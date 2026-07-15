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
- [First run & QR scan](#first-run--qr-scan)
- [Using Sheuli](#using-sheuli)
- [Project structure](#project-structure)
- [Deploying to a Hostinger VPS (Ubuntu)](#deploying-to-a-hostinger-vps-ubuntu)
- [Troubleshooting](#troubleshooting)

---

## What Sheuli does

- Watches your personal WhatsApp chats (never groups, never status/broadcasts).
- When enabled, replies automatically using GPT with a warm, brief, editable personality.
- Remembers the last 10 messages per contact for context.
- Lets you toggle her on/off from the dashboard **or** by texting yourself `/on` / `/off` on WhatsApp.
- Supports a nightly schedule window (e.g. auto-on from 00:00–08:00 Asia/Dhaka).
- Blacklist contacts she should never answer, or flip on whitelist mode to *only* answer approved contacts.
- Rate-limits replies (default: 3 per contact per hour) and adds a human-like typing delay (3–8s).
- Logs every message event (replied / skipped / rate-limited / blacklisted / error) to SQLite.

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
  skipped.

## Project structure

```
sheuli/
├── server/
│   ├── index.js          # Express + Socket.IO bootstrap, starts the WhatsApp client
│   ├── whatsapp.js        # whatsapp-web.js client, message handler, safety rules
│   ├── ai.js              # OpenAI call + conversation/prompt building
│   ├── db.js              # better-sqlite3 schema + queries
│   ├── logger.js          # pino logger
│   ├── config.js          # env + default settings
│   ├── middleware/auth.js # signed-cookie session auth
│   └── routes/            # REST API (auth, settings, contacts, logs, status)
├── dashboard/              # React + Vite + Tailwind app (Sheuli UI)
├── data/                   # SQLite DB + WhatsApp session (created at runtime)
├── logs/                   # PM2 / app log files
├── ecosystem.config.cjs    # PM2 config (process name: sheuli)
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

## Troubleshooting

- **QR code never appears / Puppeteer crashes on the VPS**: almost always a missing Chromium
  dependency — re-run the `apt install` command in step 2 and check `pm2 logs sheuli` for the
  specific missing `.so` file.
- **"WhatsApp disconnected" loops repeatedly**: usually means the linked session was invalidated
  from your phone (Settings → Linked Devices). Delete `data/wwebjs_auth/` and re-scan.
- **OpenAI errors in the logs**: check your API key and billing status at
  platform.openai.com — Sheuli will fall back to a polite generic message rather than staying
  silent, but won't retry automatically.
- **Dashboard shows 401 / keeps logging you out**: make sure `SESSION_SECRET` in `.env` is set
  and stable across restarts (changing it invalidates existing sessions).
