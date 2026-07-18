// =========================================================
//  VoLTE KPI - kpi_calc.cpp
//  Implementation of all 12 VoLTE KPI formulas.
// =========================================================
#include "kpi_calc.h"

static inline double sd(double num, double den)
{
    return (den <= 0.0) ? std::numeric_limits<double>::quiet_NaN() : num / den;
}

static inline double r2(double v)
{
    return std::round(v * 100.0) / 100.0;
}

static inline double dmax(double a, double b)
{
    return (a > b) ? a : b;
}

static inline double clamp(double v, double lo, double hi)
{
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
}

static inline double pct(double num, double den)
{
    const double ratio = sd(num, den);
    return std::isnan(ratio) ? ratio : r2(100.0 * clamp(ratio, 0.0, 1.0));
}

static constexpr double INTERVALS_PER_HOUR = 720.0;

KpiResult calculateKpis(
    const PmCounters& p,
    const std::string& celija,
    const std::string& stanica,
    const std::string& klaster,
    const std::string& band)
{
    KpiResult r;
    r.celija  = celija;
    r.stanica = stanica;
    r.klaster = klaster;
    r.band    = band;

    const double rrcSucc =
        (double)p.pmRrcConnEstabSuccMod +
        (double)p.pmRrcConnEstabSuccMta +
        (double)p.pmRrcConnEstabSuccHpa;

    const double rrcAtt =
        (double)p.pmRrcConnEstabAttMod  +
        (double)p.pmRrcConnEstabAttMta  +
        (double)p.pmRrcConnEstabAttHpa  -
        (double)p.pmRrcConnEstabAttReattMod  -
        (double)p.pmRrcConnEstabAttReattMta  -
        (double)p.pmRrcConnEstabAttReattHpa  -
        (double)p.pmRrcConnEstabFailMmeOvlMod;

    const double s1Succ =
        (double)p.pmS1SigConnEstabSuccMod +
        (double)p.pmS1SigConnEstabSuccMta +
        (double)p.pmS1SigConnEstabSuccHpa;

    const double s1Att =
        (double)p.pmS1SigConnEstabAttMod +
        (double)p.pmS1SigConnEstabAttMta +
        (double)p.pmS1SigConnEstabAttHpa;

    const double erabSuccQci1 =
        (double)p.pmErabEstabSuccInitQci1 +
        (double)p.pmErabEstabSuccAddedQci1;

    const double erabAttQci1 =
        (double)p.pmErabEstabAttInitQci1  +
        (double)p.pmErabEstabAttAddedQci1 -
        (double)p.pmErabEstabAttAddedHoOngoingQci1;

    const double erabSuccQci5 =
        (double)p.pmErabEstabSuccInitQci5 +
        (double)p.pmErabEstabSuccAddedQci5;

    const double erabAttQci5 =
        (double)p.pmErabEstabAttInitQci5  +
        (double)p.pmErabEstabAttAddedQci5 -
        (double)p.pmErabEstabAttAddedHoOngoingQci5;

    {
        const double rrcSR   = sd(rrcSucc,      rrcAtt);
        const double s1SR    = sd(s1Succ,       s1Att);
        const double erab1SR = sd(erabSuccQci1, erabAttQci1);
        const double erab5SR = sd(erabSuccQci5, erabAttQci5);

        if (!std::isnan(rrcSR) && !std::isnan(s1SR) &&
            !std::isnan(erab1SR) && !std::isnan(erab5SR))
        {
            const double success =
                clamp(rrcSR, 0.0, 1.0) *
                clamp(s1SR, 0.0, 1.0) *
                clamp(erab1SR, 0.0, 1.0) *
                clamp(erab5SR, 0.0, 1.0);
            r.volteAccessFailureRate = r2(clamp(100.0 - (100.0 * success), 0.0, 100.0));
        }
    }

    {
        const double num = (double)p.pmErabRelAbnormalEnbQci1 +
                           (double)p.pmErabRelAbnormalMmeQci1;
        const double den = (double)p.pmErabRelAbnormalEnbQci1 +
                           (double)p.pmErabRelNormalEnbQci1   +
                           (double)p.pmErabRelMmeQci1;
        const double v = pct(num, den);
        if (!std::isnan(v)) r.volteDropRate = v;
    }

    {
        const double den = (double)p.pmVoipQualityRbUlOk +
                           (double)p.pmVoipQualityRbUlNok;
        const double v = pct((double)p.pmVoipQualityRbUlOk, den);
        if (!std::isnan(v)) r.volteCellIntegrity = v;
    }

    r.volteErlang = r2(sd((double)p.pmErabQciLevSum1, INTERVALS_PER_HOUR));
    if (std::isnan(r.volteErlang)) r.volteErlang = 0.0;

    r.volteSuccCalls = p.pmErabEstabSuccInitQci1 + p.pmErabEstabSuccAddedQci1;

    {
        const double den = (double)p.pmErabEstabAttAddedQci1 -
                           (double)p.pmErabEstabAttAddedHoOngoingQci1;
        const double v = pct((double)p.pmErabEstabSuccAddedQci1, den);
        if (!std::isnan(v)) r.volteQci1AddSuccRate = v;
    }

    {
        const double v = pct((double)p.pmErabEstabSuccInitQci1,
                             (double)p.pmErabEstabAttInitQci1);
        if (!std::isnan(v)) r.volteQci1InitSuccRate = v;
    }

    {
        const double den = (double)p.pmErabEstabAttAddedQci5 -
                           (double)p.pmErabEstabAttAddedHoOngoingQci5;
        const double v = pct((double)p.pmErabEstabSuccAddedQci5, den);
        if (!std::isnan(v)) r.volteQci5AddSuccRate = v;
    }

    {
        const double v = pct((double)p.pmErabEstabSuccInitQci5,
                             (double)p.pmErabEstabAttInitQci5);
        if (!std::isnan(v)) r.volteQci5InitSuccRate = v;
    }

    {
        const double base =
            (double)p.pmDlAssigsTransVolte +
            (double)p.pmUlGrantsTransVolte -
            (double)p.pmUlGrantsTransVolteNoAck;

        const double errors = dmax(0.0,
            base -
            (double)p.pmDlAssigsWithDetectedHarqAckVolte -
            (double)p.pmUlGrantsWithDetectedPuschVolte);

        const double v = pct(errors, base);
        if (!std::isnan(v)) r.pdcchErrorRateVolte = v;
    }

    {
        const double v = pct((double)p.pmHoExeOutSuccQci1,
                             (double)p.pmHoExeOutAttQci1);
        if (!std::isnan(v)) r.volteMobilitySR = v;
    }

    r.volteDropsCount = p.pmErabRelAbnormalEnbActQci1 +
                        p.pmErabRelAbnormalMmeActQci1;

    return r;
}
