"""
VoLTE KPI Calculator (Python implementation)
Replicates the C++ calculateKpis() function for consistency
"""

import math
from typing import Dict, Any, Optional
from dataclasses import dataclass
from datetime import datetime

from .config import settings


@dataclass
class PmCounters:
    """Performance Measurement Counters - mirrors C++ struct"""
    # RRC Connection Establishment
    pmRrcConnEstabSuccMod: int = 0
    pmRrcConnEstabSuccMta: int = 0
    pmRrcConnEstabSuccHpa: int = 0
    pmRrcConnEstabAttMod: int = 0
    pmRrcConnEstabAttMta: int = 0
    pmRrcConnEstabAttHpa: int = 0
    pmRrcConnEstabAttReattMod: int = 0
    pmRrcConnEstabAttReattMta: int = 0
    pmRrcConnEstabAttReattHpa: int = 0
    pmRrcConnEstabFailMmeOvlMod: int = 0

    # S1 Signalling
    pmS1SigConnEstabSuccMod: int = 0
    pmS1SigConnEstabSuccMta: int = 0
    pmS1SigConnEstabSuccHpa: int = 0
    pmS1SigConnEstabAttMod: int = 0
    pmS1SigConnEstabAttMta: int = 0
    pmS1SigConnEstabAttHpa: int = 0

    # E-RAB QCI 1 (VoLTE Audio)
    pmErabEstabSuccInitQci1: int = 0
    pmErabEstabSuccAddedQci1: int = 0
    pmErabEstabAttInitQci1: int = 0
    pmErabEstabAttAddedQci1: int = 0
    pmErabEstabAttAddedHoOngoingQci1: int = 0
    pmErabRelAbnormalEnbQci1: int = 0
    pmErabRelAbnormalMmeQci1: int = 0
    pmErabRelNormalEnbQci1: int = 0
    pmErabRelMmeQci1: int = 0
    pmErabQciLevSum1: int = 0
    pmErabRelAbnormalEnbActQci1: int = 0
    pmErabRelAbnormalMmeActQci1: int = 0

    # E-RAB QCI 5 (IMS Signalling)
    pmErabEstabSuccInitQci5: int = 0
    pmErabEstabSuccAddedQci5: int = 0
    pmErabEstabAttInitQci5: int = 0
    pmErabEstabAttAddedQci5: int = 0
    pmErabEstabAttAddedHoOngoingQci5: int = 0

    # VoIP Quality (UL)
    pmVoipQualityRbUlOk: int = 0
    pmVoipQualityRbUlNok: int = 0

    # PDCCH VoLTE
    pmDlAssigsTransVolte: int = 0
    pmUlGrantsTransVolte: int = 0
    pmUlGrantsTransVolteNoAck: int = 0
    pmDlAssigsWithDetectedHarqAckVolte: int = 0
    pmUlGrantsWithDetectedPuschVolte: int = 0

    # Handover QCI 1
    pmHoExeOutSuccQci1: int = 0
    pmHoExeOutAttQci1: int = 0


@dataclass
class KpiResult:
    """KPI Calculation Result - mirrors C++ struct"""
    celija: str = ""
    stanica: str = ""
    klaster: str = ""
    band: str = ""
    
    # KPI metrics
    volteAccessFailureRate: float = math.nan
    volteDropRate: float = math.nan
    volteCellIntegrity: float = math.nan
    volteErlang: float = math.nan
    volteSuccCalls: int = 0
    volteQci1AddSuccRate: float = math.nan
    volteQci1InitSuccRate: float = math.nan
    volteQci5AddSuccRate: float = math.nan
    volteQci5InitSuccRate: float = math.nan
    pdcchErrorRateVolte: float = math.nan
    volteMobilitySR: float = math.nan
    volteDropsCount: int = 0


# Constants
INTERVALS_PER_HOUR = 720.0


def sd(num: float, den: float) -> float:
    """Safe division - returns NaN if denominator is 0"""
    return math.nan if den <= 0.0 else num / den


def r2(v: float) -> float:
    """Round to 2 decimal places"""
    return round(v * 100.0) / 100.0


def dmax(a: float, b: float) -> float:
    """Max function"""
    return a if a > b else b


def clamp(v: float, lo: float, hi: float) -> float:
    """Clamp value between lo and hi"""
    if v < lo:
        return lo
    if v > hi:
        return hi
    return v


