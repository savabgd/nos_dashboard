"""
Tests for the KPI calculator module.
"""

import math
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from server.kpi_calculator import (
    calculate_kpis,
    calculate_kpis_batch,
    calculate_aggregated_metrics,
    get_cell_status,
    sd,
    r2,
    pct,
    clamp,
)


class TestUtilityFunctions:
    def test_sd_valid(self):
        assert sd(10, 20) == 0.5

    def test_sd_zero_denominator(self):
        assert math.isnan(sd(10, 0))

    def test_sd_negative_denominator(self):
        assert math.isnan(sd(10, -5))

    def test_r2_rounding(self):
        assert r2(3.14159) == 3.14
        assert r2(3.145) == 3.14  # Python banker's rounding
        assert r2(3.155) == 3.16

    def test_clamp(self):
        assert clamp(5, 0, 10) == 5
        assert clamp(-5, 0, 10) == 0
        assert clamp(15, 0, 10) == 10

    def test_pct(self):
        assert pct(50, 100) == 50.0
        assert pct(100, 50) == 100.0  # clamped at 100
        assert math.isnan(pct(10, 0))


class TestCalculateKpis:
    def make_pm_dict(self, **overrides):
        """Create a valid PM counter dict."""
        base = {
            "pmRrcConnEstabSuccMod": 100,
            "pmRrcConnEstabSuccMta": 0,
            "pmRrcConnEstabSuccHpa": 0,
            "pmRrcConnEstabAttMod": 120,
            "pmRrcConnEstabAttMta": 0,
            "pmRrcConnEstabAttHpa": 0,
            "pmRrcConnEstabAtReattMod": 0,
            "pmRrcConnEstabAtReattMta": 0,
            "pmRrcConnEstabAtReattHpa": 0,
            "pmRrcConnEstabFailMmeOvlMod": 0,
            "pmS1SigConnEstabSuccMod": 100,
            "pmS1SigConnEstabSuccMta": 0,
            "pmS1SigConnEstabSuccHpa": 0,
            "pmS1SigConnEstabAttMod": 120,
            "pmS1SigConnEstabAttMta": 0,
            "pmS1SigConnEstabAttHpa": 0,
            "pmErabEstabSuccInitQci1": 100,
            "pmErabEstabSuccAddedQci1": 100,
            "pmErabEstabAttInitQci1": 120,
            "pmErabEstabAttAddedQci1": 120,
            "pmErabEstabAttAddedHoOngoingQci1": 10,
            "pmErabRelAbnormalEnbQci1": 5,
            "pmErabRelAbnormalMmeQci1": 5,
            "pmErabRelNormalEnbQci1": 100,
            "pmErabRelMmeQci1": 100,
            "pmErabQciLevSum1": 7200,
            "pmErabEstabSuccInitQci5": 100,
            "pmErabEstabSuccAddedQci5": 100,
            "pmErabEstabAttInitQci5": 120,
            "pmErabEstabAttAddedQci5": 120,
            "pmErabEstabAttAddedHoOngoingQci5": 10,
            "pmVoipQualityRbUlOk": 1000,
            "pmVoipQualityRbUlNok": 50,
            "pmDlAssigsTransVolte": 500,
            "pmUlGrantsTransVolte": 500,
            "pmUlGrantsTransVolteNoAck": 0,
            "pmDlAssigsWithDetectedHarqAckVolte": 450,
            "pmUlGrantsWithDetectedPuschVolte": 450,
            "pmHoExeOutSuccQci1": 100,
            "pmHoExeOutAttQci1": 110,
        }
        base.update(overrides)
        return base

    def test_returns_all_expected_fields(self):
        result = calculate_kpis(self.make_pm_dict(), celija="C1", stanica="S1", klaster="K1", band="800")
        expected_fields = [
            "celija", "stanica", "klaster", "band",
            "volteAccessFailureRate", "volteDropRate", "volteCellIntegrity",
            "volteErlang", "volteSuccCalls", "volteQci1AddSuccRate",
            "volteQci1InitSuccRate", "volteQci5AddSuccRate", "volteQci5InitSuccRate",
            "pdcchErrorRateVolte", "volteMobilitySR", "volteDropsCount",
        ]
        for field in expected_fields:
            assert field in result

    def test_empty_pm_dict_returns_none_for_invalid_metrics(self):
        result = calculate_kpis({})
        assert result["volteAccessFailureRate"] is None
        assert result["volteDropRate"] is None
        assert result["volteCellIntegrity"] is None
        assert result["pdcchErrorRateVolte"] is None

    def test_all_zero_pm_dict(self):
        result = calculate_kpis(self.make_pm_dict(**{
            "pmRrcConnEstabSuccMod": 0,
            "pmRrcConnEstabAttMod": 0,
            "pmS1SigConnEstabSuccMod": 0,
            "pmS1SigConnEstabAttMod": 0,
            "pmErabEstabSuccInitQci1": 0,
            "pmErabEstabAttInitQci1": 0,
            "pmErabEstabSuccAddedQci1": 0,
            "pmErabEstabAttAddedQci1": 0,
            "pmErabQciLevSum1": 0,
            "pmVoipQualityRbUlOk": 0,
            "pmVoipQualityRbUlNok": 0,
            "pmErabRelAbnormalEnbQci1": 0,
            "pmErabRelAbnormalMmeQci1": 0,
            "pmErabRelNormalEnbQci1": 0,
            "pmErabRelMmeQci1": 0,
            "pmErabRelAbnormalEnbActQci1": 0,
            "pmErabRelAbnormalMmeActQci1": 0,
        }))
        # When no data, KPIs should be None or 0
        assert result["volteDropRate"] is None
        assert result["volteCellIntegrity"] is None
        assert result["volteErlang"] == 0.0
        assert result["volteSuccCalls"] == 0
        assert result["volteDropsCount"] == 0

    def test_fully_healthy_network(self):
        """Perfect network (succ == att everywhere) should yield ideal KPI values."""
        result = calculate_kpis(self.make_pm_dict(**{
            "pmRrcConnEstabAttMod": 100,
            "pmS1SigConnEstabAttMod": 100,
            "pmErabEstabAttInitQci1": 100,
            "pmErabEstabAttAddedQci1": 100,
            "pmErabEstabAttAddedHoOngoingQci1": 0,
            "pmErabEstabAttInitQci5": 100,
            "pmErabEstabAttAddedQci5": 100,
            "pmErabEstabAttAddedHoOngoingQci5": 0,
            "pmErabRelAbnormalEnbQci1": 0,
            "pmErabRelAbnormalMmeQci1": 0,
            "pmVoipQualityRbUlNok": 0,
        }))
        assert result["volteAccessFailureRate"] == 0.0
        assert result["volteCellIntegrity"] == 100.0
        assert result["volteDropRate"] == 0.0
        assert result["volteErlang"] == 10.0  # 7200/720

    def test_high_drop_rate_network(self):
        """High dropped calls should push Drop Rate up."""
        result = calculate_kpis(self.make_pm_dict(**{
            "pmErabRelAbnormalEnbQci1": 80,
            "pmErabRelAbnormalMmeQci1": 40,
            "pmErabRelNormalEnbQci1": 100,
            "pmErabRelMmeQci1": 100,
        }))
        # drop_num = 80+40=120, drop_den = 80+100+100=280 → 42.857%
        assert result["volteDropRate"] == 42.86

    def test_volte_drops_count_correct(self):
        result = calculate_kpis(self.make_pm_dict(**{
            "pmErabRelAbnormalEnbActQci1": 7,
            "pmErabRelAbnormalMmeActQci1": 3,
        }))
        assert result["volteDropsCount"] == 10

    def test_metadata_preserved(self):
        result = calculate_kpis(
            self.make_pm_dict(),
            celija="CELL_123",
            stanica="STATION_1",
            klaster="CLUSTER_A",
            band="2100",
        )
        assert result["celija"] == "CELL_123"
        assert result["stanica"] == "STATION_1"
        assert result["klaster"] == "CLUSTER_A"
        assert result["band"] == "2100"


