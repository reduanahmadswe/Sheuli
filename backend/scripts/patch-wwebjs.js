import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.resolve(__dirname, '../node_modules/whatsapp-web.js/src/Client.js');

if (!fs.existsSync(clientPath)) {
  console.log('[patch-wwebjs] Client.js not found, skipping patch.');
  process.exit(0);
}

let code = fs.readFileSync(clientPath, 'utf8');

// 1. Post-auth setup try/catch
if (!code.includes('CRITICAL WWebJS onAppStateHasSyncedEvent error:')) {
  const target = `                const injected = await this.pupPage.evaluate(async () => {`;
  if (code.includes(target)) {
    const replacement = `                try {\n                    const injected = await this.pupPage.evaluate(async () => {`;
    code = code.replace(target, replacement);

    const endTarget = `                this.emit(Events.READY);
                this.authStrategy.afterAuthReady();
            },`;
    const endReplacement = `                    this.emit(Events.READY);
                    this.authStrategy.afterAuthReady();
                } catch (syncErr) {
                    console.error('CRITICAL WWebJS onAppStateHasSyncedEvent error:', syncErr);
                    this.emit(Events.READY);
                }
            },`;
    code = code.replace(endTarget, endReplacement);
  }
}

// 2. Safe attachEventListeners
if (code.includes('const { Msg, Chat } = window.require(\'WAWebCollections\');')) {
  code = code.replace(
    `            const { Msg, Chat } = window.require('WAWebCollections');`,
    `            let Msg = null;
            let Chat = null;
            try {
                const collections = window.require('WAWebCollections');
                Msg = collections?.Msg;
                Chat = collections?.Chat;
            } catch (err) {}`
  );
}

fs.writeFileSync(clientPath, code, 'utf8');
console.log('[patch-wwebjs] Successfully ensured whatsapp-web.js patches are active');
