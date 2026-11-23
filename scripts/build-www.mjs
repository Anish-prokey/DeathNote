// Copies the static site into www/, which Capacitor packages into the APK.
import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const ROOT = resolve(import.meta.dirname, '..'), OUT = join(ROOT, 'www');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const f of ['index.html', 'style.css', 'app.js', 'cloud.bundle.js']) cpSync(join(ROOT, f), join(OUT, f));
// Stamp the build number the in-app update check compares against the latest GitHub release.
const build = Number(process.env.GITHUB_RUN_NUMBER) || null;
writeFileSync(join(OUT, 'version.js'), `window.TJ_BUILD = ${build};\n`);
console.log(`www/ ready (build ${build ?? 'dev'})`);
