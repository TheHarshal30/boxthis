
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ship, criticalChunk, DEFAULT_BUDGET } from "../src/ship.mjs";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`  ✅ ${name}`); };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeRes() {
  const writes = [];
  return {
    headersSent: false, statusCode: 0, headers: null, ended: false,
    writeHead(code, h) { this.statusCode = code; this.headers = h; this.headersSent = true; },
    write(c) { writes.push(String(c)); return true; },
    end(c) { if (c != null) writes.push(String(c)); this.ended = true; },
    body() { return writes.join(""); },
    writes,
  };
}

await test("criticalChunk builds and sizes the shell", async () => {
  const c = criticalChunk({ head: "<style>a{}</style>", body: "<h1>hi</h1>" });
  assert.match(c.html, /^<!doctype html><html lang="en"><head><style>a\{\}<\/style><\/head><body><h1>hi<\/h1>$/);
  assert.ok(c.gzip > 0);
  assert.equal(c.fits, true);
});

await test("budget verdict: fits vs over", async () => {
  assert.equal(criticalChunk({ body: "<p>tiny</p>" }).fits, true);
  const big = criticalChunk({ body: "<main><h1>real content</h1><p>not padding</p></main>", budget: 50 });
  assert.equal(big.fits, false);
  assert.ok(big.over > 0);
});

await test("ship writes shell, then deferred, then closes", async () => {
  const res = fakeRes();
  const r = await ship(res, {
    head: "<title>t</title>",
    critical: "<main>SHELL</main>",
    deferred: ["<section>ONE</section>", async () => { await delay(5); return "<section>TWO</section>"; }],
  });
  const body = res.body();
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["x-boxthis"], "fit");

  const iShell = body.indexOf("SHELL"), iOne = body.indexOf("ONE"), iTwo = body.indexOf("TWO"), iClose = body.indexOf("</body>");
  assert.ok(iShell < iOne && iOne < iTwo && iTwo < iClose, "parts must stream in document order");
  assert.equal(r.fits, true);
  assert.ok(res.ended);
});

await test("ship continues after a deferred part rejects", async () => {
  const res = fakeRes();

  await ship(res, {
    deferred: [
      () => Promise.reject(new Error("boom")),
      "<section>AFTER</section>",
    ],
  });

  assert.match(res.body(), /AFTER<\/section><\/body><\/html>$/);
  assert.ok(res.ended);
});

await test("over-budget guard: hook + strict", async () => {
  const shell = "<main><h1>Dashboard</h1><p>welcome back</p></main>";
  let info = null;
  const res = fakeRes();
  await ship(res, { critical: shell, budget: 50, onBudget: (i) => { info = i; } });
  assert.ok(info && info.over > 0, "onBudget should fire with the overage");
  assert.equal(res.headers["x-boxthis"].startsWith("over"), true);

  await assert.rejects(
    () => ship(fakeRes(), { critical: shell, budget: 50, strict: true }),
    /exceeds the .* budget/,
    "strict mode should throw on budget bust"
  );
});

await test("critical must be synchronous", async () => {
  await assert.rejects(
    () => ship(fakeRes(), { critical: async () => "<main>nope</main>" }),
    /must be synchronous/,
  );
});

await test("shell streams before the deferred part (real http)", async () => {
  const server = createServer(async (req, res) => {
    await ship(res, {
      critical: "<main id=shell>SHELL</main>",
      deferred: [async () => { await delay(300); return "<section id=late>LATE</section>"; }],
    });
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const res = await fetch(`http://localhost:${port}/`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let acc = "";
  let shellAt = null, lateAt = null;
  const t0 = performance.now();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    acc += dec.decode(value, { stream: true });
    if (shellAt === null && acc.includes("SHELL")) shellAt = performance.now() - t0;
    if (lateAt === null && acc.includes("LATE")) lateAt = performance.now() - t0;
  }
  await new Promise((r) => server.close(r));

  assert.ok(shellAt !== null && lateAt !== null, "both chunks must arrive");

  assert.ok(shellAt < 150, `shell should arrive fast, got ${shellAt.toFixed(0)}ms`);
  assert.ok(lateAt - shellAt > 200, `deferred chunk should arrive in a separate burst (${(lateAt - shellAt).toFixed(0)}ms gap)`);
});

console.log(`\n  ${passed} passed\n`);
