#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";

const DEFAULT_TARGET = 0.8;

function parseArgs(argv) {
  const o = { cmd: null, url: null, target: DEFAULT_TARGET, rtt: 150 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target") o.target = Number(argv[++i]);
    else if (a === "--rtt") o.rtt = Number(argv[++i]);
    else if (!o.cmd) o.cmd = a;
    else if (!o.url) o.url = a;
  }
  return o;
}

// Locate a lightsoutt bin FILE next to us (dev sibling, or an installed dep).
async function findLocalBin() {
  const candidates = [
    new URL("../../lightsout/bin/lightsout.mjs", import.meta.url),
    new URL("../node_modules/lightsoutt/bin/lightsout.mjs", import.meta.url),
    new URL("../../node_modules/lightsoutt/bin/lightsout.mjs", import.meta.url),
  ].map(fileURLToPath);
  for (const c of candidates) { try { await access(c); return c; } catch {} }
  return null;
}

// Spawn `cmd args` and resolve lightsoutt's JSON report from stdout. Rejects with
// code "ENOENT" when the command isn't found, so the caller can try another way.
function spawnJson(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject); // ENOENT when the command doesn't exist
    child.on("close", () => {
      const s = out.indexOf("{"), e = out.lastIndexOf("}"); // tolerate a stray wrapper line
      if (s !== -1 && e > s) { try { return resolve(JSON.parse(out.slice(s, e + 1))); } catch {} }
      reject(new Error(`lightsoutt produced no parseable JSON.${err ? " " + err.trim().split("\n").pop() : ""}`));
    });
  });
}

// Measure paint readiness via lightsoutt. Tries, in order: a resolvable bin file,
// the `lightsoutt` command on PATH (a global install), then `npx -y lightsoutt`
// (fetches it). So `boxthis audit` works whether boxthis is global, local, or npx.
async function measurePaint(url, rtt) {
  const args = [url, "--fcp", "--json", "--rtt", String(rtt)];
  const localBin = await findLocalBin();
  const attempts = [];
  if (localBin) attempts.push([process.execPath, [localBin, ...args]]);
  attempts.push(["lightsoutt", args]);
  attempts.push(["npx", ["-y", "lightsoutt", ...args]]);

  let lastErr;
  for (const [cmd, a] of attempts) {
    try { return await spawnJson(cmd, a); }
    catch (e) { lastErr = e; if (e && e.code === "ENOENT") continue; throw e; }
  }
  throw lastErr || new Error("could not run lightsoutt");
}

const CLASS_ICON = { "Floor-limited": "✅", Efficient: "✅", "Moderately delayed": "⚠️ ", "JS-taxed": "⚠️ ", "JS-bound": "❌" };
const ms = (n) => `${Math.round(n).toLocaleString()} ms`;

async function audit(opts) {
  if (!opts.url) {
    console.error("usage: boxthis audit <url> [--target 0.8] [--rtt 150]");
    process.exit(2);
  }
  let report;
  try {
    report = await measurePaint(opts.url, opts.rtt);
  } catch (e) {
    console.error("boxthis audit: couldn't measure with lightsoutt (the companion tool).");
    console.error("  install it:  npm i -g lightsoutt");
    console.error("  detail: " + (e && e.message ? e.message : e));
    process.exit(2);
  }
  const floor = report.criticalPath?.networkFloorMs;
  const fcp = report.paint?.fcpMs;
  const prr = report.paint?.paintReadiness;
  const cls = report.paint?.classification;

  console.log(`\n  boxthis audit — ${opts.url}`);
  console.log("  " + "═".repeat(52));
  if (prr == null) {
    console.log("  paint readiness   — page never painted within the timeout");
    console.log("\n  ❓ inconclusive — could not measure FCP.");
    process.exit(2);
  }

  const pass = prr >= opts.target;
  const icon = CLASS_ICON[cls] ?? "";
  console.log(`  paint readiness   ${prr.toFixed(2)}   ${icon} ${cls}`);
  console.log(`  network floor     ${ms(floor)}`);
  console.log(`  actual FCP        ${ms(fcp)}   (measured in headless Chrome)`);
  console.log();
  console.log(`  boxthis target    PRR ≥ ${opts.target.toFixed(2)}   ${pass ? "✅ PASS" : "❌ FAIL"}`);
  if (!pass) {
    console.log();
    console.log("  to reach the target: stream a JS-free critical shell with boxthis so the");
    console.log("  page paints on arrival, and move client JS off the critical path.");
  }
  console.log();
  process.exit(pass ? 0 : 1);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.cmd === "audit") return audit(opts);
  console.error("boxthis — usage:\n  boxthis audit <url> [--target 0.8] [--rtt 150]   measure a served page's paint readiness");
  process.exit(2);
}

main().catch((e) => {
  console.error("boxthis: " + e.message);
  process.exit(2);
});
