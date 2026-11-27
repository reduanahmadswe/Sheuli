// Hardens whatsapp-web.js against errors after sign-in. Runs on install.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.resolve(__dirname, '../node_modules/whatsapp-web.js/src/Client.js');
const MARKER = 'CRITICAL WWebJS onAppStateHasSyncedEvent error:';

// The library's layout changes between versions, so a patch is only kept if
// the file still parses afterwards.
function parses(code) {
  try {
    new vm.Script(code);
    return true;
  } catch {
    return false;
  }
}

// 1. Still emit 'ready' if the setup after sign-in throws.
function guardReadySetup(code) {
  if (code.includes(MARKER)) return code;
  const start = /^[ \t]*const injected = await this\.pupPage\.evaluate\(async \(\) => \{/m.exec(code);
  if (!start) return code;

  const rest = code.slice(start.index);
  const end = /this\.emit\(Events\.READY\);\s*this\.authStrategy\.afterAuthReady\(\);/.exec(rest);
  if (!end) return code;

  const cut = end.index + end[0].length;
  const patched =
    code.slice(0, start.index) +
    'try {\n' +
    rest.slice(0, cut) +
    `\n} catch (syncErr) {\n  console.error('${MARKER}', syncErr);\n  this.emit(Events.READY);\n}` +
    rest.slice(cut);

  return parses(patched) ? patched : code;
}

// 2. Don't throw if WhatsApp's collections module is not there yet.
function guardCollections(code) {
  const target = "const { Msg, Chat } = window.require('WAWebCollections');";
  if (!code.includes(target)) return code;
  const patched = code.replace(
    target,
    `let Msg = null;
            let Chat = null;
            try {
                const collections = window.require('WAWebCollections');
                Msg = collections?.Msg;
                Chat = collections?.Chat;
            } catch (err) {}`
  );
  return parses(patched) ? patched : code;
}

if (!fs.existsSync(clientPath)) {
  console.log('[patch-wwebjs] Client.js not found, skipping patch.');
} else {
  const original = fs.readFileSync(clientPath, 'utf8').replace(/\r\n/g, '\n');
  const patched = guardCollections(guardReadySetup(original));
  fs.writeFileSync(clientPath, patched, 'utf8');
  console.log(
    patched.includes(MARKER)
      ? '[patch-wwebjs] Patches are active'
      : '[patch-wwebjs] Library layout not recognised — left the ready handler unchanged'
  );
}
