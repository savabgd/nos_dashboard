#pragma once
// =========================================================
//  VoLTE KPI - kpi_calc.h
//  PM structures and calculateKpis() declaration.
// =========================================================
#include <cstdint>
#include <cmath>
#include <limits>
#include <string>

struct PmCounters
{
    // RRC Connection Establishment
    uint64_t pmRrcConnEstabSuccMod        = 0;
    uint64_t pmRrcConnEstabSuccMta        = 0;
    uint64_t pmRrcConnEstabSuccHpa        = 0;
    uint64_t pmRrcConnEstabAttMod         = 0;
    uint64_t pmRrcConnEstabAttMta         = 0;
    uint64_t pmRrcConnEstabAttHpa         = 0;
    uint64_t pmRrcConnEstabAttReattMod    = 0;
    uint64_t pmRrcConnEstabAttReattMta    = 0;
    uint64_t pmRrcConnEstabAttReattHpa    = 0;
    uint64_t pmRrcConnEstabFailMmeOvlMod  = 0;

    // S1 Signalling
    uint64_t pmS1SigConnEstabSuccMod  = 0;
    uint64_t pmS1SigConnEstabSuccMta  = 0;
    uint64_t pmS1SigConnEstabSuccHpa  = 0;
    uint64_t pmS1SigConnEstabAttMod   = 0;
    uint64_t pmS1SigConnEstabAttMta   = 0;
    uint64_t pmS1SigConnEstabAttHpa   = 0;

    // E-RAB QCI 1 (VoLTE Audio)
    uint64_t pmErabEstabSuccInitQci1           = 0;
    uint64_t pmErabEstabSuccAddedQci1          = 0;
    uint64_t pmErabEstabAttInitQci1            = 0;
    uint64_t pmErabEstabAttAddedQci1           = 0;
    uint64_t pmErabEstabAttAddedHoOngoingQci1  = 0;
    uint64_t pmErabRelAbnormalEnbQci1          = 0;
    uint64_t pmErabRelAbnormalMmeQci1          = 0;
    uint64_t pmErabRelNormalEnbQci1            = 0;
    uint64_t pmErabRelMmeQci1                  = 0;
    uint64_t pmErabQciLevSum1                  = 0;
    uint64_t pmErabRelAbnormalEnbActQci1       = 0;
    uint64_t pmErabRelAbnormalMmeActQci1       = 0;

    // E-RAB QCI 5 (IMS Signalling)
    uint64_t pmErabEstabSuccInitQci5           = 0;
    uint64_t pmErabEstabSuccAddedQci5          = 0;
    uint64_t pmErabEstabAttInitQci5            = 0;
    uint64_t pmErabEstabAttAddedQci5           = 0;
    uint64_t pmErabEstabAttAddedHoOngoingQci5  = 0;

    // VoIP Quality (UL)
    uint64_t pmVoipQualityRbUlOk  = 0;
    uint64_t pmVoipQualityRbUlNok = 0;

    // PDCCH VoLTE
    uint64_t pmDlAssigsTransVolte                = 0;
    uint64_t pmUlGrantsTransVolte                = 0;
    uint64_t pmUlGrantsTransVolteNoAck           = 0;
    uint64_t pmDlAssigsWithDetectedHarqAckVolte  = 0;
    uint64_t pmUlGrantsWithDetectedPuschVolte    = 0;

    // Handover QCI 1
    uint64_t pmHoExeOutSuccQci1  = 0;
    uint64_t pmHoExeOutAttQci1   = 0;
};

struct KpiResult
{
    std::string celija;
    std::string stanica;
    std::string klaster;
    std::string band;

    // NaN means N/A: division by zero or insufficient data.
    double volteAccessFailureRate  = std::numeric_limits<double>::quiet_NaN();  // [%]
    double volteDropRate           = std::numeric_limits<double>::quiet_NaN();  // [%]
    double volteCellIntegrity      = std::numeric_limits<double>::quiet_NaN();  // [%]
    double volteErlang             = std::numeric_limits<double>::quiet_NaN();  // [Erl]
    uint64_t volteSuccCalls        = 0;                                          // [#]
    double volteQci1AddSuccRate    = std::numeric_limits<double>::quiet_NaN();  // [%]
    double volteQci1InitSuccRate   = std::numeric_limits<double>::quiet_NaN();  // [%]
    double volteQci5AddSuccRate    = std::numeric_limits<double>::quiet_NaN();  // [%]
    double volteQci5InitSuccRate   = std::numeric_limits<double>::quiet_NaN();  // [%]
    double pdcchErrorRateVolte     = std::numeric_limits<double>::quiet_NaN();  // [%]
    double volteMobilitySR         = std::numeric_limits<double>::quiet_NaN();  // [%]
    uint64_t volteDropsCount       = 0;                                          // [#]
};

KpiResult calculateKpis(
    const PmCounters& p,
    const std::string& celija,
    const std::string& stanica,
    const std::string& klaster,
    const std::string& band);
