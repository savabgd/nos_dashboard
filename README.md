# VoLTE KPI Dashboard (CETIN)

NOC dashboard za praćenje VoLTE KPI metrika u mobilnoj mreži — ćelije, stanice, klasteri.

## Arhitektura

```
ClickHouse (pm_counters) → FastAPI backend → Vite/TypeScript frontend
                              ↑
                    C++/Python KPI kalkulator
```

## Brzo pokretanje (Docker)

```bash
# 1. Baza + backend
docker compose up -d

# 2. Schema + test podaci (jednom)
docker compose --profile setup up clickhouse-init data-generator

# 3. Frontend (dev)
docker compose --profile dev up frontend
```

Dashboard: http://localhost:3000  
API docs: http://localhost:8080/docs

## Lokalni razvoj (bez Docker-a)

### Backend

```bash
cd server
pip install -r requirements.txt
cp ../.env.example ../.env
uvicorn server.main:app --reload --port 8080
```

### ClickHouse

Primeni schema ručno:

```bash
clickhouse-client --multiquery < 01_schema.sql
python 02_sample_data.py --days 7
```

### Frontend

```bash
npm install
cp .env.example .env
npm run dev
```

## KPI metrike

| Metrika | SLA prag (default) |
|---------|-------------------|
| Access Failure Rate | ≤ 2.0% |
| Drop Rate | ≤ 1.5% |
| Cell Integrity | ≥ 97.0% |
| PDCCH Error Rate | ≤ 3.0% |
| Erlang per sector | ≤ 40 |

Pragovi se podešavaju preko env varijabli (`SLA_*`).

## API endpointi

| Endpoint | Opis |
|----------|------|
| `GET /api/kpis` | KPI po ćeliji |
| `GET /api/kpis/aggregated` | Agregirani KPI |
| `GET /api/kpis/export` | CSV/JSON export |
| `GET /api/clusters` | Lista klastera |
| `GET /health` | Health check |

## C++ KPI kalkulator (referenca)

```bash
g++ -std=c++17 -O2 -o kpi main.cpp kpi_calc.cpp
./kpi
```

Python implementacija u `server/kpi_calculator.py` koristi iste formule.

## Struktura projekta

```
├── index.html, app.ts, styles.css   # Frontend (Vite + TypeScript)
├── server/                          # FastAPI backend
├── kpi_calc.cpp/h                   # C++ referentna implementacija
├── 01_schema.sql                    # ClickHouse schema
├── 02_sample_data.py                # Generator test podataka
└── docker-compose.yml
```

## Napomene

- `app.js` je zastarela verzija frontenda; aktivna je `app.ts` preko Vite-a.
- Redis keš je opcionalan (`docker compose --profile cache up`).
- Autentifikacija je isključena po defaultu (`AUTH_ENABLED=false`).
