// =========================================================
//  VoLTE KPI – main.cpp
//  CLI alat za testiranje kalkulatora KPI formula
//  Kompajliraj: g++ -std=c++17 -O2 -o kpi main.cpp kpi_calc.cpp
//  Pokreni:     ./kpi
// =========================================================
#include "kpi_calc.h"
#include <iostream>
#include <iomanip>
#include <cmath>

static void printKpi(const char* name, double val, const char* unit)
{
    std::cout << "  " << std::left << std::setw(32) << name;
    if (std::isnan(val))
        std::cout << "N/A" << std::endl;
    else
        std::cout << std::fixed << std::setprecision(2) << val << " " << unit << std::endl;
}

static void printKpiInt(const char* name, uint64_t val)
{
    std::cout << "  " << std::left << std::setw(32) << name << val << std::endl;
}

int main()
{
    // ── Test podaci: tipična zdrava ćelija ─────────────
    PmCounters healthy;
    healthy.pmRrcConnEstabSuccMod = 2800;
    healthy.pmRrcConnEstabSuccMta = 450;
    healthy.pmRrcConnEstabSuccHpa = 80;
    healthy.pmRrcConnEstabAttMod  = 2850;
    healthy.pmRrcConnEstabAttMta  = 460;
    healthy.pmRrcConnEstabAttHpa  = 82;
    healthy.pmRrcConnEstabAttReattMod = 40;
    healthy.pmRrcConnEstabAttReattMta = 8;
    healthy.pmRrcConnEstabAttReattHpa = 1;
    healthy.pmRrcConnEstabFailMmeOvlMod = 15;

    healthy.pmS1SigConnEstabSuccMod = 2790;
    healthy.pmS1SigConnEstabSuccMta = 448;
    healthy.pmS1SigConnEstabSuccHpa = 79;
    healthy.pmS1SigConnEstabAttMod  = 2810;
    healthy.pmS1SigConnEstabAttMta  = 452;
    healthy.pmS1SigConnEstabAttHpa  = 81;

    healthy.pmErabEstabSuccInitQci1  = 800;
    healthy.pmErabEstabSuccAddedQci1 = 200;
    healthy.pmErabEstabAttInitQci1   = 810;
    healthy.pmErabEstabAttAddedQci1  = 210;
    healthy.pmErabEstabAttAddedHoOngoingQci1 = 80;

    healthy.pmErabRelAbnormalEnbQci1 = 10;
    healthy.pmErabRelAbnormalMmeQci1 = 5;
    healthy.pmErabRelNormalEnbQci1   = 980;
    healthy.pmErabRelMmeQci1         = 15;

    healthy.pmErabQciLevSum1 = 3000;
    healthy.pmErabRelAbnormalEnbActQci1 = 7;
    healthy.pmErabRelAbnormalMmeActQci1 = 3;

    healthy.pmErabEstabSuccInitQci5  = 790;
    healthy.pmErabEstabSuccAddedQci5 = 180;
    healthy.pmErabEstabAttInitQci5   = 800;
    healthy.pmErabEstabAttAddedQci5  = 190;
    healthy.pmErabEstabAttAddedHoOngoingQci5 = 70;

    healthy.pmVoipQualityRbUlOk  = 980;
    healthy.pmVoipQualityRbUlNok = 20;

    healthy.pmDlAssigsTransVolte               = 5000;
    healthy.pmUlGrantsTransVolte               = 4200;
    healthy.pmUlGrantsTransVolteNoAck          = 100;
    healthy.pmDlAssigsWithDetectedHarqAckVolte = 4850;
    healthy.pmUlGrantsWithDetectedPuschVolte   = 3950;

    healthy.pmHoExeOutSuccQci1 = 150;
    healthy.pmHoExeOutAttQci1  = 155;

    // ── Test podaci: problematična ćelija ──────────────
    PmCounters bad = healthy;
    bad.pmErabRelAbnormalEnbQci1 = 50;
    bad.pmErabRelAbnormalMmeQci1 = 30;
    bad.pmVoipQualityRbUlOk  = 850;
    bad.pmVoipQualityRbUlNok = 150;
    bad.pmHoExeOutSuccQci1 = 130;
    bad.pmHoExeOutAttQci1  = 155;
    bad.pmDlAssigsWithDetectedHarqAckVolte = 4600;
    bad.pmUlGrantsWithDetectedPuschVolte   = 3700;

    // ── Test podaci: prazna ćelija (sve nule) ──────────
    PmCounters empty;

    // ── Izračunaj i prikaži ────────────────────────────
    auto run = [](const char* title, const PmCounters& p,
                  const char* c, const char* s, const char* k, const char* b)
    {
        std::cout << "\n" << std::string(50, '=') << std::endl;
        std::cout << " " << title << std::endl;
        std::cout << std::string(50, '=') << std::endl;
        std::cout << " Celija: " << c << "  Stanica: " << s
                  << "  Klaster: " << k << "  Band: " << b << "\n" << std::endl;

        KpiResult r = calculateKpis(p, c, s, k, b);

        printKpi("1. VoLTE Access Failure Rate [%]",  r.volteAccessFailureRate, "%");
        printKpi("2. VoLTE Drop Rate [%]",             r.volteDropRate, "%");
        printKpi("3. VoLTE Cell Integrity [%]",        r.volteCellIntegrity, "%");
        printKpi("4. VoLTE Erlang [Erl]",              r.volteErlang, "Erl");
        printKpiInt("5. VoLTE Succ Calls [#]",          r.volteSuccCalls);
        printKpi("6. VoLTE QCI1 Add Succ Rate [%]",    r.volteQci1AddSuccRate, "%");
        printKpi("7. VoLTE QCI1 Init Succ Rate [%]",   r.volteQci1InitSuccRate, "%");
        printKpi("8. VoLTE QCI5 Add Succ Rate [%]",    r.volteQci5AddSuccRate, "%");
        printKpi("9. VoLTE QCI5 Init Succ Rate [%]",   r.volteQci5InitSuccRate, "%");
        printKpi("10. PDCCH Error Rate VoLTE [%]",     r.pdcchErrorRateVolte, "%");
        printKpi("11. VoLTE Mobility SR [%]",          r.volteMobilitySR, "%");
        printKpiInt("12. VoLTE Drops Count [#]",        r.volteDropsCount);
    };

    run("ZDRAVA CELIJA (normalni KPI)",
        healthy, "BGD_CEN_001_1800_1", "BGD_CEN_001", "CENTAR_BGD", "1800");

    run("PROBLEMATICKA CELIJA (loši KPI)",
        bad, "BGD_CEN_002_2100_1", "BGD_CEN_002", "CENTAR_BGD", "2100");

    run("PRAZNA CELIJA (sve nule → očekuj N/A)",
        empty, "EMPTY_001_1800_1", "EMPTY_001", "TEST", "1800");

    std::cout << "\n" << std::string(50, '=') << std::endl;
    std::cout << " Test zavrsen." << std::endl;

    return 0;
}