class TestCalculateKpisBatch:
    def test_batch_multiple_records(self):
        pm_list = [
            {"celija": f"CELL_{i}", "pmRrcConnEstabSuccMod": 100,
             "pmRrcConnEstabAttMod": 120}
            for i in range(3)
        ]
        results = calculate_kpis_batch(pm_list)
        assert len(results) == 3
        for result in results:
            assert "celija" in result

    def test_batch_empty_list(self):
        assert calculate_kpis_batch([]) == []

    def test_batch_preserves_datetime(self):
        pm_list = [
            {"celija": "CELL_1", "datetime": "2024-01-01 00:00:00",
             "pmRrcConnEstabSuccMod": 100}
        ]
        results = calculate_kpis_batch(pm_list)
        assert results[0]["datetime"] == "2024-01-01 00:00:00"


class TestGetCellStatus:
    def make_kpi(self, **overrides):
        base = {
            "volteDropRate": 1.0,
            "volteAccessFailureRate": 1.0,
            "volteCellIntegrity": 98.0,
        }
        base.update(overrides)
        return base

    def test_good_status(self):
        assert get_cell_status(self.make_kpi()) == "GOOD"

    def test_warning_status_drop_rate(self):
        assert get_cell_status(self.make_kpi(volteDropRate=2.0)) == "WARNING"

    def test_warning_status_access_fail(self):
        assert get_cell_status(self.make_kpi(volteAccessFailureRate=3.0)) == "WARNING"

    def test_warning_status_integrity(self):
        assert get_cell_status(self.make_kpi(volteCellIntegrity=96.5)) == "WARNING"

    def test_bad_status_drop_rate(self):
        assert get_cell_status(self.make_kpi(volteDropRate=4.0)) == "BAD"

    def test_bad_status_access_fail(self):
        assert get_cell_status(self.make_kpi(volteAccessFailureRate=5.5)) == "BAD"

    def test_bad_status_integrity(self):
        assert get_cell_status(self.make_kpi(volteCellIntegrity=94.0)) == "BAD"

    def test_custom_thresholds(self):
        thresholds = {
            "drop_rate": 3.0,
            "access_fail_rate": 4.0,
            "cell_integrity": 95.0,
        }
        assert get_cell_status(self.make_kpi(volteDropRate=3.5), thresholds) == "WARNING"
        assert get_cell_status(self.make_kpi(volteDropRate=6.5), thresholds) == "BAD"


