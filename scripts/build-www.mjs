// Copies the static site into www/, which Capacitor packages into the APK.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
const ROOT = resolve(import.meta.dirname, '..'), OUT = join(ROOT, 'www');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const f of ['index.html', 'style.css', 'app.js', 'cloud.bundle.js']) cpSync(join(ROOT, f), join(OUT, f));
console.log('www/ ready');
