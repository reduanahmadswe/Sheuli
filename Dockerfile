# syntax=docker/dockerfile:1

# ── Stage 1: build the dashboard (React + Vite) ─────────────────────────────
FROM node:20-slim AS dashboard-builder

WORKDIR /app/dashboard

COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci

COPY dashboard/ ./
RUN npm run build

# ── Stage 2: production server ──────────────────────────────────────────────
FROM node:20-slim

# System Chromium (no bundled Puppeteer download needed — see below) + fonts,
# including Bengali script support (fonts-noto-core/-ui-core cover Bengali;
# fonts-noto-color-emoji keeps the 🌸/🔴/🟡 emoji Sheuli uses rendering
# correctly), + the shared libs Chromium needs to actually launch headless,
# + python3/make/g++ so better-sqlite3 can compile from source if a prebuilt
# binary isn't available for this platform/Node ABI combo.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-noto-core \
      fonts-noto-ui-core \
      fonts-noto-color-emoji \
      libnss3 \
      libatk-bridge2.0-0 \
      libgtk-3-0 \
      libgbm1 \
      libasound2 \
      ca-certificates \
      python3 \
      make \
      g++ \
    && rm -rf /var/lib/apt/lists/*

# Skip Puppeteer's own ~300MB Chromium download (scripts/postinstall.js checks
# this) — whatsapp-web.js is pointed at the system Chromium installed above.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts/ ./scripts/
RUN npm ci --omit=dev

COPY server/ ./server/
COPY --from=dashboard-builder /app/dashboard/dist ./dashboard/dist

# Railway injects its own PORT at runtime and routes to it regardless of this
# value — config.js already reads process.env.PORT (falling back to 3000
# locally), so this is just documentation/a sane default for `docker run`.
EXPOSE 3000

CMD ["node", "server/index.js"]
