# SOLUTION — Dockerizacija VoLTE KPI Dashboard-a

> Kompletan vodič kako je ovaj projekat pokriven Dockerom, šta je tačno
> izmenjeno i zašto, i kako sve da se pokrene — od razvoja do produkcije
> na serveru u lokalnoj mreži.

---

## 1. Arhitektura sistema

```
                        ┌──────────────────────────────────────────┐
   Browser korisnika    │              DOCKER MREŽA                │
   ─────────────────►   │         (volte-kpi-network)              │
   http://server:80     │                                          │
        │               │  ┌────────────┐      ┌───────────────┐   │
        │  statika +    │  │   NGINX    │ /api │    BACKEND    │   │
        │  proxy /api   │  │  (prod) :80├─────►│ FastAPI :8080 │   │
        └──────────────►│  └────────────┘      └───────┬───────┘   │
                        │                              │ SQL       │
                        │                        ┌─────▼─────────┐ │
                        │                        │  CLICKHOUSE   │ │
                        │                        │  :8123/:9000  │ │
                        │                        └───────────────┘ │
                        │   opciono: Redis (:6379), Prometheus(:9090),
                        │            Vite dev server (:3000)
                        └──────────────────────────────────────────┘
```

**Tok podataka:** browser traži stranicu → nginx vraća statiku iz `dist/` i
prosleđuje `/api/*` pozive FastAPI backendu → backend čita PM countere iz
ClickHouse-a, računa KPI-je, kešira odgovore → SSE stream vraća live podatke.

---

## 2. Fajlovi koji čine Docker setup

| Fajl | Uloga |
|------|-------|
| `docker-compose.yml` | Orkestracija svih servisa + profili (setup/dev/prod/cache/monitoring) |
| `server/Dockerfile` | Backend image — multi-stage (production / development) |
| `frontend.Dockerfile` | Frontend image — build Vite bundle pa nginx servira statiku |
| `nginx.conf` | Reverse proxy: statika + `/api` prosleđivanje + SSE bez baferovanja |
| `prometheus.yml` | Scrapuje `/metrics` sa backenda |
| `.dockerignore` | **(novo)** Izuzima node_modules, .git, dist... iz build konteksta |

---

## 3. Šta je tačno menjano i zašto

### 3.1. Novo: `.dockerignore`
Bez njega bi `COPY . .` u build context gurao **node_modules (~100+ MB)**,
`.git` istorijat, `dist`, coverage izveštaje i logove → spori buildovi,
golemi image-i i rizik da lokalni fajlovi završe u image slojevima.
Takođe isključuje `.env` (tajne ne smeju u image — env var se prosleđuje
kroz compose).

### 3.2. Ispravka: Redis kredencijali za backend (`docker-compose.yml`)
Redis servis radi sa `--requirepass your-redis-password`, ali backend ranije
**nije dobijao ni host ni lozinku** → pokušavao je `localhost:6379` unutar
sopstvenog kontejnera → uvek padao na in-memory keš bez upozorenja.
Dodato u `environment` backend servisa:
```yaml
- REDIS_HOST=redis
- REDIS_PORT=6379
- REDIS_PASSWORD=your-redis-password
```
Napomena: ako "cache" profil nije pokrenut, konekcija propada i backend
gracefully koristi memory cache — to je očekivano ponašanje.

### 3.3. Ispravka: dev frontend URL (`docker-compose.yml`)
Bilo je:
```yaml
- VITE_API_BASE_URL=http://backend:8080   # POGREŠNO
```
`VITE_API_BASE_URL` se **ugrađuje u browser-side kod** — a browser kolege na
host mašini ne zna šta je `backend` hostname (to ime postoji samo unutar
docker mreže). Rezultat: sajt se otvori, ali svi API pozivi padnu.
Ispravljeno na `http://localhost:8080` (backend objavljuje port 8080 na hostu),
plus dodato `-- --host 0.0.0.0` da dev server sluša van kontejnera.

### 3.4. Uklonjen zastareli `version:` ključ
Compose v2 ignoriše `version: '3.8'` uz upozorenje — obrisan, dodata
dokumentacija profila u header fajla.

---

## 4. Kako rade Dockerfile-ovi

### `server/Dockerfile` (backend) — 3 stage-a
1. **base** — `python:3.11-slim` + build alati; `requirements.txt` se kopira
   *pre* koda → Docker kešira pip sloj dok se zavisnosti ne promene
2. **production** (target) — samo `server/` kod, non-root user `appuser`,
   HEALTHCHECK na `/health`, start: `uvicorn ... --workers 4`
