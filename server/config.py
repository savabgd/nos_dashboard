"""
VoLTE KPI API Configuration
Loads environment variables and provides default settings
"""

from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional
import os


class Settings(BaseSettings):
    # API Configuration
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8080
    API_TITLE: str = "VoLTE KPI API"
    API_VERSION: str = "1.0.0"
    API_DESCRIPTION: str = "REST API for VoLTE KPI monitoring and analysis"
    
    # ClickHouse Configuration
    CH_HOST: str = Field(default="localhost", env="CH_HOST")
    CH_PORT: int = Field(default=8123, env="CH_PORT")
    CH_USER: str = Field(default="default", env="CH_USER")
    CH_PASSWORD: str = Field(default="", env="CH_PASSWORD")
    CH_DATABASE: str = Field(default="volte_kpi", env="CH_DATABASE")
    CH_TIMEOUT: int = 30
    
    # CORS Configuration
    CORS_ORIGINS: list[str] = Field(
        default=["http://localhost:3000", "http://localhost:8000", "*"],
        env="CORS_ORIGINS"
    )
    
    # Rate Limiting
    RATE_LIMIT: str = "100/minute"
    
    # Cache Configuration (Redis)
    REDIS_HOST: str = Field(default="localhost", env="REDIS_HOST")
    REDIS_PORT: int = Field(default=6379, env="REDIS_PORT")
    REDIS_PASSWORD: str = Field(default="", env="REDIS_PASSWORD")
    CACHE_TTL: int = 300  # 5 minutes
    
    # SLA Thresholds (configurable)
    SLA_ACCESS_FAIL_RATE: float = 2.0
    SLA_DROP_RATE: float = 1.5
    SLA_CELL_INTEGRITY: float = 97.0
    SLA_PDCCH_ERROR: float = 3.0
    SLA_ERLANG_PER_SECTOR: float = 40.0
    
# Authentication (optional)
    AUTH_ENABLED: bool = Field(default=False, env="AUTH_ENABLED")
    AUTH_SECRET: str = Field(default="change-me-in-production", env="AUTH_SECRET")
    AUTH_ALGORITHM: str = "HS256"

    # Alert Notifications
    # When enabled, new alerts are pushed to an external webhook (e.g. Slack, OpsGenie).
    NOTIFY_WEBHOOK_ENABLED: bool = Field(default=False, env="NOTIFY_WEBHOOK_ENABLED")
    NOTIFY_WEBHOOK_URL: str = Field(default="", env="NOTIFY_WEBHOOK_URL")
    NOTIFY_WEBHOOK_TIMEOUT: int = 5

    # Monitoring / Metrics
    METRICS_ENABLED: bool = Field(default=True, env="METRICS_ENABLED")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False


# Initialize settings
settings = Settings()

# ClickHouse connection URL
CLICKHOUSE_URL = f"http://{settings.CH_HOST}:{settings.CH_PORT}"

# Redis connection URL
REDIS_URL = f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}"
