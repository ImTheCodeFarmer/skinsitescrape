# House Edge — skin casino stats

Dashboard tracking wager, profit, loss, top players and top games for
Clash.gg, RustClash, Rustyloot, Rustypot, Cases.gg and CSGOGem.

Built with Next.js (App Router), shadcn/ui, Recharts and Motion.

```bash
pnpm install
pnpm dev
```

## Data

All numbers are **deterministic sample data** generated in `src/lib/data.ts`
(seeded PRNG, 90 days ending 2026-09-14). To wire in real stats, replace the
`SEEDS`/`build()` pair with a fetch that returns the same `Casino` shape:
daily `series`, `games`, and `players`.

## Logos

`public/logos/*.png` were pulled from each site's favicon. Rustyloot and
Cases.gg only expose 32px icons; swap in higher-resolution assets if you have them.

## Brand colors

Each site's accent color is derived from its logo:

```bash
node scripts/extract-logo-colors.mjs
```

This writes `src/lib/logo-colors.json`. Re-run it after swapping a logo.
The script clamps lightness and chroma so every color stays readable on the
dark surface and the set passes colorblind-separation checks.
