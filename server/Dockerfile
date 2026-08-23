# VoLTE KPI API - Dockerfile
# ==============================
# Multi-stage build for production and development

# Stage 1: Base image
FROM python:3.11-slim as base

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first to leverage Docker cache
COPY server/requirements.txt .

# Install Python dependencies
RUN pip install --upgrade pip && \
    pip install -r requirements.txt

# Stage 2: Production image
FROM base as production

# Copy application code
COPY server/ ./server/
COPY .env.example .env

# Perzistencija alerta (SQLite fajl se montira kao volume u compose-u)
RUN mkdir -p /app/data

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser /app

USER appuser

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import httpx; httpx.get('http://localhost:8080/health').raise_for_status()" || exit 1

# Run the application
# NOTE: --workers 1 — alarmi i keš su in-process stanje; više workera bi
# davalo različite podatke različitim korisnicima.
CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]

# Stage 3: Development image (optional)
FROM base as development

# Copy all files
COPY . .

# Expose port
EXPOSE 8080

# Run with hot reload
CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8080", "--reload"]
