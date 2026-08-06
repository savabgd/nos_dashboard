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

# 4. Produkcija (nginx + build-ovani frontend)
docker compose --profile prod up --build nginx

# 5. Monitoring (Prometheus scrapuje /metrics)
docker compose --profile monitoring up prometheus   # http://localhost:9090
```

Dashboard: http://localhost:3000 (dev) / http://localhost (prod)  
API docs: http://localhost:8080/docs

## Testiranje

```bash
# Backend (Python) — root direktorijum
python -m pytest -q

# Frontend (TypeScript)
npx vitest run          # testovi
npx tsc --noEmit        # type-check
npx eslint app.ts network-map.ts stations.ts --ext ts   # lint
```

CI (`Github Actions`) pokreće sve navedeno + `docker build` obe slike na `main` push.

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
| `GET /api/kpis` | KPI po ćeliji (filteri: `cluster`, `station`, `cell`, `band`, `hours`) |
| `GET /api/kpis/aggregated` | Agregirani KPI |
| `GET /api/kpis/stream` | SSE stream u realnom vremenu |
| `GET /api/kpis/export` | CSV/JSON export |
| `GET /api/clusters` | Lista klastera |
| `GET /health` | Health check |
| `GET /metrics` | Prometheus metrike |

## Notifikacije (webhook)

Kada se pojave nove ćelije u kritičnom stanju (`check_alerts`), backend šalje webhook
na konfigurisanu URL adresu. JSON payload:

```
{
  "source": "volte-kpi-dashboard",
  "type": "alert.created",
  "timestamp": "2026-08-06T00:00:00Z",
  "alerts": [{"id": "...", "cell": "BGD_001", ...}]
}
```

Omogućava sa `NOTIFY_WEBHOOK_ENABLED=true` i `NOTIFY_WEBHOOK_URL=...` (pogledaj `.env.example`).

## Frontend — statistika i dizajn

- **Light/Dark tema** — prebacivanje preko dugmeta, čuva izbor u `localStorage` (default `system`).
- **Live badge** – indikator da li su podaci live, vreme poslednjeg ažuriranja.
- **Pretraga & filter tablice** – po celiji/stanici/klasteru, "Samo loše" (BAD) filter, limit 500 redova.
- **Network map** – Leaflet karta se učitava lazily (odvojen JS chunk), topologija u `stations.ts`.

## C++ KPI kalkulator (referenca)

```bash
g++ -std=c++17 -O2 -o kpi main.cpp kpi_calc.cpp
./kpi
```

Python implementacija u `server/kpi_calculator.py` koristi iste formule.

## Struktura projekta

```
├── index.html, app.ts, styles.css   # Frontend (Vite + TypeScript)
├── stations.ts                      # Statika topologije (bez Leaflet zavisnosti)
├── network-map.ts                   # Leaflet mapa (lazy chunk)
├── server/                          # FastAPI backend (+ tests/)
├── kpi_calc.cpp/h                   # C++ referentna implementacija
├── 01_schema.sql                    # ClickHouse schema
├── 02_materialized_views.sql        # Agregacioni materijalizovani pogled
├── 03_indexes_ttl.sql               # Indeksi + TTL politike
├── 02_sample_data.py                # Generator test podataka
├── frontend.Dockerfile              # Build slike (korišćeno u CI/CD)
├── prometheus.yml                   # Scrape konfiguracija za /metrics
├── docker-compose.yml               # Glavna orchestration
├── .github/workflows/ci.yml         # CI workflow
└── README.md                        # Dokumentacija
```

## Napomene

- `app.js` je zastarela verzija frontenda; aktivna je `app.ts` preko Vite-a.
- Redis keš je opcionalan (`docker compose --profile cache up`).
- Autentifikacija je isključena po defaultu (`AUTH_ENABLED=false`).
