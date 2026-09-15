// Extracts a dominant brand color from each logo in public/logos and
// writes the result to src/lib/logo-colors.json.
//
//   node scripts/extract-logo-colors.mjs
//
// Method: keep opaque, reasonably saturated pixels; bucket them by hue;
// take the heaviest bucket; average its color; then clamp lightness into
// a band that reads well on the dark dashboard surface.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { PNG } from "pngjs";
import { converter, formatHex, clampChroma } from "culori";

const toOklch = converter("oklch");
const dir = new URL("../public/logos/", import.meta.url);
const out = {};

for (const file of readdirSync(dir).filter((f) => f.endsWith(".png")).sort()) {
  const png = PNG.sync.read(readFileSync(new URL(file, dir)));
  const buckets = new Map(); // hue bucket -> { n, l, c, h(sum of unit vectors) }

  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b, a] = [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
    if (a < 200) continue;
    const c = toOklch({ mode: "rgb", r: r / 255, g: g / 255, b: b / 255 });
    if (!c || c.c === undefined || c.c < 0.06 || c.l < 0.2 || c.l > 0.95) continue; // skip grays / near-black / near-white
    const key = Math.round(c.h / 20) * 20;
    const w = c.c; // weight by chroma so vivid pixels dominate
    const bk = buckets.get(key) ?? { n: 0, l: 0, ch: 0, x: 0, y: 0 };
    bk.n += w;
    bk.l += c.l * w;
    bk.ch += c.c * w;
    bk.x += Math.cos((c.h * Math.PI) / 180) * w;
    bk.y += Math.sin((c.h * Math.PI) / 180) * w;
    buckets.set(key, bk);
  }

  const best = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
  if (!best) {
    console.warn(`${file}: no saturated pixels found, skipping`);
    continue;
  }
  let h = (Math.atan2(best.y, best.x) * 180) / Math.PI;
  if (h < 0) h += 360;
  const l = Math.min(0.66, Math.max(0.56, best.l / best.n));
  const ch = Math.max(0.15, Math.min(0.2, best.ch / best.n));
  const hex = formatHex(clampChroma({ mode: "oklch", l, c: ch, h }, "rgb"));
  const raw = formatHex(clampChroma({ mode: "oklch", l: best.l / best.n, c: best.ch / best.n, h }, "rgb"));
  out[file.replace(/\.png$/, "")] = hex;
  console.log(`${file.padEnd(16)} raw ${raw}  ->  ${hex}  (hue ${h.toFixed(0)})`);
}

writeFileSync(new URL("../src/lib/logo-colors.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
