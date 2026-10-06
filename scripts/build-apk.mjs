/**
 * Build an installable Android APK of the journal.
 *
 *   npm run apk
 *
 * Builds the web app, copies it into the Capacitor Android project, compiles a
 * debug APK and drops it at the repo root as TradingJournal-debug.apk, ready to
 * copy to a phone. A debug build installs directly on any device that allows
 * "install unknown apps"; the Play Store needs a signed release bundle instead,
 * which is a separate step.
 *
 * Needs Java 21 — Capacitor 8's Android library is compiled for it and nothing
 * older will build it. Set ANDROID_JAVA_HOME (or JAVA_HOME) to a JDK 21, or put
 * one at E:\tools\jdk-21, which is where it lives on the machine this was
 * written on.
 *
 * Gradle's cache defaults to E:\tools\gradle-home rather than the usual
 * ~/.gradle. The first build pulls several hundred MB into it, and C: on that
 * machine was down to 12 GB. Override with GRADLE_USER_HOME.
 */
import { spawnSync } from "node:child_process";
import { existsSync, copyFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const ANDROID = join(ROOT, "android");
const WIN = process.platform === "win32";

/** The JDK's major version, or 0 if the path is not a working JDK. */
function javaMajor(home) {
  const bin = join(home, "bin", WIN ? "java.exe" : "java");
  // A JDK folder can outlive its uninstall and be left empty — that is exactly
  // what the stale JDK 17 on the original machine turned out to be.
  if (!existsSync(bin)) return 0;
  // `java -version` prints to stderr and exits 0, so the answer is in the
  // stream, not in an exception that never comes.
  const r = spawnSync(bin, ["-version"], { encoding: "utf8" });
  const m = `${r.stderr ?? ""}${r.stdout ?? ""}`.match(/version "(\d+)(?:\.(\d+))?/);
  if (!m) return 0;
  // Java 8 and earlier call themselves "1.8".
  return m[1] === "1" ? Number(m[2]) : Number(m[1]);
}

const CANDIDATES = [
  ...new Set(
    [process.env.ANDROID_JAVA_HOME, process.env.JAVA_HOME, "E:\\tools\\jdk-21"].filter(Boolean),
  ),
];

function findJdk21() {
  for (const home of CANDIDATES) {
    if (javaMajor(home) >= 21) return home;
  }
  return null;
}

// `npm run apk -- --which-java`: say what each candidate is, then stop.
if (process.argv.includes("--which-java")) {
  for (const home of CANDIDATES) console.log(`${javaMajor(home) || "none"}\t${home}`);
  const pick = findJdk21();
  console.log(pick ? `\nwould build with ${pick}` : "\nno JDK 21 among these");
  process.exit(0);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: WIN, ...opts });
  if (r.status !== 0) {
    console.error(`\n${cmd} ${args.join(" ")} failed (exit ${r.status}).`);
    process.exit(r.status || 1);
  }
}

const jdk = findJdk21();
if (!jdk) {
  console.error(
    "No JDK 21 found. Capacitor 8 needs Java 21 to build the Android app.\n" +
      "Install one (e.g. Eclipse Temurin 21 from adoptium.net) and set ANDROID_JAVA_HOME to it.",
  );
  process.exit(1);
}

const env = {
  ...process.env,
  JAVA_HOME: jdk,
  GRADLE_USER_HOME: process.env.GRADLE_USER_HOME || "E:\\tools\\gradle-home",
};

console.log(`Using JDK at ${jdk}`);
console.log(`Gradle cache at ${env.GRADLE_USER_HOME}\n`);

console.log("1/3  Bundling Firebase and copying the site");
run("npm", ["run", "bundle"], { cwd: ROOT });
run("npm", ["run", "build:www"], { cwd: ROOT });

console.log("\n2/3  Copying it into the Android project");
run("npx", ["cap", "sync", "android"], { cwd: ROOT });

console.log("\n3/3  Compiling the APK");
// By absolute path, not bare name. A bare `gradlew.bat` was not found through
// cmd even with cwd set to the project: cmd skips the working directory when
// NoDefaultCurrentDirectoryInExePath is set. Quoted so a checkout path with
// spaces survives the trip through the shell.
const gradlew = join(ANDROID, WIN ? "gradlew.bat" : "gradlew");
run(WIN ? `"${gradlew}"` : gradlew, ["assembleDebug", "--console=plain"], { cwd: ANDROID, env });

const built = join(ANDROID, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const out = join(ROOT, "TradingJournal-debug.apk");
copyFileSync(built, out);
const mb = (statSync(out).size / 1048576).toFixed(1);
console.log(`\nDone: ${out}  (${mb} MB)`);
