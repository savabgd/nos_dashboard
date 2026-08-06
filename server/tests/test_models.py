"""
Tests for the Pydantic models.
"""

import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from pydantic import ValidationError
from datetime import datetime

from server.models import (
    CellStatus,
    KpiThresholds,
    KpiQueryRequest,
    AggregationRequest,
    KpiMetrics,
    KpiCellData,
    KpiResponse,
    AggregatedKpiResponse,
    HealthResponse,
    ErrorResponse,
    Alert,
    AlertResponse,
    ExportRequest,
)


class TestCellStatus:
    def test_enum_values(self):
        assert CellStatus.GOOD.value == "GOOD"
        assert CellStatus.WARNING.value == "WARNING"
        assert CellStatus.BAD.value == "BAD"


class TestKpiThresholds:
    def test_defaults(self):
        thresholds = KpiThresholds()
        assert thresholds.access_fail_rate == 2.0
        assert thresholds.drop_rate == 1.5
        assert thresholds.cell_integrity == 97.0
        assert thresholds.pdcch_error == 3.0
        assert thresholds.erlang_per_sector == 40.0

    def test_custom_values(self):
        thresholds = KpiThresholds(
            access_fail_rate=3.5,
            drop_rate=2.0,
            cell_integrity=95.0,
        )
        assert thresholds.access_fail_rate == 3.5
        assert thresholds.drop_rate == 2.0
        assert thresholds.cell_integrity == 95.0


class TestKpiQueryRequest:
    def test_defaults(self):
        req = KpiQueryRequest()
        assert req.hours == 24
        assert req.cluster is None

    def test_valid_custom(self):
        req = KpiQueryRequest(hours=48, cluster="CENTAR_BGD", band="1800")
        assert req.hours == 48
        assert req.cluster == "CENTAR_BGD"
        assert req.band == "1800"

    def test_hours_below_min(self):
        with pytest.raises(ValidationError):
            KpiQueryRequest(hours=0)

    def test_hours_above_max(self):
        with pytest.raises(ValidationError):
            KpiQueryRequest(hours=169)


class TestAggregationRequest:
    def test_defaults(self):
        req = AggregationRequest()
        assert req.group_by == "cluster"
        assert req.hours == 24

    def test_custom_group_by(self):
        req = AggregationRequest(group_by="station", hours=48)
        assert req.group_by == "station"
        assert req.hours == 48


class TestKpiCellData:
    def make_cell(self, **overrides):
        base = {
            "celija": "CELL_001",
            "stanica": "STATION_001",
            "klaster": "CLUSTER_001",
            "band": "800",
            "volteAccessFailureRate": 1.5,
            "volteDropRate": 1.0,
            "volteCellIntegrity": 98.5,
            "volteErlang": 25.5,
            "volteSuccCalls": 1500,
            "volteMobilitySR": 99.0,
            "pdcchErrorRateVolte": 1.2,
            "volteDropsCount": 3,
            "status": "GOOD",
        }
        base.update(overrides)
        return base

    def test_valid_cell(self):
        cell = KpiCellData(**self.make_cell())
        assert cell.celija == "CELL_001"
        assert cell.status == CellStatus.GOOD

    def test_missing_required_field(self):
        data = self.make_cell()
        del data["celija"]
        with pytest.raises(ValidationError):
            KpiCellData(**data)

    def test_status_enum_conversion(self):
        cell = KpiCellData(**self.make_cell(status="BAD"))
        assert cell.status == CellStatus.BAD

    def test_optional_fields(self):
        cell = KpiCellData(**self.make_cell())
        assert cell.volteQci1AddSuccRate is None
        assert cell.datetime is None


class TestKpiResponse:
    def test_defaults(self):
        response = KpiResponse()
        assert response.success is True
        assert response.data == []
        assert response.count == 0

    def test_with_data(self):
        cell = KpiCellData(
            celija="CELL_001", stanica="S1", klaster="K1", band="800",
            volteAccessFailureRate=1.5, volteDropRate=1.0,
            volteCellIntegrity=98.5, volteErlang=25.5,
            volteSuccCalls=1500, volteMobilitySR=99.0,
            pdcchErrorRateVolte=1.2, volteDropsCount=3,
            status="GOOD",
        )
        response = KpiResponse(data=[cell], count=1)
        assert response.count == 1
        assert response.data[0].celija == "CELL_001"


class TestHealthResponse:
    def test_defaults(self):
        health = HealthResponse(version="1.0.0", database="connected", cache="enabled")
        assert health.status == "healthy"
        assert isinstance(health.timestamp, datetime)


class TestErrorResponse:
    def test_fields(self):
        error = ErrorResponse(error="Not found", code=404)
        assert error.success is False
        assert error.error == "Not found"
        assert error.code == 404
        assert error.details is None


class TestAlert:
    def test_alert_creation(self):
        alert = Alert(
            id="alert-1",
            cell="CELL_001",
            cluster="K1",
            metric="Drop Rate",
            value=5.0,
            threshold=1.5,
            severity="HIGH",
            status="NEW",
        )
        assert alert.id == "alert-1"
        assert alert.severity == "HIGH"
        assert isinstance(alert.created_at, datetime)
        assert alert.resolved_at is None


class TestAlertResponse:
    def test_empty(self):
        response = AlertResponse()
        assert response.success is True
        assert response.alerts == []
        assert response.active_count == 0


class TestExportRequest:
    def test_defaults(self):
        req = ExportRequest()
        assert req.hours == 24
        assert req.format == "csv"

    def test_invalid_hours(self):
        with pytest.raises(ValidationError):
            ExportRequest(hours=200)