def pct(num: float, den: float) -> float:
    """Calculate percentage with clamping and rounding"""
    ratio = sd(num, den)
    if math.isnan(ratio):
        return math.nan
    return r2(100.0 * clamp(ratio, 0.0, 1.0))


def pm_dict_to_counters(pm_dict: Dict[str, Any]) -> PmCounters:
    """Convert dictionary to PmCounters object"""
    counters = PmCounters()
    
    for field in counters.__dataclass_fields__:
        if field in pm_dict:
            value = pm_dict[field]
            if value is not None:
                setattr(counters, field, int(value))
    
    return counters


def calculate_kpis(
    pm_dict: Dict[str, Any],
    celija: str = "",
    stanica: str = "",
    klaster: str = "",
    band: str = ""
) -> Dict[str, Any]:
    """
    Calculate all 12 VoLTE KPI metrics from PM counters
    
    This is a Python replica of the C++ calculateKpis() function
    for consistency across the system.
    
    Args:
        pm_dict: Dictionary containing PM counter values
        celija: Cell identifier
        stanica: Station identifier
        klaster: Cluster identifier
        band: Frequency band
        
    Returns:
        Dictionary with all calculated KPI metrics
    """
    # Convert dict to PmCounters
    p = pm_dict_to_counters(pm_dict)
    
    result = KpiResult(
        celija=str(celija) if celija else "",
        stanica=str(stanica) if stanica else "",
        klaster=str(klaster) if klaster else "",
        band=str(band) if band else ""
    )
    
    # RRC calculations
    rrcSucc = (
        float(p.pmRrcConnEstabSuccMod) +
        float(p.pmRrcConnEstabSuccMta) +
        float(p.pmRrcConnEstabSuccHpa)
    )
    
    rrcAtt = (
        float(p.pmRrcConnEstabAttMod) +
        float(p.pmRrcConnEstabAttMta) +
        float(p.pmRrcConnEstabAttHpa) -
        float(p.pmRrcConnEstabAttReattMod) -
        float(p.pmRrcConnEstabAttReattMta) -
        float(p.pmRrcConnEstabAttReattHpa) -
        float(p.pmRrcConnEstabFailMmeOvlMod)
    )
    
    # S1 calculations
    s1Succ = (
        float(p.pmS1SigConnEstabSuccMod) +
        float(p.pmS1SigConnEstabSuccMta) +
        float(p.pmS1SigConnEstabSuccHpa)
    )
    
    s1Att = (
        float(p.pmS1SigConnEstabAttMod) +
        float(p.pmS1SigConnEstabAttMta) +
        float(p.pmS1SigConnEstabAttHpa)
    )
    
    # E-RAB QCI1 calculations
    erabSuccQci1 = (
        float(p.pmErabEstabSuccInitQci1) +
        float(p.pmErabEstabSuccAddedQci1)
    )
    
    erabAttQci1 = (
        float(p.pmErabEstabAttInitQci1) +
        float(p.pmErabEstabAttAddedQci1) -
        float(p.pmErabEstabAttAddedHoOngoingQci1)
    )
    
    # E-RAB QCI5 calculations
    erabSuccQci5 = (
        float(p.pmErabEstabSuccInitQci5) +
        float(p.pmErabEstabSuccAddedQci5)
    )
    
    erabAttQci5 = (
        float(p.pmErabEstabAttInitQci5) +
        float(p.pmErabEstabAttAddedQci5) -
        float(p.pmErabEstabAttAddedHoOngoingQci5)
    )
    
    # KPI 1: VoLTE Access Failure Rate
    rrcSR = sd(rrcSucc, rrcAtt)
    s1SR = sd(s1Succ, s1Att)
    erab1SR = sd(erabSuccQci1, erabAttQci1)
    erab5SR = sd(erabSuccQci5, erabAttQci5)
    
    if not any(math.isnan(x) for x in [rrcSR, s1SR, erab1SR, erab5SR]):
        success = (
            clamp(rrcSR, 0.0, 1.0) *
            clamp(s1SR, 0.0, 1.0) *
            clamp(erab1SR, 0.0, 1.0) *
            clamp(erab5SR, 0.0, 1.0)
        )
        result.volteAccessFailureRate = r2(clamp(100.0 - (100.0 * success), 0.0, 100.0))
    
    # KPI 2: VoLTE Drop Rate
    drop_num = float(p.pmErabRelAbnormalEnbQci1) + float(p.pmErabRelAbnormalMmeQci1)
    drop_den = (
        float(p.pmErabRelAbnormalEnbQci1) +
        float(p.pmErabRelNormalEnbQci1) +
        float(p.pmErabRelMmeQci1)
    )
    result.volteDropRate = pct(drop_num, drop_den) if not math.isnan(drop_den) else math.nan
    
    # KPI 3: VoLTE Cell Integrity
    integrity_den = float(p.pmVoipQualityRbUlOk) + float(p.pmVoipQualityRbUlNok)
    result.volteCellIntegrity = pct(float(p.pmVoipQualityRbUlOk), integrity_den) if not math.isnan(integrity_den) else math.nan
    
    # KPI 4: VoLTE Erlang
    result.volteErlang = r2(sd(float(p.pmErabQciLevSum1), INTERVALS_PER_HOUR))
    if math.isnan(result.volteErlang):
        result.volteErlang = 0.0
    
    # KPI 5: VoLTE Success Calls
    result.volteSuccCalls = p.pmErabEstabSuccInitQci1 + p.pmErabEstabSuccAddedQci1
    
    # KPI 6: QCI1 Add Success Rate
    qci1_add_den = float(p.pmErabEstabAttAddedQci1) - float(p.pmErabEstabAttAddedHoOngoingQci1)
    result.volteQci1AddSuccRate = pct(float(p.pmErabEstabSuccAddedQci1), qci1_add_den) if not math.isnan(qci1_add_den) else math.nan
    
    # KPI 7: QCI1 Init Success Rate
    result.volteQci1InitSuccRate = pct(
        float(p.pmErabEstabSuccInitQci1),
        float(p.pmErabEstabAttInitQci1)
    ) if not math.isnan(float(p.pmErabEstabAttInitQci1)) else math.nan
    
    # KPI 8: QCI5 Add Success Rate
    qci5_add_den = float(p.pmErabEstabAttAddedQci5) - float(p.pmErabEstabAttAddedHoOngoingQci5)
    result.volteQci5AddSuccRate = pct(float(p.pmErabEstabSuccAddedQci5), qci5_add_den) if not math.isnan(qci5_add_den) else math.nan
    
    # KPI 9: QCI5 Init Success Rate
    result.volteQci5InitSuccRate = pct(
        float(p.pmErabEstabSuccInitQci5),
        float(p.pmErabEstabAttInitQci5)
    ) if not math.isnan(float(p.pmErabEstabAttInitQci5)) else math.nan
    
    # KPI 10: PDCCH Error Rate
    pdcch_base = (
        float(p.pmDlAssigsTransVolte) +
        float(p.pmUlGrantsTransVolte) -
        float(p.pmUlGrantsTransVolteNoAck)
    )
    pdcch_errors = dmax(
        0.0,
        pdcch_base -
        float(p.pmDlAssigsWithDetectedHarqAckVolte) -
        float(p.pmUlGrantsWithDetectedPuschVolte)
    )
    result.pdcchErrorRateVolte = pct(pdcch_errors, pdcch_base) if not math.isnan(pdcch_base) else math.nan
    
    # KPI 11: VoLTE Mobility SR
    result.volteMobilitySR = pct(
        float(p.pmHoExeOutSuccQci1),
        float(p.pmHoExeOutAttQci1)
    ) if not math.isnan(float(p.pmHoExeOutAttQci1)) else math.nan
    
    # KPI 12: VoLTE Drops Count
    result.volteDropsCount = p.pmErabRelAbnormalEnbActQci1 + p.pmErabRelAbnormalMmeActQci1
    
    # Convert to dictionary
    result_dict = {
        "celija": result.celija,
        "stanica": result.stanica,
        "klaster": result.klaster,
        "band": result.band,
        "volteAccessFailureRate": result.volteAccessFailureRate,
        "volteDropRate": result.volteDropRate,
        "volteCellIntegrity": result.volteCellIntegrity,
        "volteErlang": result.volteErlang,
        "volteSuccCalls": result.volteSuccCalls,
        "volteQci1AddSuccRate": result.volteQci1AddSuccRate,
        "volteQci1InitSuccRate": result.volteQci1InitSuccRate,
        "volteQci5AddSuccRate": result.volteQci5AddSuccRate,
        "volteQci5InitSuccRate": result.volteQci5InitSuccRate,
        "pdcchErrorRateVolte": result.pdcchErrorRateVolte,
        "volteMobilitySR": result.volteMobilitySR,
        "volteDropsCount": result.volteDropsCount,
    }
    
    # Remove NaN values and convert to None for JSON serialization
    for key, value in result_dict.items():
        if isinstance(value, float) and math.isnan(value):
            result_dict[key] = None
    
    return result_dict


