// =========================================================
//  VoLTE KPI – test_kpi.cpp
//  Unit testovi za sve 12 KPI formula
//  Kompajliraj: g++ -std=c++17 -O2 -o test_kpi test_kpi.cpp kpi_calc.cpp
//  Pokreni:     ./test_kpi
// =========================================================
#include "kpi_calc.h"
#include <iostream>
#include <cmath>
#include <cstdlib>

static int passed = 0;
static int failed = 0;

#define ASSERT_NEAR(val, exp, eps)                                             \
    do {                                                                       \
        double _v = (val), _e = (exp);                                         \
        if (std::isnan(_e)) {                                                  \
            if (!std::isnan(_v)) {                                             \
                std::cerr << "  FAIL: expected NaN, got " << _v               \
                          << " at line " << __LINE__ << std::endl;            \
                failed++;                                                      \
            } else { passed++; }                                               \
        } else if (std::abs(_v - _e) > (eps)) {                               \
            std::cerr << "  FAIL: expected " << _e << " got " << _v           \
                      << " (±" << (eps) << ") at line " << __LINE__           \
                      << std::endl;                                            \
            failed++;                                                          \
        } else { passed++; }                                                   \
    } while (0)

#define ASSERT_TRUE(cond)                                                     \
    do {                                                                       \
        if (!(cond)) {                                                         \
            std::cerr << "  FAIL: " #cond " at line " << __LINE__             \
                      << std::endl;                                            \
            failed++;                                                          \
        } else { passed++; }                                                   \
    } while (0)

// ── Test 1: Access Failure Rate ──────────────────────
static void test_access_failure_rate()
{
    std::cout << "Test 1: VoLTE Access Failure Rate..." << std::endl;

    PmCounters p;
    p.pmRrcConnEstabSuccMod = 990; p.pmRrcConnEstabAttMod = 1000;
    p.pmS1SigConnEstabSuccMod = 980; p.pmS1SigConnEstabAttMod = 1000;
    p.pmErabEstabSuccInitQci1 = 990; p.pmErabEstabAttInitQci1 = 1000;
    p.pmErabEstabSuccInitQci5 = 990; p.pmErabEstabAttInitQci5 = 1000;

    // RRC SR=0.99, S1 SR=0.98, ERAB1 SR=0.99, ERAB5 SR=0.99
    // Failure = 100 - 100 * 0.99 * 0.98 * 0.99 * 0.99 = 100 - 95.09 = ~4.91
    KpiResult r = calculateKpis(p, "T1", "S1", "K1", "1800");
    ASSERT_TRUE(!std::isnan(r.volteAccessFailureRate));
    ASSERT_TRUE(r.volteAccessFailureRate > 4.8 && r.volteAccessFailureRate < 5.1);
}

// ── Test 2: Drop Rate ────────────────────────────────
static void test_drop_rate()
{
    std::cout << "Test 2: VoLTE Drop Rate..." << std::endl;

    PmCounters p;
    p.pmErabRelAbnormalEnbQci1 = 10;
    p.pmErabRelAbnormalMmeQci1 = 5;
    p.pmErabRelNormalEnbQci1   = 900;
    p.pmErabRelMmeQci1         = 20;

    // Drop = (10+5) / (10+900+20) * 100 = 15/930 * 100 = ~1.61%
    KpiResult r = calculateKpis(p, "T2", "S2", "K2", "1800");
    ASSERT_TRUE(!std::isnan(r.volteDropRate));
    ASSERT_NEAR(r.volteDropRate, 1.61, 0.05);
}

// ── Test 3: Cell Integrity ───────────────────────────
static void test_cell_integrity()
{
    std::cout << "Test 3: VoLTE Cell Integrity..." << std::endl;

    PmCounters p;
    p.pmVoipQualityRbUlOk  = 950;
    p.pmVoipQualityRbUlNok = 50;

    // Integrity = 950 / (950+50) * 100 = 95.0%
    KpiResult r = calculateKpis(p, "T3", "S3", "K3", "1800");
    ASSERT_NEAR(r.volteCellIntegrity, 95.0, 0.01);
}

// ── Test 4: Erlang ───────────────────────────────────
static void test_erlang()
{
    std::cout << "Test 4: VoLTE Erlang..." << std::endl;

    PmCounters p;
    p.pmErabQciLevSum1 = 7200;

    // Erlang = 7200 / 720 = 10.0
    KpiResult r = calculateKpis(p, "T4", "S4", "K4", "1800");
    ASSERT_NEAR(r.volteErlang, 10.0, 0.01);

    // Zero case
    PmCounters p0;
    KpiResult r0 = calculateKpis(p0, "T4z", "S4", "K4", "1800");
    ASSERT_NEAR(r0.volteErlang, 0.0, 0.01);
}

