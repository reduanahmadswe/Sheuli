# syntax=docker/dockerfile:1

# ── Stage 1: build the dashboard (React + Vite) ─────────────────────────────
FROM node:20-slim AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ── Stage 2: production server ──────────────────────────────────────────────
# Node 20 on purpose: better-sqlite3 has no ready-made build for very new Node.
FROM node:20-slim

# System Chromium for whatsapp-web.js, fonts (Bengali + emoji), and the tools
# needed if better-sqlite3 has to compile from source.
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

# Skip Puppeteer's own Chromium download and use the system one.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

COPY package.json ./
COPY backend/package.json backend/package-lock.json ./backend/
COPY backend/scripts/ ./backend/scripts/
RUN npm ci --omit=dev --prefix backend

COPY backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Railway provides PORT at runtime; config.js reads it.
EXPOSE 3000

CMD ["node", "backend/index.js"]
