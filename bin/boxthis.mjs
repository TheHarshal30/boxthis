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

async function findLightsoutBin() {
  const candidates = [
    new URL("../../lightsout/bin/lightsout.mjs", import.meta.url),
    new URL("../node_modules/lightsoutt/bin/lightsout.mjs", import.meta.url),
    new URL("../../node_modules/lightsoutt/bin/lightsout.mjs", import.meta.url),
  ].map(fileURLToPath);
  for (const c of candidates) {
    try {
      await access(c);
      return c;
    } catch {}
  }
  return null;
}

function runLightsout(bin, url, rtt) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, url, "--fcp", "--json", "--rtt", String(rtt)], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);

    child.on("close", () => {
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error(`lightsout produced no parseable JSON.${err ? " " + err.trim() : ""}`));
      }
    });
  });
}

const CLASS_ICON = { "Floor-limited": "✅", Efficient: "✅", "Moderately delayed": "⚠️ ", "JS-taxed": "⚠️ ", "JS-bound": "❌" };
const ms = (n) => `${Math.round(n).toLocaleString()} ms`;

async function audit(opts) {
  if (!opts.url) {
    console.error("usage: boxthis audit <url> [--target 0.8] [--rtt 150]");
    process.exit(2);
  }
  const bin = await findLightsoutBin();
  if (!bin) {
    console.error("boxthis audit: needs the `lightsout` package to measure PRR (it's the companion tool). Install it alongside boxthis.");
    process.exit(2);
  }

  const report = await runLightsout(bin, opts.url, opts.rtt);
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
