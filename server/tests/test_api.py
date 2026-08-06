"""
Tests for FastAPI endpoints.
"""

import sys
import os
import asyncio

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from unittest import mock
from fastapi.testclient import TestClient

from server.config import settings
from server.cache import cache_client
from server.database import clickhouse_client
from server import main


@pytest.fixture
def client():
    """Create a TestClient with mocked dependencies."""
    # Mock ClickHouse client
    with mock.patch.object(clickhouse_client, "check_health", return_value=True), \
         mock.patch.object(clickhouse_client, "get_latest_kpi", return_value=[
             {
                 "datetime": "2024-01-01 00:00:00",
                 "stanica": "STATION_001",
                 "celija": "CELL_001",
                 "klaster": "CLUSTER_001",
                 "band": "800",
                 "pmRrcConnEstabSuccMod": 100,
                 "pmRrcConnEstabSuccMta": 0,
                 "pmRrcConnEstabSuccHpa": 0,
                 "pmRrcConnEstabAttMod": 120,
                 "pmRrcConnEstabAttMta": 0,
                 "pmRrcConnEstabAttHpa": 0,
                 "pmS1SigConnEstabSuccMod": 100,
                 "pmS1SigConnEstabAttMod": 120,
                 "pmErabEstabSuccInitQci1": 100,
                 "pmErabEstabSuccAddedQci1": 100,
                 "pmErabEstabAttInitQci1": 120,
                 "pmErabEstabAttAddedQci1": 120,
                 "pmErabEstabAttAddedHoOngoingQci1": 0,
                 "pmErabRelAbnormalEnbQci1": 2,
                 "pmErabRelAbnormalMmeQci1": 1,
                 "pmErabRelNormalEnbQci1": 100,
                 "pmErabRelMmeQci1": 100,
                 "pmErabQciLevSum1": 7200,
                 "pmErabEstabSuccInitQci5": 100,
                 "pmErabEstabSuccAddedQci5": 100,
                 "pmErabEstabAttInitQci5": 120,
                 "pmErabEstabAttAddedQci5": 120,
                 "pmErabEstabAttAddedHoOngoingQci5": 0,
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
         ]), \
         mock.patch.object(cache_client, "get", return_value=None), \
         mock.patch.object(cache_client, "set", return_value=None):
        yield TestClient(main.app)


class TestBasicEndpoints:
    def test_root_endpoint(self, client):
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "VoLTE KPI API"
        assert "version" in data
        assert "docs" in data

    def test_health_endpoint(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "database" in data
        assert "cache" in data


class TestKpiEndpoints:
    def test_get_kpis(self, client):
        response = client.get("/api/kpis")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["count"] == 1
        assert len(data["data"]) == 1
        assert data["data"][0]["celija"] == "CELL_001"
        assert "metrics" in data

    def test_get_kpis_with_hours_param(self, client):
        response = client.get("/api/kpis?hours=48")
        assert response.status_code == 200
        assert response.json()["success"] is True

    def test_get_kpis_with_invalid_hours(self, client):
        response = client.get("/api/kpis?hours=0")
        assert response.status_code == 422

    def test_get_aggregated_kpis(self, client):
        response = client.get("/api/kpis/aggregated?group_by=cluster")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["group_by"] == "cluster"

    def test_get_kpis_no_data(self):
        with mock.patch.object(clickhouse_client, "get_latest_kpi", return_value=[]):
            from fastapi.testclient import TestClient
            test_client = TestClient(main.app)
            response = test_client.get("/api/kpis")
            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["count"] == 0
            assert data["data"] == []


class TestExportEndpoints:
    def test_export_csv(self, client):
        response = client.get("/api/kpis/export?format=csv")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        assert "volte_kpi" in response.headers["content-disposition"]

    def test_export_json(self, client):
        response = client.get("/api/kpis/export?format=json")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 1
        assert data[0]["celija"] == "CELL_001"


class TestMetadataEndpoints:
    def test_clusters(self, client):
        with mock.patch.object(clickhouse_client, "client", create=True) as mock_client:
            mock_client.execute.return_value = [("CLUSTER_001",), ("CLUSTER_002",)]
            response = client.get("/api/clusters")
            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["clusters"] == ["CLUSTER_001", "CLUSTER_002"]
            assert data["count"] == 2
    
    def test_get_stations(self, client):
        # Just test the endpoint returns a response structure
        response = client.get("/api/stations")
        assert response.status_code == 200


class TestAuth:
    def test_auth_disabled_by_default(self, client):
        response = client.get("/api/kpis")
        assert response.status_code == 200


class TestMonitoring:
    def test_metrics_endpoint_format(self, client):
        # warm the metrics middleware
        client.get("/api/kpis")
        response = client.get("/metrics")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/plain")
        text = response.text
        assert "volte_kpi_uptime_seconds" in text
        assert "volte_kpi_http_requests_total" in text
        assert 'route="/api/kpis"' in text

    def test_send_webhook_honors_the_disabled_setting(self):
        with mock.patch("server.main.settings.NOTIFY_WEBHOOK_ENABLED", False), \
             mock.patch("server.main.settings.NOTIFY_WEBHOOK_URL", "http://hook.example/alert"):
            with mock.patch("server.main.httpx.AsyncClient") as mock_client:
                asyncio.run(main.send_webhook_notification([{"id": "a1"}]))
                mock_client.assert_not_called()

    def test_send_webhook_posts_payload(self):
        with mock.patch("server.main.settings.NOTIFY_WEBHOOK_ENABLED", True), \
             mock.patch("server.main.settings.NOTIFY_WEBHOOK_URL", "http://hook.example/alert"):
            fake_response = mock.MagicMock()
            fake_response.status_code = 200

            async def fake_post(url, json=None):
                return fake_response

            with mock.patch("server.main.httpx.AsyncClient") as mock_client:
                client_instance = mock_client.return_value.__aenter__.return_value
                client_instance.post = mock.AsyncMock(side_effect=fake_post)
                asyncio.run(main.send_webhook_notification([{"id": "a1", "cell": "C1"}]))
                mock_client.assert_called_once()
                _, kwargs = client_instance.post.call_args
                assert kwargs["json"]["type"] == "alert.created"
                assert kwargs["json"]["alerts"] == [{"id": "a1", "cell": "C1"}]

    def test_check_alerts_triggers_webhook_when_enabled(self, client):
        with mock.patch("server.main.settings.NOTIFY_WEBHOOK_ENABLED", True), \
             mock.patch("server.main.settings.NOTIFY_WEBHOOK_URL", "http://hook.example/alert"):
            with mock.patch.object(main, "send_webhook_notification", new=mock.AsyncMock()) as mock_notify:
                client.post("/api/alerts/check?hours=24")
                mock_notify.assert_awaited_once()


class TestRealtimeEndpoints:
    @staticmethod
    def _drain_first_event(request):
        """Drive the SSE generator until the first event, mocking the interval sleep."""

        async def drain():
            resp = await main.stream_kpis(request=request, hours=24, interval=30)
            chunks = []
            with mock.patch("server.main.sleep", new=mock.AsyncMock(return_value=None)):
                async for chunk in resp.body_iterator:
                    chunks.append(chunk)
                    if "event: kpis" in chunks[-1] or "event: error" in chunks[-1]:
                        break
            return chunks

        return asyncio.run(drain())

    @staticmethod
    def _make_request(disconnect_results):
        request = mock.Mock()
        request.is_disconnected = mock.AsyncMock(side_effect=disconnect_results)
        return request

    def test_stream_produces_kpis_event(self, client):
        chunks = self._drain_first_event(self._make_request([False, True]))
        assert any("event: kpis" in c for c in chunks)
        assert any('"success": true' in c for c in chunks)
        assert any("CELL_001" in c for c in chunks)

    def test_stream_emits_error_event_on_failure(self, client):
        with mock.patch.object(main, "get_kpis", side_effect=Exception("db down")):
            chunks = self._drain_first_event(self._make_request([False, True, True]))
        assert any("event: error" in c for c in chunks)
        assert any("db down" in c for c in chunks)

    def test_stream_disconnects_cleanly(self, client):
        chunks = self._drain_first_event(self._make_request([True]))
        assert chunks == []


class TestAlerts:
    def test_get_alerts_returns_structure(self, client):
        response = client.get("/api/alerts")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "alerts" in data

    def test_acknowledge_nonexistent_alert(self, client):
        response = client.post("/api/alerts/nonexistent/acknowledge")
        assert response.status_code == 404

    def test_resolve_nonexistent_alert(self, client):
        response = client.post("/api/alerts/nonexistent/resolve")
        assert response.status_code == 404