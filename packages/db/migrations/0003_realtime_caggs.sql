-- Serve the not-yet-materialized tail (current hour/day) live from the raw
-- table, so dashboards show the last few minutes without waiting for a refresh.
ALTER MATERIALIZED VIEW bets_hourly  SET (timescaledb.materialized_only = false);
ALTER MATERIALIZED VIEW bets_daily   SET (timescaledb.materialized_only = false);
ALTER MATERIALIZED VIEW player_daily SET (timescaledb.materialized_only = false);