3. **development** — ceo repo + `--reload` za hot-reload

### `frontend.Dockerfile` — 2 stage-a
1. **build** — `npm ci` (deterministički iz package-lock.json) → `npm run build`
   → nastaje `dist/`; `VITE_API_BASE_URL` je **prazan ARG** što znači da
   produkcijski frontend zove `/api/...` relativno → nema CORS problema,
   nginx sve rutira istim origin-om
2. **serve** — `nginx:alpine` kopira samo `dist/` (~par MB finalni image)

---

## 5. Profili docker-compose-a

| Profil | Servisi | Namena |
|--------|---------|--------|
| *(bez profila)* | clickhouse + backend | minimalni stack (API prvo) |
| `setup` | clickhouse-init + data-generator | šema + 7 dana demo podataka |
| `dev` | frontend (Vite, hot-reload, port 3000) | razvoj frontenda |
| `prod` | nginx (port 80) | produkcija u LAN-u |
| `cache` | redis | distribuirani keš |
| `monitoring` | prometheus (port 9090) | metrike |

Profili omogućavaju da se diže **samo ono što ti treba** umesto celog steka.

---

## 6. Recepti — komande po scenariju

### A. Prvi put: baza + demo podaci + API
```powershell
docker compose --profile setup up clickhouse-init data-generator
docker compose up -d
# API:          http://localhost:8080/docs
# Health:       http://localhost:8080/health
```

### B. Produkcija u firmi (svi vide sajt)
```powershell
docker compose --profile setup up clickhouse-init data-generator
docker compose --profile prod up -d
# Sajt:         http://localhost           (ili http://IP-SERVERA)
```

### C. Razvoj frontenda uz živ API
```powershell
docker compose up -d                      # baza + backend
docker compose --profile dev up frontend  # Vite na :3000 sa hot-reload
```

### D. Sa kešem i monitoringom
```powershell
docker compose --profile prod --profile cache --profile monitoring up -d
# Prometheus:   http://localhost:9090
```

### Korisne komande
```powershell
docker compose ps                # šta radi
docker compose logs -f backend   # logovi backenda
docker compose down              # zaustavi sve (podaci ostaju u volume-ima)
docker compose down -v           # OBRIŠI i podatke ClickHouse-a
docker compose build             # rebuild posle izmene koda
```

---

## 7. Portovi

| Port | Servis |
|------|--------|
| 80   | nginx — sajt (prod profil) |
| 3000 | Vite dev server (dev profil) |
| 8080 | FastAPI backend (+ `/docs`) |
| 8123 | ClickHouse HTTP interfejs |
| 9000 | ClickHouse native |
| 6379 | Redis (cache profil) |
| 9090 | Prometheus (monitoring profil) |

⚠️ Pre nego što kolege pristupaju: otvori port 80 u Windows Firewall-u servera.

---

## 8. Troubleshooting

| Simptom | Uzrok / rešenje |
|---------|-----------------|
| LIVE badge crven, nema podataka | Backend ne vidi ClickHouse → `docker compose logs backend` |
| Sajt radi, API pozivi padnu | Build urađen sa postavljenim `VITE_API_BASE_URL` — mora biti **prazan** za prod |
| SSE se ne osvežava uživo | Proxy baferuje stream → u nginx.conf već stoji `proxy_buffering off` |
| `clickhouse-init` ne prolazi | Šema se primenjuje jednom; ako baza već ima tabele, preskoči (`docker compose logs clickhouse-init`) |
| Port already in use | Nešto već koristi 80/8080 → promeni mapiranje levo od `:` u compose-u |
| Podaci nestali posle `down` | Normalno nakon `down -v` — volume-i su obrisani; pokreni `setup` opet |

---

## 9. Napomene za pravu produkciju (preporučeno pre javnog korišćenja)

1. **Uključi auth**: `AUTH_ENABLED=true` + jak `AUTH_SECRET` u `.env` servera
2. **Promeni Redis lozinku** (i u redis command i u backend env — moraju biti iste!)
3. **ClickHouse lozinka**: postavi `CLICKHOUSE_PASSWORD` i `CH_PASSWORD`
4. **TLS**: odkomentariši HTTPS blok u `nginx.conf` + sertifikat u `./certs`
5. **Backup**: `docker run --rm -v volte-kpi_clickhouse_data:/data alpine tar czf - /data > backup.tar.gz`
6. Backend trenutno drži alarme **in-memory** — postoji `server/alert_models.py`
   (SQLite/PostgreSQL perzistencija) ali još nije priključen u main.py
