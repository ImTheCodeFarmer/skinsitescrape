-- Legacy backfill support: a cursor per legacy source so the import can be
-- stopped and resumed, plus site rows for the casinos the legacy scraper
-- covered so their history has somewhere to land.
CREATE TABLE IF NOT EXISTS backfill_progress (
  source        text PRIMARY KEY,
  cursor        bigint NOT NULL DEFAULT 0,
  rows_read     bigint NOT NULL DEFAULT 0,
  batches       integer NOT NULL DEFAULT 0,
  started_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  caught_up_at  timestamptz
);

INSERT INTO sites (slug, name, url) VALUES
  ('clash',      'Clash.gg',    'https://clash.gg'),
  ('rustclash',  'RustClash',   'https://rustclash.com'),
  ('rustyloot',  'Rustyloot',   'https://rustyloot.gg'),
  ('cases',      'Cases.gg',    'https://cases.gg'),
  ('csgogem',    'CSGOGem',     'https://csgogem.com'),
  ('banditcamp', 'Bandit.camp', 'https://bandit.camp'),
  ('rustmagic',  'RustMagic',   'https://rustmagic.com')
ON CONFLICT (slug) DO NOTHING;
