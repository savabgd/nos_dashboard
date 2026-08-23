"""
VoLTE KPI API - FastAPI Main Application
Main REST API endpoint for KPI data
"""

import logging
import time
import json
import os
import asyncio
from datetime import datetime
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

import httpx

from fastapi import FastAPI, HTTPException, Query, Depends, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.exceptions import RequestValidationError
import uvicorn

from .config import settings
from .models import (
    KpiResponse,
    KpiMetrics,
    KpiQueryRequest,
    AggregatedKpiResponse,
    HealthResponse,
    ErrorResponse,
    AlertResponse,
    ExportRequest
)
from .database import clickhouse_client
from .kpi_calculator import (
    calculate_kpis_batch,
    calculate_aggregated_metrics,
    get_cell_status
)
from .cache import cache_client
from .alert_models import Base, AlertRecord, AlertStatus, AlertSeverity
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


# Lifespan management
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan management"""
    # Startup
    logger.info("Starting VoLTE KPI API...")
    
    # Connect to database
    if not clickhouse_client.check_health():
        logger.warning("Could not connect to ClickHouse database")
    else:
        logger.info("ClickHouse database connected successfully")
    
    yield
    
    # Shutdown
    logger.info("Shutting down VoLTE KPI API...")
    clickhouse_client.close()


# Create FastAPI app
app = FastAPI(
    title=settings.API_TITLE,
    version=settings.API_VERSION,
    description=settings.API_DESCRIPTION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json"
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Exception handlers
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, 
    exc: RequestValidationError
):
    """Handle validation errors"""
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=ErrorResponse(
            success=False,
            error="Validation error",
            code=422,
            details={"errors": exc.errors()},
            timestamp=datetime.utcnow()
        ).model_dump(mode="json")
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Handle HTTP exceptions"""
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            success=False,
            error=exc.detail,
            code=exc.status_code,
            timestamp=datetime.utcnow()
        ).model_dump(mode="json")
    )


# Security
security = HTTPBearer(auto_error=False)


async def verify_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
):
    """Verify authentication token if auth is enabled"""
    if not settings.AUTH_ENABLED:
        return True
    
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required"
        )
    
    token = credentials.credentials
    # In production, verify JWT token here
    if token != settings.AUTH_SECRET:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token"
        )
    
    return True


# Dependency for database
async def get_db():
    """Get database client"""
    if not clickhouse_client.is_connected():
        clickhouse_client.connect()
    return clickhouse_client


# ============================================================================
# Monitoring
# ============================================================================

# Simple in-process metrics exposed in Prometheus text format.
_request_counts: Dict[str, int] = {}
_request_latency: Dict[str, float] = {"sum": 0.0, "count": 0}
_app_start_time = time.time()


@app.middleware("http")
async def record_request_metrics(request: Request, call_next):
    """Record request counts and latency for the /metrics endpoint."""
    start = time.time()
    response = await call_next(request)
    duration = time.time() - start

    if settings.METRICS_ENABLED:
        route = request.url.path
        _request_counts[route] = _request_counts.get(route, 0) + 1
        _request_latency["sum"] += duration
        _request_latency["count"] += 1
    return response


# ============================================================================
# API Endpoints
# ============================================================================

@app.get("/", tags=["Health"])
async def root():
    """Root endpoint"""
    return {
        "message": "VoLTE KPI API",
        "version": settings.API_VERSION,
        "docs": "/docs"
    }