def calculate_kpis_batch(pm_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Calculate KPIs for a batch of PM counter dictionaries
    
    Args:
        pm_list: List of PM counter dictionaries
        
    Returns:
        List of calculated KPI dictionaries
    """
    results = []
    for pm_dict in pm_list:
        result = calculate_kpis(
            pm_dict,
            celija=pm_dict.get("celija", ""),
            stanica=pm_dict.get("stanica", ""),
            klaster=pm_dict.get("klaster", ""),
            band=pm_dict.get("band", "")
        )
        
        # Add datetime if present
        if "datetime" in pm_dict:
            result["datetime"] = pm_dict["datetime"]
        
        results.append(result)
    
    return results


def get_cell_status(kpi_data: Dict[str, Any], thresholds: Optional[Dict] = None) -> str:
    """
    Determine cell status based on KPI values and SLA thresholds
    
    Args:
        kpi_data: Dictionary with KPI values
        thresholds: Optional custom thresholds
        
    Returns:
        Status string: "GOOD", "WARNING", or "BAD"
    """
    if thresholds is None:
        thresholds = {
            "drop_rate": settings.SLA_DROP_RATE,
            "access_fail_rate": settings.SLA_ACCESS_FAIL_RATE,
            "cell_integrity": settings.SLA_CELL_INTEGRITY,
        }
    
    drop_rate = kpi_data.get("volteDropRate", 0)
    access_fail = kpi_data.get("volteAccessFailureRate", 0)
    integrity = kpi_data.get("volteCellIntegrity", 100)
    
    # Check for BAD status
    if (
        (drop_rate is not None and drop_rate > thresholds["drop_rate"] * 2) or
        (access_fail is not None and access_fail > thresholds["access_fail_rate"] * 2.5) or
        (integrity is not None and integrity < thresholds["cell_integrity"] - 2)
    ):
        return "BAD"
    
    # Check for WARNING status
    if (
        (drop_rate is not None and drop_rate > thresholds["drop_rate"]) or
        (access_fail is not None and access_fail > thresholds["access_fail_rate"]) or
        (integrity is not None and integrity < thresholds["cell_integrity"])
    ):
        return "WARNING"
    
    return "GOOD"


def calculate_aggregated_metrics(kpi_list: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Calculate aggregated metrics from a list of KPI data
    
    Args:
        kpi_list: List of KPI dictionaries
        
    Returns:
        Dictionary with aggregated metrics
    """
    if not kpi_list:
        return {
            "avg_drop_rate": None,
            "avg_access_fail_rate": None,
            "avg_cell_integrity": None,
            "total_erlang": 0,
            "total_success_calls": 0,
            "total_drops_count": 0,
            "total_cells": 0
        }
    
    valid_data = [k for k in kpi_list if k.get("volteDropRate") is not None]
    
    if not valid_data:
        return {
            "avg_drop_rate": None,
            "avg_access_fail_rate": None,
            "avg_cell_integrity": None,
            "total_erlang": 0,
            "total_success_calls": 0,
            "total_drops_count": 0,
            "total_cells": len(kpi_list)
        }
    
    n = len(valid_data)
    
    return {
        "avg_drop_rate": sum(k.get("volteDropRate", 0) or 0 for k in valid_data) / n,
        "avg_access_fail_rate": sum(k.get("volteAccessFailureRate", 0) or 0 for k in valid_data) / n,
        "avg_cell_integrity": sum(k.get("volteCellIntegrity", 0) or 0 for k in valid_data) / n,
        "total_erlang": sum(k.get("volteErlang", 0) or 0 for k in valid_data),
        "total_success_calls": sum(k.get("volteSuccCalls", 0) or 0 for k in valid_data),
        "total_drops_count": sum(k.get("volteDropsCount", 0) or 0 for k in valid_data),
        "total_cells": n
    }
