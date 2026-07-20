
import { gzipSync } from "node:zlib";

export const DEFAULT_BUDGET = 14 * 1024;

export const DEFAULT_RTT_MS = 150;

const gzipLen = (s) => gzipSync(Buffer.from(s, "utf8"), { level: 9 }).length;

function floorTrips(bytes, budget) {
  if (bytes <= 0) return 0;
  let window = budget, delivered = 0, trips = 0;
  do {
    delivered += window;
    window *= 2;
    trips++;
  } while (delivered < bytes && trips < 64);
  return trips;
}

export const PRR_CLASSES = [
  { min: 0.8, label: "Floor-limited" },
  { min: 0.5, label: "Efficient" },
  { min: 0.2, label: "Moderately delayed" },
  { min: 0.1, label: "JS-taxed" },
  { min: 0, label: "JS-bound" },
];
export function classifyPRR(prr) {
  if (prr == null || Number.isNaN(prr)) return null;
  return (PRR_CLASSES.find((c) => prr >= c.min) ?? PRR_CLASSES[PRR_CLASSES.length - 1]).label;
}

const isThenable = (v) => v && typeof v.then === "function";
const isFn = (v) => typeof v === "function";

function resolveCritical(v) {
  const r = isFn(v) ? v() : v;
  if (isThenable(r)) {
    throw new TypeError(
      "boxthis: `critical`/`head` must be synchronous — the critical shell is " +
        "what paints first, so it can't await. Put slow work in `deferred`."
    );
  }
  return r == null ? "" : String(r);
}

async function resolveDeferred(v) {
  const r = isFn(v) ? v() : v;
  const out = isThenable(r) ? await r : r;
  return out == null ? "" : String(out);
}

export function criticalChunk({ lang = "en", head = "", body = "", budget = DEFAULT_BUDGET, rtt = DEFAULT_RTT_MS } = {}) {
  const html =
    `<!doctype html><html lang="${lang}"><head>` +
    resolveCritical(head) +
    `</head><body>` +
    resolveCritical(body);
  const gzip = gzipLen(html);

  const roundTrips = floorTrips(gzip, budget);
  return {
    html,
    gzip,
    budget,
    fits: gzip <= budget,
    over: Math.max(0, gzip - budget),
    roundTrips,
    networkFloorMs: roundTrips * rtt,
    classification: "Floor-limited",
  };
}

let warnedOnce = false;
function defaultWarn(info) {
  if (warnedOnce) return;
  warnedOnce = true;
  process.emitWarning(
    `critical shell is ${info.gzip} B gzipped — ${info.over} B over the ${info.budget} B ` +
      `(~14 KB) first-round-trip budget. It will spill into a second round-trip. ` +
      `Move below-the-fold markup into \`deferred\`.`,
    { code: "BOXTHIS_BUDGET" }
  );
}

export async function ship(res, {
  lang = "en",
  head = "",
  critical = "",
  deferred = [],
  budget = DEFAULT_BUDGET,
  rtt = DEFAULT_RTT_MS,
  strict = false,
  onBudget = null,
  headers = {},
} = {}) {
  const open = criticalChunk({ lang, head, body: critical, budget, rtt });

  if (!open.fits) {
    const info = { gzip: open.gzip, budget, over: open.over };
    if (strict) {
      throw new RangeError(
        `boxthis: critical shell ${open.gzip} B exceeds the ${budget} B budget by ${open.over} B`
      );
    }
    if (onBudget) onBudget(info);
    else defaultWarn(info);
  }

  if (!res.headersSent) {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",

      "x-boxthis": open.fits ? "fit" : `over;by=${open.over}`,
      ...headers,
    });
  }

  res.write(open.html);
  res.flush?.();

  for (const part of deferred) {
    let chunk;
    try {
      chunk = await resolveDeferred(part);
    } catch {
      continue;
    }
    if (chunk) {
      res.write(chunk);
      res.flush?.();
    }
  }

  res.write("</body></html>");
  res.end();

  return {
    gzip: open.gzip,
    fits: open.fits,
    over: open.over,
    roundTrips: open.roundTrips,
    networkFloorMs: open.networkFloorMs,
    classification: open.classification,
  };
}
