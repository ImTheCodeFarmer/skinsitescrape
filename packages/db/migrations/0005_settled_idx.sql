-- The dashboard's recent-rounds and records queries filter and sort on
-- settled_at; until now only created_at was indexed.
CREATE INDEX IF NOT EXISTS coinflips_settled_idx ON coinflips (site, settled_at DESC) WHERE settled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS jackpots_settled_idx ON jackpots (site, settled_at DESC) WHERE settled_at IS NOT NULL;