class TestCalculateAggregatedMetrics:
    def test_empty_list(self):
        result = calculate_aggregated_metrics([])
        assert result["total_cells"] == 0
        assert result["avg_drop_rate"] is None
        assert result["total_erlang"] == 0

    def test_list_with_valid_data(self):
        kpi_list = [
            {"volteDropRate": 1.0, "volteAccessFailureRate": 2.0,
             "volteCellIntegrity": 98.0, "volteErlang": 20,
             "volteSuccCalls": 100, "volteDropsCount": 5},
            {"volteDropRate": 2.0, "volteAccessFailureRate": 4.0,
             "volteCellIntegrity": 98.0, "volteErlang": 30,
             "volteSuccCalls": 200, "volteDropsCount": 10},
        ]
        result = calculate_aggregated_metrics(kpi_list)
        assert result["total_cells"] == 2
        assert result["avg_drop_rate"] == 1.5
        assert result["avg_access_fail_rate"] == 3.0
        assert result["avg_cell_integrity"] == 98.0
        assert result["total_erlang"] == 50
        assert result["total_success_calls"] == 300
        assert result["total_drops_count"] == 15

    def test_list_with_some_none_values(self):
        kpi_list = [
            {"volteDropRate": 1.0, "volteAccessFailureRate": 2.0,
             "volteCellIntegrity": 98.0, "volteErlang": 20,
             "volteSuccCalls": 100, "volteDropsCount": 5},
            {"volteDropRate": None, "volteAccessFailureRate": None,
             "volteCellIntegrity": None, "volteErlang": 0,
             "volteSuccCalls": 0, "volteDropsCount": 0},
        ]
        result = calculate_aggregated_metrics(kpi_list)
        assert result["total_cells"] == 1  # only valid data

    def test_list_with_all_none(self):
        kpi_list = [
            {"volteDropRate": None, "volteErlang": 0},
            {"volteDropRate": None, "volteErlang": 0},
        ]
        result = calculate_aggregated_metrics(kpi_list)
        assert result["total_cells"] == 2
        assert result["avg_drop_rate"] is None