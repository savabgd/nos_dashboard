-- =========================================================
--  VoLTE KPI – ClickHouse schema
-- =========================================================

CREATE DATABASE IF NOT EXISTS volte_kpi;

CREATE TABLE IF NOT EXISTS volte_kpi.pm_counters
(
    -- ── Vreme i dimenzije ─────────────────────────────
    datetime     DateTime,
    stanica      LowCardinality(String),   -- ime eNodeB / sajta
    celija       LowCardinality(String),   -- ime ćelije (npr. BGD_001_1800_1)
    klaster      LowCardinality(String),   -- klaster (npr. CENTAR_BGD)
    band         LowCardinality(String),   -- frekvencija: '800', '1800', '2100'
    vendor       LowCardinality(String) DEFAULT 'Ericsson',
    region       LowCardinality(String) DEFAULT 'Srbija',

    -- ── RRC Connection Establishment ──────────────────
    pmRrcConnEstabSuccMod        UInt64 DEFAULT 0,
    pmRrcConnEstabSuccMta        UInt64 DEFAULT 0,
    pmRrcConnEstabSuccHpa        UInt64 DEFAULT 0,
    pmRrcConnEstabAttMod         UInt64 DEFAULT 0,
    pmRrcConnEstabAttMta         UInt64 DEFAULT 0,
    pmRrcConnEstabAttHpa         UInt64 DEFAULT 0,
    pmRrcConnEstabAttReattMod    UInt64 DEFAULT 0,
    pmRrcConnEstabAttReattMta    UInt64 DEFAULT 0,
    pmRrcConnEstabAttReattHpa    UInt64 DEFAULT 0,
    pmRrcConnEstabFailMmeOvlMod  UInt64 DEFAULT 0,

    -- ── S1 Signalling ─────────────────────────────────
    pmS1SigConnEstabSuccMod  UInt64 DEFAULT 0,
    pmS1SigConnEstabSuccMta  UInt64 DEFAULT 0,
    pmS1SigConnEstabSuccHpa  UInt64 DEFAULT 0,
    pmS1SigConnEstabAttMod   UInt64 DEFAULT 0,
    pmS1SigConnEstabAttMta   UInt64 DEFAULT 0,
    pmS1SigConnEstabAttHpa   UInt64 DEFAULT 0,

    -- ── E-RAB QCI 1 (VoLTE Audio) ─────────────────────
    pmErabEstabSuccInitQci1           UInt64 DEFAULT 0,
    pmErabEstabSuccAddedQci1          UInt64 DEFAULT 0,
    pmErabEstabAttInitQci1            UInt64 DEFAULT 0,
    pmErabEstabAttAddedQci1           UInt64 DEFAULT 0,
    pmErabEstabAttAddedHoOngoingQci1  UInt64 DEFAULT 0,
    pmErabRelAbnormalEnbQci1          UInt64 DEFAULT 0,
    pmErabRelAbnormalMmeQci1          UInt64 DEFAULT 0,
    pmErabRelNormalEnbQci1            UInt64 DEFAULT 0,
    pmErabRelMmeQci1                  UInt64 DEFAULT 0,
    pmErabQciLevSum1                  UInt64 DEFAULT 0,
    pmErabRelAbnormalEnbActQci1       UInt64 DEFAULT 0,
    pmErabRelAbnormalMmeActQci1       UInt64 DEFAULT 0,

    -- ── E-RAB QCI 5 (IMS Signalling) ──────────────────
    pmErabEstabSuccInitQci5           UInt64 DEFAULT 0,
    pmErabEstabSuccAddedQci5          UInt64 DEFAULT 0,
    pmErabEstabAttInitQci5            UInt64 DEFAULT 0,
    pmErabEstabAttAddedQci5           UInt64 DEFAULT 0,
    pmErabEstabAttAddedHoOngoingQci5  UInt64 DEFAULT 0,

    -- ── VoIP Quality (UL) ─────────────────────────────
    pmVoipQualityRbUlOk  UInt64 DEFAULT 0,
    pmVoipQualityRbUlNok UInt64 DEFAULT 0,

    -- ── PDCCH VoLTE ───────────────────────────────────
    pmDlAssigsTransVolte                UInt64 DEFAULT 0,
    pmUlGrantsTransVolte                UInt64 DEFAULT 0,
    pmUlGrantsTransVolteNoAck           UInt64 DEFAULT 0,
    pmDlAssigsWithDetectedHarqAckVolte  UInt64 DEFAULT 0,
    pmUlGrantsWithDetectedPuschVolte    UInt64 DEFAULT 0,

    -- ── Handover QCI 1 ────────────────────────────────
    pmHoExeOutSuccQci1  UInt64 DEFAULT 0,
    pmHoExeOutAttQci1   UInt64 DEFAULT 0
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(datetime)
ORDER BY (klaster, stanica, celija, datetime)
SETTINGS index_granularity = 8192;

-- ── Korisni view-ovi ──────────────────────────────────

-- Dnevna agregacija po ćeliji
CREATE VIEW IF NOT EXISTS volte_kpi.v_daily_counters AS
SELECT
    toDate(datetime) AS date,
    stanica, celija, klaster, band,
    SUM(pmRrcConnEstabSuccMod + pmRrcConnEstabSuccMta + pmRrcConnEstabSuccHpa) AS rrcSucc,
    SUM(pmErabEstabSuccInitQci1 + pmErabEstabSuccAddedQci1)                   AS voiceErabSucc,
    SUM(pmErabQciLevSum1) / 720.0                                              AS erlang
FROM volte_kpi.pm_counters
GROUP BY date, stanica, celija, klaster, band
ORDER BY date, klaster, stanica, celija;
