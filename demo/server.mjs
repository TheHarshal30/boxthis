
import { createServer } from "node:http";
import { ship } from "../src/ship.mjs";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const CRITICAL_CSS = `<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 system-ui, sans-serif; margin: 0; }
  .hero { padding: 3rem 1.5rem; background: #0b1020; color: #eef; }
  .hero h1 { margin: 0 0 .5rem; font-size: 2rem; }
  main { max-width: 42rem; margin: 0 auto; padding: 1.5rem; }
  .skeleton { height: 1rem; margin: .6rem 0; border-radius: 4px;
    background: linear-gradient(90deg,#2222 25%,#4442 37%,#2222 63%); }
  .comment { padding: .8rem 1rem; border: 1px solid #8884; border-radius: 8px; margin: .6rem 0; }
</style>`;

const HERO = `
  <div class="hero">
    <h1>boxthis</h1>
    <p>This shell painted in the first round-trip — before the comments below existed.</p>
  </div>
  <main>
    <h2>Comments</h2>`;

async function renderComments() {
  await delay(1200);
  const items = ["Streaming HTML is underrated.", "Wait, no client JS?", "First paint felt instant."];
  return (
    items.map((t, i) => `<div class="comment"><b>user${i + 1}</b><br>${t}</div>`).join("") +
    `</main>`
  );
}

const SKELETON = `<div class="skeleton" style="width:90%"></div>
  <div class="skeleton" style="width:75%"></div>
  <div class="skeleton" style="width:82%"></div>`;

const server = createServer(async (req, res) => {
  if (req.url === "/over") {

    await ship(res, { head: CRITICAL_CSS, critical: HERO + SKELETON, deferred: [renderComments], budget: 256 });
    return;
  }

  const result = await ship(res, {
    head: CRITICAL_CSS,
    critical: HERO + SKELETON,

    deferred: [renderComments],
  });

  console.log(
    `  served / — shell ${result.gzip} B gzip (${result.fits ? "fits" : "OVER"}) · ` +
      `floor ${result.networkFloorMs} ms (${result.roundTrips} RTT) · ${result.classification}`
  );
});

server.listen(8014, () => {
  console.log("\n  boxthis demo on http://localhost:8014");
  console.log("  try:  curl --no-buffer -s http://localhost:8014   (watch it arrive in two bursts)");
  console.log("  budget warning demo:  http://localhost:8014/over\n");
});
