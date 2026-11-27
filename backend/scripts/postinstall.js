// Runs after `npm install`. Downloads Puppeteer's bundled Chromium (~300MB)
// only when needed: the Dockerfile sets PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
// and uses a system Chromium instead.
import { execSync } from 'node:child_process';

if (process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD === 'true') {
  console.log('[Sheuli] PUPPETEER_SKIP_CHROMIUM_DOWNLOAD is set — skipping bundled Chromium download.');
} else {
  execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
}

// Patch whatsapp-web.js in every environment, including Docker.
import('./patch-wwebjs.js').catch((err) => {
  console.warn('[Sheuli] Failed to apply wwebjs patch:', err.message);
});