// ── Test 5: Succ Calls ───────────────────────────────
static void test_succ_calls()
{
    std::cout << "Test 5: VoLTE Succ Calls..." << std::endl;

    PmCounters p;
    p.pmErabEstabSuccInitQci1  = 500;
    p.pmErabEstabSuccAddedQci1 = 150;

    KpiResult r = calculateKpis(p, "T5", "S5", "K5", "1800");
    ASSERT_TRUE(r.volteSuccCalls == 650);
}

// ── Test 6: QCI1 Add Succ Rate ───────────────────────
static void test_qci1_add_succ_rate()
{
    std::cout << "Test 6: VoLTE QCI1 Add Succ Rate..." << std::endl;

    PmCounters p;
    p.pmErabEstabSuccAddedQci1          = 300;
    p.pmErabEstabAttAddedQci1           = 320;
    p.pmErabEstabAttAddedHoOngoingQci1  = 20;

    // Rate = 300 / (320-20) * 100 = 100.0%
    KpiResult r = calculateKpis(p, "T6", "S6", "K6", "1800");
    ASSERT_NEAR(r.volteQci1AddSuccRate, 100.0, 0.01);
}

// ── Test 7: QCI1 Init Succ Rate ──────────────────────
static void test_qci1_init_succ_rate()
{
    std::cout << "Test 7: VoLTE QCI1 Init Succ Rate..." << std::endl;

    PmCounters p;
    p.pmErabEstabSuccInitQci1 = 990;
    p.pmErabEstabAttInitQci1  = 1000;

    // Rate = 990/1000 * 100 = 99.0%
    KpiResult r = calculateKpis(p, "T7", "S7", "K7", "1800");
    ASSERT_NEAR(r.volteQci1InitSuccRate, 99.0, 0.01);
}

// ── Test 8: QCI5 Add Succ Rate ───────────────────────
static void test_qci5_add_succ_rate()
{
    std::cout << "Test 8: VoLTE QCI5 Add Succ Rate..." << std::endl;

    PmCounters p;
    p.pmErabEstabSuccAddedQci5          = 180;
    p.pmErabEstabAttAddedQci5           = 200;
    p.pmErabEstabAttAddedHoOngoingQci5  = 20;

    // Rate = 180 / (200-20) * 100 = 100.0%
    KpiResult r = calculateKpis(p, "T8", "S8", "K8", "1800");
    ASSERT_NEAR(r.volteQci5AddSuccRate, 100.0, 0.01);
}

// ── Test 9: QCI5 Init Succ Rate ──────────────────────
static void test_qci5_init_succ_rate()
{
    std::cout << "Test 9: VoLTE QCI5 Init Succ Rate..." << std::endl;

    PmCounters p;
    p.pmErabEstabSuccInitQci5 = 950;
    p.pmErabEstabAttInitQci5  = 1000;

    // Rate = 950/1000 * 100 = 95.0%
    KpiResult r = calculateKpis(p, "T9", "S9", "K9", "1800");
    ASSERT_NEAR(r.volteQci5InitSuccRate, 95.0, 0.01);
}

// ── Test 10: PDCCH Error Rate ────────────────────────
static void test_pdch_error_rate()
{
    std::cout << "Test 10: PDCCH Error Rate VoLTE..." << std::endl;

    PmCounters p;
    p.pmDlAssigsTransVolte               = 1000;
    p.pmUlGrantsTransVolte               = 800;
    p.pmUlGrantsTransVolteNoAck          = 50;
    p.pmDlAssigsWithDetectedHarqAckVolte = 920;
    p.pmUlGrantsWithDetectedPuschVolte   = 700;

    // base = 1000+800-50 = 1750
    // errors = 1750 - 920 - 700 = 130
    // rate = 130/1750 * 100 = ~7.43%
    KpiResult r = calculateKpis(p, "T10", "S10", "K10", "1800");
    ASSERT_TRUE(!std::isnan(r.pdcchErrorRateVolte));
    ASSERT_NEAR(r.pdcchErrorRateVolte, 7.43, 0.05);
}

// ── Test 11: Mobility SR ─────────────────────────────
static void test_mobility_sr()
{
    std::cout << "Test 11: VoLTE Mobility SR..." << std::endl;

    PmCounters p;
    p.pmHoExeOutSuccQci1 = 195;
    p.pmHoExeOutAttQci1  = 200;

    // SR = 195/200 * 100 = 97.5%
    KpiResult r = calculateKpis(p, "T11", "S11", "K11", "1800");
    ASSERT_NEAR(r.volteMobilitySR, 97.5, 0.01);
}

// ── Test 12: Drops Count ─────────────────────────────
static void test_drops_count()
{
    std::cout << "Test 12: VoLTE Drops Count..." << std::endl;

    PmCounters p;
    p.pmErabRelAbnormalEnbActQci1 = 7;
    p.pmErabRelAbnormalMmeActQci1 = 3;

    KpiResult r = calculateKpis(p, "T12", "S12", "K12", "1800");
    ASSERT_TRUE(r.volteDropsCount == 10);
}

