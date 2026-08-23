"""
Persistent Alert Models using SQLAlchemy
Handles alert storage, retrieval, and audit trail
"""

from datetime import datetime
from typing import Optional
from enum import Enum
from sqlalchemy import create_engine, Column, String, Float, DateTime, Integer, Enum as SQLEnum, Index
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
import logging

logger = logging.getLogger(__name__)

Base = declarative_base()


class AlertStatus(str, Enum):
    """Alert lifecycle states"""
    NEW = "NEW"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    RESOLVED = "RESOLVED"
    SUPPRESSED = "SUPPRESSED"


class AlertSeverity(str, Enum):
    """Alert severity levels"""
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class AlertRecord(Base):
    """
    Persistent alert record stored in database
    
    Fields:
        id: Unique alert identifier (composed of cell:metric:timestamp)
        cell: Affected cell identifier
        cluster: Cluster identifier
        metric: KPI metric name (e.g., "Drop Rate")
        value: Current KPI value when alert triggered
        threshold: SLA threshold that was exceeded
        severity: Alert severity level
        status: Current alert status (NEW, ACKNOWLEDGED, RESOLVED, SUPPRESSED)
        created_at: When alert was triggered
        acknowledged_at: When operator acknowledged the alert
        resolved_at: When alert was resolved
        resolved_by: User who resolved the alert
        resolution_note: Reason for resolution
        occurrences: How many times this alert has occurred
    """
    __tablename__ = "alerts"
    
    id = Column(String(255), primary_key=True, index=True)
    cell = Column(String(100), nullable=False, index=True)
    cluster = Column(String(100), nullable=False, index=True)
    metric = Column(String(100), nullable=False)
    value = Column(Float, nullable=False)
    threshold = Column(Float, nullable=False)
    severity = Column(SQLEnum(AlertSeverity), default=AlertSeverity.MEDIUM)
    status = Column(SQLEnum(AlertStatus), default=AlertStatus.NEW, index=True)
    
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    acknowledged_at = Column(DateTime, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    resolved_by = Column(String(255), nullable=True)
    resolution_note = Column(String(1000), nullable=True)
    
    occurrences = Column(Integer, default=1)  # Duplicate count
    
    # Indexes for common queries
    __table_args__ = (
        Index('idx_cell_status', 'cell', 'status'),
        Index('idx_cluster_created', 'cluster', 'created_at'),
        Index('idx_severity_created', 'severity', 'created_at'),
    )


class AlertAuditLog(Base):
    """
    Audit trail for all alert state changes
    
    Purpose:
        - Compliance: Who changed what and when
        - Forensics: Reconstruct alert history
        - Analytics: Response time metrics
    """
    __tablename__ = "alert_audit_log"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    alert_id = Column(String(255), nullable=False, index=True)
    action = Column(String(50), nullable=False)  # created, acknowledged, resolved, suppressed, escalated
    old_status = Column(SQLEnum(AlertStatus), nullable=True)
    new_status = Column(SQLEnum(AlertStatus), nullable=False)
    changed_by = Column(String(255), nullable=True)  # User performing action
    reason = Column(String(500), nullable=True)
    changed_at = Column(DateTime, default=datetime.utcnow, index=True)


class AlertTemplate(Base):
    """
    Reusable alert templates with thresholds
    
    Purpose:
        - Define alert rules without hardcoding
        - Support multiple alert policies
        - Easy enable/disable of specific alerts
    """
    __tablename__ = "alert_templates"
    
    id = Column(String(100), primary_key=True)
    metric_name = Column(String(100), nullable=False, unique=True)
    description = Column(String(500))
    enabled = Column(Integer, default=1)  # 1=enabled, 0=disabled
    
    # Thresholds
    warning_threshold = Column(Float, nullable=True)
    critical_threshold = Column(Float, nullable=True)
    compare_operator = Column(String(10), default="gt")  # gt (>), lt (<), eq (=)
    
    # Escalation
    escalate_after_minutes = Column(Integer, default=60)  # Auto-escalate after 1hr
    escalation_target = Column(String(255), nullable=True)  # Email, Slack webhook, etc
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AlertSuppression(Base):
    """
    Temporary alert suppression rules
    
    Purpose:
        - Mute alerts during maintenance windows
        - Prevent alert fatigue during known issues
    """
    __tablename__ = "alert_suppressions"
    
    id = Column(String(100), primary_key=True)
    cell = Column(String(100), nullable=True, index=True)  # NULL = all cells
    cluster = Column(String(100), nullable=True)
    metric = Column(String(100), nullable=True)  # NULL = all metrics
    
    enabled = Column(Integer, default=1)
    reason = Column(String(500))
    
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    
    created_by = Column(String(255))
    created_at = Column(DateTime, default=datetime.utcnow)
