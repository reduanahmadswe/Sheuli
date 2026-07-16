// Downloads Puppeteer's bundled Chromium (~300MB) after `npm install` — but
// only when it's actually needed. Docker builds set PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
// and use a system-installed Chromium instead (see Dockerfile), so this must
// be skipped there to keep builds fast and avoid a pointless download.
import { execSync } from 'node:child_process';

if (process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD === 'true') {
  console.log('[Sheuli] PUPPETEER_SKIP_CHROMIUM_DOWNLOAD is set — skipping bundled Chromium download.');
  process.exit(0);
}

execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