// ── Test: prazni podaci (sve N/A) ────────────────────
static void test_empty_counters()
{
    std::cout << "Test: Empty counters (all N/A)..." << std::endl;

    PmCounters p;  // sve = 0
    KpiResult r = calculateKpis(p, "EMPTY", "S", "K", "800");

    ASSERT_TRUE(std::isnan(r.volteAccessFailureRate));
    ASSERT_TRUE(std::isnan(r.volteDropRate));
    ASSERT_TRUE(std::isnan(r.volteCellIntegrity));
    ASSERT_TRUE(r.volteSuccCalls == 0);
    ASSERT_TRUE(r.volteDropsCount == 0);
}

// ── Test: dimenzije se kopiraju ──────────────────────
static void test_dimensions()
{
    std::cout << "Test: Dimensions copied correctly..." << std::endl;

    PmCounters p;
    KpiResult r = calculateKpis(p, "CEL_001", "STANICA_A", "KLASTER_1", "2100");

    ASSERT_TRUE(r.celija  == "CEL_001");
    ASSERT_TRUE(r.stanica == "STANICA_A");
    ASSERT_TRUE(r.klaster == "KLASTER_1");
    ASSERT_TRUE(r.band    == "2100");
}

// ── Test: PDCCH negative protection ──────────────────
static void test_pdch_no_negative()
{
    std::cout << "Test: PDCCH Error Rate negative protection..." << std::endl;

    PmCounters p;
    p.pmDlAssigsTransVolte               = 100;
    p.pmUlGrantsTransVolte               = 100;
    p.pmUlGrantsTransVolteNoAck          = 0;
    p.pmDlAssigsWithDetectedHarqAckVolte = 200;  // više od base
    p.pmUlGrantsWithDetectedPuschVolte   = 200;  // više od base

    // base = 200, errors = max(0, 200-200-200) = max(0, -200) = 0
    KpiResult r = calculateKpis(p, "T_PDCCH", "S", "K", "1800");
    ASSERT_NEAR(r.pdcchErrorRateVolte, 0.0, 0.01);
}

// ── Main ─────────────────────────────────────────────
static void test_percentages_are_bounded()
{
    std::cout << "Test: Percentage KPI bounds..." << std::endl;

    PmCounters p;
    p.pmRrcConnEstabSuccMod = 120;
    p.pmRrcConnEstabAttMod = 100;
    p.pmS1SigConnEstabSuccMod = 120;
    p.pmS1SigConnEstabAttMod = 100;
    p.pmErabEstabSuccInitQci1 = 120;
    p.pmErabEstabAttInitQci1 = 100;
    p.pmErabEstabSuccInitQci5 = 120;
    p.pmErabEstabAttInitQci5 = 100;

    p.pmErabEstabSuccAddedQci1 = 150;
    p.pmErabEstabAttAddedQci1 = 100;
    p.pmErabEstabSuccAddedQci5 = 150;
    p.pmErabEstabAttAddedQci5 = 100;
    p.pmHoExeOutSuccQci1 = 120;
    p.pmHoExeOutAttQci1 = 100;

    KpiResult r = calculateKpis(p, "T_BOUND", "S", "K", "1800");
    ASSERT_NEAR(r.volteAccessFailureRate, 0.0, 0.01);
    ASSERT_NEAR(r.volteQci1AddSuccRate, 100.0, 0.01);
    ASSERT_NEAR(r.volteQci1InitSuccRate, 100.0, 0.01);
    ASSERT_NEAR(r.volteQci5AddSuccRate, 100.0, 0.01);
    ASSERT_NEAR(r.volteQci5InitSuccRate, 100.0, 0.01);
    ASSERT_NEAR(r.volteMobilitySR, 100.0, 0.01);
}

int main()
{
    std::cout << "========================================" << std::endl;
    std::cout << " VoLTE KPI Unit Testovi" << std::endl;
    std::cout << "========================================" << std::endl;

    test_access_failure_rate();
    test_drop_rate();
    test_cell_integrity();
    test_erlang();
    test_succ_calls();
    test_qci1_add_succ_rate();
    test_qci1_init_succ_rate();
    test_qci5_add_succ_rate();
    test_qci5_init_succ_rate();
    test_pdch_error_rate();
    test_mobility_sr();
    test_drops_count();
    test_empty_counters();
    test_dimensions();
    test_pdch_no_negative();
    test_percentages_are_bounded();

    std::cout << "\n========================================" << std::endl;
    std::cout << " Rezultat: " << passed << " prošlo, "
              << failed << " palo" << std::endl;
    std::cout << "========================================" << std::endl;

    return failed > 0 ? EXIT_FAILURE : EXIT_SUCCESS;
}
