"""
Pydantic models for VoLTE KPI API
Defines request/response schemas
"""

from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum


class CellStatus(str, Enum):
    GOOD = "GOOD"
    WARNING = "WARNING"
    BAD = "BAD"


class KpiThresholds(BaseModel):
    """SLA thresholds for KPI classification"""
    access_fail_rate: float = 2.0
    drop_rate: float = 1.5
    cell_integrity: float = 97.0
    pdcch_error: float = 3.0
    erlang_per_sector: float = 40.0


# Request Models
class KpiQueryRequest(BaseModel):
    """Query parameters for KPI data"""
    hours: Optional[int] = Field(
        default=24,
        ge=1,
        le=168,
        description="Time range in hours (1-168)"
    )
    cluster: Optional[str] = Field(
        default=None,
        description="Filter by cluster"
    )
    station: Optional[str] = Field(
        default=None,
        description="Filter by station"
    )
    cell: Optional[str] = Field(
        default=None,
        description="Filter by specific cell"
    )
    band: Optional[str] = Field(
        default=None,
        description="Filter by frequency band"
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "hours": 24,
                "cluster": "CENTAR_BGD",
                "station": None,
                "cell": None,
                "band": None
            }
        }


class AggregationRequest(BaseModel):
    """Request for aggregated KPI data"""
    group_by: str = Field(
        default="cluster",
        description="Group by field: cluster, station, band, hour"
    )
    hours: int = Field(
        default=24,
        ge=1,
        le=168,
        description="Time range in hours"
    )


# Response Models
class KpiMetrics(BaseModel):
    """Calculated KPI metrics for a cell or aggregation"""
    avg_drop_rate: Optional[float] = Field(
        default=None,
        description="Average Drop Rate (%)"
    )
    avg_access_fail_rate: Optional[float] = Field(
        default=None,
        description="Average Access Failure Rate (%)"
    )
    avg_cell_integrity: Optional[float] = Field(
        default=None,
        description="Average Cell Integrity (%)"
    )
    total_erlang: Optional[float] = Field(
        default=None,
        description="Total Erlang load"
    )
    total_cells: int = Field(
        default=0,
        description="Total number of cells"
    )
    total_success_calls: Optional[int] = Field(
        default=None,
        description="Total successful calls"
    )
    total_drops_count: Optional[int] = Field(
        default=None,
        description="Total drop count"
    )


class KpiCellData(BaseModel):
    """Single cell KPI data with all metrics"""
    celija: str = Field(description="Cell identifier")
    stanica: str = Field(description="Station identifier")
    klaster: str = Field(description="Cluster identifier")
    band: str = Field(description="Frequency band")
    datetime: Optional[datetime] = Field(
        default=None,
        description="Timestamp of the data"
    )
    
    # Main KPI metrics
    volteAccessFailureRate: float = Field(description="VoLTE Access Failure Rate (%)")
    volteDropRate: float = Field(description="VoLTE Drop Rate (%)")
    volteCellIntegrity: float = Field(description="VoLTE Cell Integrity (%)")
    volteErlang: float = Field(description="VoLTE Erlang load")
    volteSuccCalls: int = Field(description="Successful VoLTE calls count")
    
    # Additional metrics
    volteMobilitySR: float = Field(description="VoLTE Mobility Success Rate (%)")
    pdcchErrorRateVolte: float = Field(description="PDCCH Error Rate (%)")
    volteDropsCount: int = Field(description="VoLTE Drops Count")
    
    # QCI metrics
    volteQci1AddSuccRate: Optional[float] = Field(
        default=None,
        description="QCI1 Add Success Rate (%)"
    )
    volteQci1InitSuccRate: Optional[float] = Field(
        default=None,
        description="QCI1 Init Success Rate (%)"
    )
    volteQci5AddSuccRate: Optional[float] = Field(
        default=None,
        description="QCI5 Add Success Rate (%)"
    )
    volteQci5InitSuccRate: Optional[float] = Field(
        default=None,
        description="QCI5 Init Success Rate (%)"
    )
    
    # Status
    status: CellStatus = Field(description="Cell status: GOOD, WARNING, BAD")
    
    class Config:
        from_attributes = True


class KpiResponse(BaseModel):
    """Main KPI data response"""
    success: bool = Field(default=True, description="Request success status")
    data: List[KpiCellData] = Field(
        default_factory=list,
        description="List of KPI cell data"
    )
    metrics: Optional[KpiMetrics] = Field(
        default=None,
        description="Aggregated metrics"
    )
    count: int = Field(default=0, description="Total number of records")
    timestamp: datetime = Field(
        default_factory=datetime.utcnow,
        description="Response timestamp"
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "data": [],
                "metrics": {
                    "avg_drop_rate": 1.25,
                    "avg_access_fail_rate": 1.8,
                    "avg_cell_integrity": 98.5,
                    "total_erlang": 250.5,
                    "total_cells": 25
                },
                "count": 25,
                "timestamp": "2024-01-15T10:30:00Z"
            }
        }


class AggregatedKpiResponse(BaseModel):
    """Response for aggregated KPI data"""
    success: bool = Field(default=True)
    data: List[dict] = Field(
        default_factory=list,
        description="Aggregated data by group"
    )
    group_by: str = Field(description="Grouping field")
    total_count: int = Field(default=0, description="Total records")
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class HealthResponse(BaseModel):
    """Health check response"""
    status: str = Field(default="healthy", description="Service status")
    version: str = Field(description="API version")
    database: str = Field(description="Database connection status")
    cache: str = Field(description="Cache connection status")
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ErrorResponse(BaseModel):
    """Error response model"""
    success: bool = Field(default=False)
    error: str = Field(description="Error message")
    code: int = Field(description="HTTP status code")
    details: Optional[dict] = Field(
        default=None,
        description="Additional error details"
    )
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class Alert(BaseModel):
    """Alert notification model"""
    id: str = Field(description="Alert ID")
    cell: str = Field(description="Affected cell")
    cluster: str = Field(description="Cluster")
    metric: str = Field(description="KPI metric that triggered alert")
    value: float = Field(description="Current value")
    threshold: float = Field(description="Threshold value")
    severity: str = Field(description="Alert severity: LOW, MEDIUM, HIGH, CRITICAL")
    status: str = Field(description="Alert status: NEW, ACKNOWLEDGED, RESOLVED")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    resolved_at: Optional[datetime] = Field(default=None)


class AlertResponse(BaseModel):
    """Alerts list response"""
    success: bool = Field(default=True)
    alerts: List[Alert] = Field(default_factory=list)
    active_count: int = Field(default=0)
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ExportRequest(BaseModel):
    """Request for CSV export"""
    hours: int = Field(default=24, ge=1, le=168)
    format: str = Field(default="csv", description="Export format: csv, json, xlsx")