@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint"""
    db_status = "connected" if clickhouse_client.check_health() else "disconnected"
    cache_status = "enabled" if cache_client.redis_client else "disabled (in-memory)"
    
    return HealthResponse(
        status="healthy",
        version=settings.API_VERSION,
        database=db_status,
        cache=cache_status,
        timestamp=datetime.utcnow()
    )


@app.get(
    "/metrics",
    tags=["Monitoring"],
    summary="Prometheus metrics",
    description="Expose application metrics in Prometheus text exposition format"
)
async def metrics_endpoint():
    """Prometheus metrics endpoint"""
    uptime_seconds = time.time() - _app_start_time
    total_count = _request_latency["count"]
    total_sum = _request_latency["sum"]
    
    lines = [
        "# HELP volte_kpi_uptime_seconds Process uptime in seconds",
        "# TYPE volte_kpi_uptime_seconds gauge",
        f"volte_kpi_uptime_seconds {uptime_seconds:.3f}",
        "# HELP volte_kpi_http_requests_total Total HTTP requests by route",
        "# TYPE volte_kpi_http_requests_total counter",
    ]
    for route in sorted(_request_counts):
        lines.append(
            f"volte_kpi_http_requests_total{{route=\"{route}\"}} {_request_counts[route]}"
        )
    lines.append(
        "# HELP volte_kpi_http_request_duration_seconds_sum Total request duration"
    )
    lines.append("# TYPE volte_kpi_http_request_duration_seconds_sum counter")
    lines.append(
        f"volte_kpi_http_request_duration_seconds_sum {total_sum:.6f}"
    )
    lines.append(
        "# HELP volte_kpi_http_request_duration_seconds_count Total number of requests"
    )
    lines.append("# TYPE volte_kpi_http_request_duration_seconds_count counter")
    lines.append(f"volte_kpi_http_request_duration_seconds_count {total_count}")
    lines.append("# HELP volte_kpi_db_connected Database connectivity (1=connected)")
    lines.append("# TYPE volte_kpi_db_connected gauge")
    lines.append(
        f"volte_kpi_db_connected {1 if clickhouse_client.check_health() else 0}"
    )
    
    return Response(
        content="\n".join(lines) + "\n",
        media_type="text/plain; version=0.0.4",
    )


@app.get(
    "/api/kpis",
    response_model=KpiResponse,
    tags=["KPI Data"],
    summary="Get KPI data",
    description="Retrieve VoLTE KPI data with optional filters"
)
async def get_kpis(
    hours: int = Query(
        default=24,
        ge=1,
        le=168,
        description="Time range in hours (1-168)"
    ),
    cluster: Optional[str] = Query(
        default=None,
        description="Filter by cluster"
    ),
    station: Optional[str] = Query(
        default=None,
        description="Filter by station"
    ),
    cell: Optional[str] = Query(
        default=None,
        description="Filter by specific cell"
    ),
    band: Optional[str] = Query(
        default=None,
        description="Filter by frequency band"
    ),
    _: bool = Depends(verify_token)
):
    """
    Get VoLTE KPI data for the specified time range and filters.
    
    This endpoint:
    1. Fetches raw PM counter data from ClickHouse
    2. Calculates all 12 KPI metrics using the same formulas as C++ calculator
    3. Determines cell status based on SLA thresholds
    4. Returns aggregated metrics
    """
    # Generate cache key
    cache_key = f"kpis:{hours}:{cluster}:{station}:{cell}:{band}"
    
    # Try to get from cache
    cached_response = cache_client.get(cache_key)
    if cached_response is not None:
        logger.debug(f"Cache hit for KPI data: {cache_key}")
        return KpiResponse(**cached_response)
    
    logger.debug(f"Fetching KPI data from database")
    
    # Fetch raw PM counter data (filters applied in SQL for performance)
    # to_thread — sinkroni ClickHouse driver NE SME da blokira event loop
    start_time = time.time()
    pm_data = await asyncio.to_thread(
        clickhouse_client.get_latest_kpi,
        hours=hours,
        limit=10000,
        cluster=cluster,
        station=station,
        cell=cell,
        band=band,
    )
    db_time = time.time() - start_time
    logger.debug(f"Database query took {db_time:.3f}s")
    
    if not pm_data:
        logger.warning("No KPI data found, returning empty response")
        response = KpiResponse(
            success=True,
            data=[],
            metrics=KpiMetrics(total_cells=0),
            count=0,
            timestamp=datetime.utcnow()
        )
        cache_client.set(cache_key, response.model_dump(mode="json"), ttl=60)
        return response
    
    # Calculate KPIs for each record
    calc_start = time.time()
    kpi_data = calculate_kpis_batch(pm_data)
    calc_time = time.time() - calc_start
    logger.debug(f"KPI calculation took {calc_time:.3f}s for {len(pm_data)} records")
    
    # Add status to each cell
    thresholds = {
        "drop_rate": settings.SLA_DROP_RATE,
        "access_fail_rate": settings.SLA_ACCESS_FAIL_RATE,
        "cell_integrity": settings.SLA_CELL_INTEGRITY,
    }
    
    for kpi in kpi_data:
        kpi["status"] = get_cell_status(kpi, thresholds)
    
    # Calculate aggregated metrics
    metrics = calculate_aggregated_metrics(kpi_data)
    
    # Build response
    response = KpiResponse(
        success=True,
        data=kpi_data,
        metrics=KpiMetrics(**metrics),
        count=len(kpi_data),
        timestamp=datetime.utcnow()
    )
    
    # Cache response
    cache_client.set(cache_key, response.model_dump(mode="json"), ttl=settings.CACHE_TTL)
    
    logger.info(f"Returning {len(kpi_data)} KPI records")
    return response


@app.get(
    "/api/kpis/aggregated",
    response_model=AggregatedKpiResponse,
    tags=["KPI Data"],
    summary="Get aggregated KPI data",
    description="Retrieve aggregated KPI metrics grouped by cluster, station, band, etc."
)
async def get_aggregated_kpis(
    group_by: str = Query(
        default="cluster",
        description="Group by field: cluster, station, band, celija"
    ),
    hours: int = Query(
        default=24,
        ge=1,
        le=168,
        description="Time range in hours"
    ),
    _: bool = Depends(verify_token)
):
    """
    Get aggregated KPI data grouped by specified field.
    
    Returns average metrics for each group.
    """
    cache_key = f"agg_kpis:{group_by}:{hours}"
    
    cached_response = cache_client.get(cache_key)
    if cached_response is not None:
        return AggregatedKpiResponse(**cached_response)
    
    # Fetch and calculate KPI data (u thread pool-u — ne blokira event loop)
    pm_data = await asyncio.to_thread(clickhouse_client.get_latest_kpi, hours=hours, limit=10000)
    kpi_data = calculate_kpis_batch(pm_data)
    
    # Group and aggregate
    groups: Dict[str, List[Dict]] = {}
    for kpi in kpi_data:
        key = kpi.get(group_by, "unknown")
        if key not in groups:
            groups[key] = []
        groups[key].append(kpi)
    
    aggregated_data = []
    for key, items in groups.items():
        metrics = calculate_aggregated_metrics(items)
        aggregated_data.append({
            group_by: key,
            "cell_count": metrics["total_cells"],
            "avg_access_fail_rate": metrics["avg_access_fail_rate"],
            "avg_drop_rate": metrics["avg_drop_rate"],
            "avg_cell_integrity": metrics["avg_cell_integrity"],
            "total_erlang": metrics["total_erlang"],
            "total_success_calls": metrics["total_success_calls"],
            "total_drops_count": metrics["total_drops_count"]
        })
    
    response = AggregatedKpiResponse(
        success=True,
        data=aggregated_data,
        group_by=group_by,
        total_count=len(kpi_data),
        timestamp=datetime.utcnow()
    )
    
    cache_client.set(cache_key, response.model_dump(mode="json"), ttl=settings.CACHE_TTL)
    return response


@app.get(
    "/api/kpis/export",
    tags=["KPI Data"],
    summary="Export KPI data",
    description="Export KPI data in CSV or JSON format"
)
async def export_kpis(
    hours: int = Query(
        default=24,
        ge=1,
        le=168,
        description="Time range in hours"
    ),
    format: str = Query(
        default="csv",
        description="Export format: csv, json"
    ),
    _: bool = Depends(verify_token)
):
    """
    Export KPI data in the specified format.
    
    Returns:
    - CSV: Streaming CSV response
    - JSON: JSON array of KPI data
    """
    # Get KPI data
    kpi_response = await get_kpis(
        hours=hours,
        cluster=None,
        station=None,
        cell=None,
        band=None,
    )
    kpi_data = [kpi.model_dump(mode="json") for kpi in kpi_response.data]
    
    if format.lower() == "csv":
        # Generate CSV
        import csv
        import io
        
        output = io.StringIO()
        writer = csv.DictWriter(
            output,
            fieldnames=[
                "celija", "stanica", "klaster", "band",
                "volteAccessFailureRate", "volteDropRate", "volteCellIntegrity",
                "volteErlang", "volteSuccCalls", "volteMobilitySR",
                "pdcchErrorRateVolte", "volteDropsCount", "status"
            ]
        )
        
        writer.writeheader()
        for kpi in kpi_data:
            row = {
                "celija": kpi.get("celija", ""),
                "stanica": kpi.get("stanica", ""),
                "klaster": kpi.get("klaster", ""),
                "band": kpi.get("band", ""),
                "volteAccessFailureRate": kpi.get("volteAccessFailureRate", ""),
                "volteDropRate": kpi.get("volteDropRate", ""),
                "volteCellIntegrity": kpi.get("volteCellIntegrity", ""),
                "volteErlang": kpi.get("volteErlang", ""),
                "volteSuccCalls": kpi.get("volteSuccCalls", ""),
                "volteMobilitySR": kpi.get("volteMobilitySR", ""),
                "pdcchErrorRateVolte": kpi.get("pdcchErrorRateVolte", ""),
                "volteDropsCount": kpi.get("volteDropsCount", ""),
                "status": kpi.get("status", "")
            }
            writer.writerow(row)
        
        # Return as streaming response
        csv_data = output.getvalue()
        output.close()
        
        return StreamingResponse(
            iter([csv_data.encode()]),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename=volte_kpi_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
            }
        )
    
    else:
        # Return as JSON
        return JSONResponse(
            content=kpi_data,
            media_type="application/json",
            headers={
                "Content-Disposition": f"attachment; filename=volte_kpi_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            }
        )


@app.get(
    "/api/clusters",
    tags=["Metadata"],
    summary="Get list of clusters"
)
async def get_clusters(_: bool = Depends(verify_token)):
    """Get list of all clusters"""
    cache_key = "clusters"
    
    cached = cache_client.get(cache_key)
    if cached:
        return {"success": True, "clusters": cached, "count": len(cached)}
    
    query = "SELECT DISTINCT klaster FROM pm_counters ORDER BY klaster"
    try:
        result = await asyncio.to_thread(clickhouse_client.client.execute, query)
        clusters = [row[0] for row in result if row[0]]
        cache_client.set(cache_key, clusters, ttl=3600)  # Cache for 1 hour
        return {"success": True, "clusters": clusters, "count": len(clusters)}
    except Exception as e:
        logger.error(f"Error fetching clusters: {e}")
        return {"success": False, "clusters": [], "count": 0}


@app.get(
    "/api/stations",
    tags=["Metadata"],
    summary="Get list of stations"
)
async def get_stations(
    cluster: Optional[str] = Query(default=None, description="Filter by cluster"),
    _: bool = Depends(verify_token)
):
    """Get list of all stations, optionally filtered by cluster"""
    cache_key = f"stations:{cluster}"
    
    cached = cache_client.get(cache_key)
    if cached:
        return {"success": True, "stations": cached, "count": len(cached)}
    
    if cluster:
        query = "SELECT DISTINCT stanica FROM pm_counters WHERE klaster = %(cluster)s ORDER BY stanica"
        params = {"cluster": cluster}
    else:
        query = "SELECT DISTINCT stanica FROM pm_counters ORDER BY stanica"
        params = {}
    
    try:
        result = await asyncio.to_thread(clickhouse_client.client.execute, query, params)
        stations = [row[0] for row in result if row[0]]
        cache_client.set(cache_key, stations, ttl=3600)
        return {"success": True, "stations": stations, "count": len(stations)}
    except Exception as e:
        logger.error(f"Error fetching stations: {e}")
        return {"success": False, "stations": [], "count": 0}


@app.get(
    "/api/cells",
    tags=["Metadata"],
    summary="Get list of cells"
)
async def get_cells(
    cluster: Optional[str] = Query(default=None, description="Filter by cluster"),
    station: Optional[str] = Query(default=None, description="Filter by station"),
    _: bool = Depends(verify_token)
):
    """Get list of all cells, optionally filtered"""
    cache_key = f"cells:{cluster}:{station}"
    
    cached = cache_client.get(cache_key)
    if cached:
        return {"success": True, "cells": cached, "count": len(cached)}
    
    where_clauses = []
    params = {}
    
    if cluster:
        where_clauses.append("klaster = %(cluster)s")
        params["cluster"] = cluster
    if station:
        where_clauses.append("stanica = %(station)s")
        params["station"] = station
    
    where = " AND ".join(where_clauses) if where_clauses else "1=1"
    query = f"SELECT DISTINCT celija, stanica, klaster, band FROM pm_counters WHERE {where} ORDER BY celija"
    
    try:
        result = await asyncio.to_thread(clickhouse_client.client.execute, query, params)
        cells = []
        for row in result:
            cells.append({
                "celija": row[0],
                "stanica": row[1],
                "klaster": row[2],
                "band": row[3]
            })
        cache_client.set(cache_key, cells, ttl=3600)
        return {"success": True, "cells": cells, "count": len(cells)}
    except Exception as e:
        logger.error(f"Error fetching cells: {e}")
        return {"success": False, "cells": [], "count": 0}


# ============================================================================
# Alerting Endpoints
# ============================================================================

# ── Perzistencija alerta (SQLAlchemy — SQLite po defaultu, PostgreSQL via ALERT_DB_URL) ──

ALERT_DB_URL = os.getenv("ALERT_DB_URL", "sqlite:///./alerts.db")
alert_engine = create_engine(
    ALERT_DB_URL,
    connect_args={"check_same_thread": False} if ALERT_DB_URL.startswith("sqlite") else {}
)
AlertSession = sessionmaker(bind=alert_engine, expire_on_commit=False)
Base.metadata.create_all(alert_engine)


def _alert_to_dict(a: AlertRecord) -> Dict[str, Any]:
    """Konvertuje ORM zapis u dict (kompatibilno sa starim in-memory formatom)."""
    return {
        "id": a.id,
        "cell": a.cell,
        "cluster": a.cluster,
        "metric": a.metric,
        "value": float(a.value) if a.value is not None else 0.0,
        "threshold": float(a.threshold) if a.threshold is not None else 0.0,
        "severity": a.severity.value if isinstance(a.severity, AlertSeverity) else str(a.severity),
        "status": a.status.value if isinstance(a.status, AlertStatus) else str(a.status),
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "acknowledged_at": a.acknowledged_at.isoformat() if a.acknowledged_at else None,
        "resolved_at": a.resolved_at.isoformat() if a.resolved_at else None,
        "resolved_by": a.resolved_by,
        "resolution_note": a.resolution_note,
        "occurrences": a.occurrences or 1,
    }


def _db_upsert_alert(new_alert: Dict[str, Any]) -> None:
    """Ubaci novi alert ili poveća occurrences ako već postoji (isti id)."""
    with AlertSession() as db:
        existing = db.get(AlertRecord, new_alert["id"])
        if existing:
            existing.occurrences = (existing.occurrences or 1) + 1
            existing.value = new_alert["value"]
        else:
            db.add(AlertRecord(
                id=new_alert["id"],
                cell=new_alert["cell"],
                cluster=new_alert["cluster"],
                metric=new_alert["metric"],
                value=new_alert["value"],
                threshold=new_alert["threshold"],
                severity=AlertSeverity(new_alert["severity"]),
                status=AlertStatus.NEW,
            ))
        db.commit()


def _db_query_alerts(alert_status: Optional[str], alert_severity: Optional[str]) -> List[Dict[str, Any]]:
    """Lista alerta iz baze (najnoviji prvi), opciono filtrirana."""
    with AlertSession() as db:
        q = db.query(AlertRecord)
        if alert_status:
            q = q.filter(AlertRecord.status == AlertStatus(alert_status))
        if alert_severity:
            q = q.filter(AlertRecord.severity == AlertSeverity(alert_severity))
        return [_alert_to_dict(a) for a in q.order_by(AlertRecord.created_at.desc()).limit(500).all()]


def _db_update_alert(alert_id: str, **fields: Any) -> Optional[Dict[str, Any]]:
    """Promeni polja alerta; vraća None ako ne postoji."""
    with AlertSession() as db:
        a = db.get(AlertRecord, alert_id)
        if not a:
            return None
        for key, value in fields.items():
            setattr(a, key, value)
        db.commit()
        return _alert_to_dict(a)


async def send_webhook_notification(alerts: List[Dict[str, Any]]) -> None:
    """Send new alerts to the configured webhook endpoint."""
    if not (settings.NOTIFY_WEBHOOK_ENABLED and settings.NOTIFY_WEBHOOK_URL):
        return

    payload = {
        "source": "volte-kpi-dashboard",
        "type": "alert.created",
        "timestamp": datetime.utcnow().isoformat(),
        "alerts": alerts,
    }

    async with httpx.AsyncClient(timeout=settings.NOTIFY_WEBHOOK_TIMEOUT) as client:
        try:
            response = await client.post(settings.NOTIFY_WEBHOOK_URL, json=payload)
            if response.status_code >= 400:
                logger.warning(
                    f"Webhook notification failed with status {response.status_code}"
                )
            else:
                logger.info(f"Webhook notification sent: {len(alerts)} alerts")
        except httpx.HTTPError as exc:
            logger.error(f"Webhook notification error: {exc}")


@app.get(
    "/api/alerts",
    response_model=AlertResponse,
    tags=["Alerts"],
    summary="Get active alerts"
)
async def get_alerts(
    status: Optional[str] = Query(default=None, description="Filter by status"),
    severity: Optional[str] = Query(default=None, description="Filter by severity"),
    _: bool = Depends(verify_token)
):
    """Get list of active alerts (perzistovani u bazi)"""
    alerts = await asyncio.to_thread(_db_query_alerts, status, severity)

    active_count = len([a for a in alerts if a.get("status") == "NEW"])
    
    return AlertResponse(
        success=True,
        alerts=alerts,
        active_count=active_count,
        timestamp=datetime.utcnow()
    )


@app.post(
    "/api/alerts/check",
    tags=["Alerts"],
    summary="Check for new alerts"
)
async def check_alerts(
    hours: int = Query(default=24, ge=1, le=168),
    _: bool = Depends(verify_token)
):
    """
    Check for new alerts based on KPI thresholds.
    
    Creates alerts when KPI values exceed configured thresholds.
    """
    # Get KPI data
    kpi_response = await get_kpis(
        hours=hours,
        cluster=None,
        station=None,
        cell=None,
        band=None,
    )
    
    thresholds = {
        "access_fail_rate": settings.SLA_ACCESS_FAIL_RATE,
        "drop_rate": settings.SLA_DROP_RATE,
        "cell_integrity": settings.SLA_CELL_INTEGRITY,
        "pdcch_error": settings.SLA_PDCCH_ERROR,
        "erlang": settings.SLA_ERLANG_PER_SECTOR
    }
    
    new_alerts = []
    for kpi in (k.model_dump(mode="json") for k in kpi_response.data):
        cell = kpi.get("celija", "unknown")
        cluster = kpi.get("klaster", "unknown")
        
        # Check each metric
        checks = [
            ("volteAccessFailureRate", "Access Failure Rate", thresholds["access_fail_rate"], "HIGH", False),
            ("volteDropRate", "Drop Rate", thresholds["drop_rate"], "HIGH", False),
            ("volteCellIntegrity", "Cell Integrity", thresholds["cell_integrity"], "LOW", True),
            ("volteErlang", "Erlang", thresholds["erlang"], "HIGH", False),
            ("pdcchErrorRateVolte", "PDCCH Error Rate", thresholds["pdcch_error"], "HIGH", False),
        ]
        
        for metric_key, metric_name, threshold, severity, invert in checks:
            value = kpi.get(metric_key)
            if value is None:
                continue
            
            # Check threshold
            triggered = False
            if invert:
                triggered = value < threshold
            else:
                triggered = value > threshold
            
            if triggered:
                alert_id = f"{cell}:{metric_key}:{int(time.time())}"
                
                new_alert = {
                    "id": alert_id,
                    "cell": cell,
                    "cluster": cluster,
                    "metric": metric_name,
                    "value": float(value),
                    "threshold": float(threshold),
                    "severity": severity,
                    "status": "NEW",
                    "created_at": datetime.utcnow().isoformat(),
                    "resolved_at": None
                }
                
                new_alerts.append(new_alert)

    if new_alerts:
        await asyncio.to_thread(lambda: [_db_upsert_alert(a) for a in new_alerts])
        await send_webhook_notification(new_alerts)
    
    return {
        "success": True,
        "new_alerts": len(new_alerts),
        "alerts": new_alerts,
        "timestamp": datetime.utcnow()
    }


@app.post(
    "/api/alerts/{alert_id}/acknowledge",
    tags=["Alerts"],
    summary="Acknowledge an alert"
)
async def acknowledge_alert(
    alert_id: str,
    _: bool = Depends(verify_token)
):
    """Acknowledge an alert"""
    updated = await asyncio.to_thread(
        _db_update_alert, alert_id,
        status=AlertStatus.ACKNOWLEDGED, acknowledged_at=datetime.utcnow()
    )
    if updated:
        return {"success": True, "message": f"Alert {alert_id} acknowledged"}

    raise HTTPException(status_code=404, detail=f"Alert {alert_id} not found")


@app.post(
    "/api/alerts/{alert_id}/resolve",
    tags=["Alerts"],
    summary="Resolve an alert"
)
async def resolve_alert(
    alert_id: str,
    _: bool = Depends(verify_token)
):
    """Resolve an alert"""
    updated = await asyncio.to_thread(
        _db_update_alert, alert_id,
        status=AlertStatus.RESOLVED, resolved_at=datetime.utcnow()
    )
    if updated:
        return {"success": True, "message": f"Alert {alert_id} resolved"}

    raise HTTPException(status_code=404, detail=f"Alert {alert_id} not found")


# ============================================================================
# Realtime Endpoints
# ============================================================================

@app.get(
    "/api/kpis/stream",
    tags=["Realtime"],
    summary="SSE stream of KPI data",
    description="Server-Sent Events stream pushing KPI data at a fixed interval with keep-alive heartbeats"
)
async def stream_kpis(
    request: Request,
    hours: int = Query(
        default=24,
        ge=1,
        le=168,
        description="Time range in hours"
    ),
    interval: int = Query(
        default=30,
        ge=5,
        le=300,
        description="Push interval in seconds"
    ),
    _: bool = Depends(verify_token)
):
    """
    Stream KPI data over Server-Sent Events.
    
    The client receives an `kpis` event on every interval with the full
    KPI response payload, plus `heartbeat` comments to keep the connection
    alive through proxies. The stream closes when the client disconnects.
    """
    async def event_generator():
        while True:
            if await request.is_disconnected():
                logger.info("SSE client disconnected, closing stream")
                break
            try:
                response = await get_kpis(
                    hours=hours,
                    cluster=None,
                    station=None,
                    cell=None,
                    band=None,
                )
                payload = json.dumps(response.model_dump(mode="json"), default=str)
                yield f"event: kpis\ndata: {payload}\n\n"
            except Exception as exc:
                logger.error(f"SSE snapshot failed: {exc}")
                yield f"event: error\ndata: {json.dumps({'message': str(exc)})}\n\n"
            await asyncio.sleep(interval)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ============================================================================
# Main
# ============================================================================

if __name__ == "__main__":
    uvicorn.run(
        "server.main:app",
        host=settings.API_HOST,
        port=settings.API_PORT,
        reload=True,
        log_level="info"
    )
