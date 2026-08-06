-- =========================================================
--  VoLTE KPI – Secondary (skip) indexes and TTL retention
--  Applies to the raw pm_counters table and the hourly
--  aggregate table. Skip indexes only apply to NEW data
--  inserts; run MATERIALIZE INDEX (see bottom) once to
--  index existing rows.
-- =========================================================

-- ── Skip indexes on raw counters ───────────────────────
-- datetime is last in the ORDER BY key, so range scans
-- benefit from a minmax skip index.
ALTER TABLE volte_kpi.pm_counters
    ADD INDEX IF NOT EXISTS idx_dt (datetime) TYPE minmax GRANULARITY 3;

-- Cell-level point lookups / aggregations.
ALTER TABLE volte_kpi.pm_counters
    ADD INDEX IF NOT EXISTS idx_cell (celija) TYPE BLOOM_FILTER(0.03) GRANULARITY 1;

-- Band filter is highly selective (4 distinct values).
ALTER TABLE volte_kpi.pm_counters
    ADD INDEX IF NOT EXISTS idx_band (band) TYPE SET(4) GRANULARITY 1;

-- ── Skip indexes on hourly aggregates ──────────────────
ALTER TABLE volte_kpi.pm_counters_hourly
    ADD INDEX IF NOT EXISTS idx_dt_hourly (datetime) TYPE minmax GRANULARITY 3;

ALTER TABLE volte_kpi.pm_counters_hourly
    ADD INDEX IF NOT EXISTS idx_cell_hourly (celija) TYPE BLOOM_FILTER(0.03) GRANULARITY 1;

-- ── TTL data retention ─────────────────────────────────
-- Rows older than 180 days are deleted automatically in
-- the background. Adjust to match the required SLA.
ALTER TABLE volte_kpi.pm_counters
    MODIFY TTL datetime + INTERVAL 180 DAY;

ALTER TABLE volte_kpi.pm_counters_hourly
    MODIFY TTL datetime + INTERVAL 180 DAY;

-- ── Apply skip indexes to existing data ────────────────
ALTER TABLE volte_kpi.pm_counters         MATERIALIZE INDEX idx_dt   IN PARTITION tuple();
ALTER TABLE volte_kpi.pm_counters         MATERIALIZE INDEX idx_cell IN PARTITION tuple();
ALTER TABLE volte_kpi.pm_counters         MATERIALIZE INDEX idx_band IN PARTITION tuple();
ALTER TABLE volte_kpi.pm_counters_hourly  MATERIALIZE INDEX idx_dt_hourly  IN PARTITION tuple();
ALTER TABLE volte_kpi.pm_counters_hourly  MATERIALIZE INDEX idx_cell_hourly IN PARTITION tuple();
