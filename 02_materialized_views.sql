-- =========================================================
--  VoLTE KPI – Materialized views for pre-aggregation
--  Hourly aggregation of raw PM counters to speed up
--  dashboard queries over long time ranges.
-- =========================================================

-- ── Hourly aggregate target table ──────────────────────
CREATE TABLE IF NOT EXISTS volte_kpi.pm_counters_hourly
(
    datetime   DateTime,
    stanica    LowCardinality(String),
    celija     LowCardinality(String),
    klaster    LowCardinality(String),
    band       LowCardinality(String),

    rrcSuccAgg        UInt64 DEFAULT 0,
    voiceErabSuccAgg  UInt64 DEFAULT 0,
    erlangSumAgg      UInt64 DEFAULT 0,
    dropsQci1Agg      UInt64 DEFAULT 0,
    pdcchErrorAgg     UInt64 DEFAULT 0
)
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(datetime)
ORDER BY (klaster, stanica, celija, datetime);

-- ── Hourly materialized view ───────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS volte_kpi.mv_pm_counters_hourly
TO volte_kpi.pm_counters_hourly
AS
SELECT
    toStartOfHour(datetime) AS datetime,
    stanica,
    celija,
    klaster,
    band,
    SUM(pmRrcConnEstabSuccMod + pmRrcConnEstabSuccMta + pmRrcConnEstabSuccHpa) AS rrcSuccAgg,
    SUM(pmErabEstabSuccInitQci1 + pmErabEstabSuccAddedQci1)                   AS voiceErabSuccAgg,
    SUM(pmErabQciLevSum1)                                                     AS erlangSumAgg,
    SUM(pmErabRelAbnormalEnbQci1 + pmErabRelAbnormalMmeQci1)                  AS dropsQci1Agg,
    SUM(pmDlAssigsTransVolte + pmUlGrantsTransVolte)                          AS pdcchErrorAgg
FROM volte_kpi.pm_counters
GROUP BY datetime, stanica, celija, klaster, band;

-- ── Daily station-level aggregate target table ─────────
CREATE TABLE IF NOT EXISTS volte_kpi.pm_counters_station_daily
(
    date      Date,
    stanica   LowCardinality(String),
    klaster   LowCardinality(String),
    band      LowCardinality(String),

    rrcSuccAgg        UInt64 DEFAULT 0,
    voiceErabSuccAgg  UInt64 DEFAULT 0,
    erlangSumAgg      UInt64 DEFAULT 0,
    dropsQci1Agg      UInt64 DEFAULT 0
)
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (klaster, stanica, date);

-- ── Daily station materialized view ────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS volte_kpi.mv_pm_counters_station_daily
TO volte_kpi.pm_counters_station_daily
AS
SELECT
    toDate(datetime) AS date,
    stanica,
    klaster,
    band,
    SUM(pmRrcConnEstabSuccMod + pmRrcConnEstabSuccMta + pmRrcConnEstabSuccHpa) AS rrcSuccAgg,
    SUM(pmErabEstabSuccInitQci1 + pmErabEstabSuccAddedQci1)                   AS voiceErabSuccAgg,
    SUM(pmErabQciLevSum1)                                                     AS erlangSumAgg,
    SUM(pmErabRelAbnormalEnbQci1 + pmErabRelAbnormalMmeQci1)                  AS dropsQci1Agg
FROM volte_kpi.pm_counters
GROUP BY date, stanica, klaster, band;
