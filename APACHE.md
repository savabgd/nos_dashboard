# Apache Deploy — NOC Dashboard (CETIN)

> Frontend je **Vite SPA** (cisti HTML/CSS/JS). Apache ne pokrece `npm run dev` — servira **buildovane** staticke fajlove iz `dist/`, a `/api/*` proksira na backend (FastAPI na `:8080`). Ovaj dokument pokriva sve.

---

## 1. Kako radi (arhitektura)

```
Browser  --->  Apache :80  --->  dist/index.html  (SPA)
                |
                +---> ProxyPass /api/  --->  FastAPI :8080  (KPI podaci, SSE stream)
                +---> ProxyPass /health, /metrics
```

* **Dev** (`npm run dev`): Vite dev server na `:3000` + proxy `/api -> :8080` (iz `vite.config.ts:22`). Samo za lokalni razvoj.
* **Produkcija (Apache)**: `npm run build` -> `dist/` -> Apache `DocumentRoot`. Browser zove `/api/*` na **istom originu** (nema CORS), Apache prosledjuje na backend. SSE (`/api/kpis/stream`) radi kroz `flushpackets=on` (bez baferovanja).

---

## 2. Fajlovi koje smo pripremili

| Fajl | Svrha |
|------|-------|
| `public/.htaccess` | SPA fallback (`index.html`), kesiranje, sigurnosni headeri. Automatski se kopira u `dist/` pri build-u. |
| `apache/nos-dashboard.conf` | Kompletan `<VirtualHost *:80>` — DocumentRoot, ProxyPass, SSE. Kopiraj u Apache `conf/extra/`. |
| `apache/httpd-snippet.conf` | Minimalan snippet ako vec imas postojeci vhost i hoces samo da dodas dashboard kao podfolder. |
| `.env.production` | Vite env za produkciju: `VITE_API_BASE_URL=` (prazno = relative, ide preko Apache proxy-a). |
| `scripts/deploy-apache.ps1` | Automatski build + kopiranje `dist/ -> htdocs` + restart. |
| `vite.config.ts` | Dodat `base: process.env.VITE_BASE_PATH || '/'` — podrzava i root i podfolder deploy. |

---

## 3. Instalacija Apache-a (Windows) — ako ga nemas

Na ovoj masini **nema Apache** (provereno: nema `C:\xampp`, `C:\Apache24`, nema Apache servis). Instaliraj jedno od:

### Opcija A — XAMPP (najlakse, preporuceno za Windows)

1. Skini https://www.apachefriends.org/download.html (Windows, PHP 8.x)
2. Instaliraj u `C:\xampp` (default)
3. Otvori **XAMPP Control Panel** -> pored **Apache** klikni **Start**
4. Proveri: http://localhost/dashboard — ako radi, Apache je ziv

### Opcija B — Apache Lounge (samostalni httpd, bez PHP)

1. Skini https://www.apachelounge.com/download/ (VS17)
2. Raspakuj u `C:\Apache24`
3. Instaliraj servis: `C:\Apache24\bin\httpd.exe -k install`
4. Start: `C:\Apache24\bin\httpd.exe -k start` ili `net start Apache2.4`
5. Proveri: http://localhost/

### Opcija C — Docker (ako imas Docker Desktop)

```powershell
docker run -d --name nos-apache -p 80:80 `
  -v C:\cetin\Test_plus\dist:/usr/local/apache2/htdocs/ `
  -v C:\cetin\Test_plus\apache\nos-dashboard.conf:/usr/local/apache2/conf/extra/nos-dashboard.conf `
  httpd:2.4
# pa u httpd.conf dodaj: Include conf/extra/nos-dashboard.conf
```

---

## 4. Build (pravi `dist/`)

### 4a. Root deploy — http://server/

```powershell
cd C:\cetin\Test_plus
npm run build
# ili eksplicitno:
# powershell -ExecutionPolicy Bypass -Command "npm run build"
```

Rezultat:
```
dist/
  index.html
  .htaccess              <- iz public/.htaccess
  assets/main-XXXX.js    <- hasheovan, kesira se 1 godinu
  assets/main-XXXX.css
  serbia-districts.geojson
```

Proveri: `dist/.htaccess` postoji, `dist/index.html` referencira `/assets/main-...` (apsolutna putanja za root).

### 4b. Podfolder deploy — http://server/nos-dashboard/

```powershell
cd C:\cetin\Test_plus
npm run build:apache:subfolder
# Interno radi: VITE_BASE_PATH=/nos-dashboard/ vite build
```

Tada `dist/index.html` referencira `/nos-dashboard/assets/...` i treba `RewriteBase /nos-dashboard/` u `.htaccess` (promeni rucno posle build-a ili koristi `apache/httpd-snippet.conf` sa `Alias`).

> **Koji da koristim?** Za CETIN intranet obicno je **root** (ceo server je dashboard) ili **reverse proxy** ispred. Ako delis server sa drugim aplikacijama, koristi **podfolder**.

---

## 5. Apache konfiguracija — korak po korak

### 5.1 Ukljuci module (httpd.conf)

Otvori `C:\xampp\apache\conf\httpd.conf` (ili `C:\Apache24\conf\httpd.conf`), nadji i **ukloni `#`** ispred:

```apache
LoadModule rewrite_module modules/mod_rewrite.so
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_http_module modules/mod_proxy_http.so
LoadModule headers_module modules/mod_headers.so
LoadModule expires_module modules/mod_expires.so
LoadModule deflate_module modules/mod_deflate.so
# Opciono (ako ces koristiti ws://):
# LoadModule proxy_wstunnel_module modules/mod_proxy_wstunnel.so
```

Proveri da postoji i:

```apache
Include conf/extra/httpd-vhosts.conf
```

### 5.2 Dodaj VirtualHost

**Root deploy:**
```powershell
Copy-Item C:\cetin\Test_plus\apache\nos-dashboard.conf C:\xampp\apache\conf\extra\nos-dashboard.conf
# pa u C:\xampp\apache\conf\httpd.conf dodaj na kraj:
# Include conf/extra/nos-dashboard.conf
```

Otvori `apache/nos-dashboard.conf` i proveri/prilagodi:

```apache
Define BACKEND_URL http://127.0.0.1:8080   # gde je FastAPI
Define DOCROOT "C:/cetin/Test_plus/dist"   # ili "C:/xampp/htdocs/nos-dashboard" ako si kopirao
```

**Podfolder deploy:** koristi `apache/httpd-snippet.conf` — kopiraj njegov sadrzaj u postojeci `<VirtualHost>`.

### 5.3 DocumentRoot — dve strategije

| Strategija | DOCROOT | Kako |
|------------|---------|------|
| **A. Direktno iz projekta** | `C:/cetin/Test_plus/dist` | Nema kopiranja, Apache cita direktno. Brze za dev, ali `dist/` mora ostati. |
| **B. Kopiraj u htdocs** | `C:/xampp/htdocs/nos-dashboard` | `Copy-Item dist\* htdocs -Recurse`. Cistije za produkciju, moze i bez source koda na serveru. |

Preporuka za produkciju: **B** (koristi `scripts/deploy-apache.ps1`).

### 5.4 Restart Apache

```powershell
# XAMPP: Control Panel -> Apache -> Stop / Start
# Apache Lounge:
C:\Apache24\bin\httpd.exe -k restart
# ili servis:
Restart-Service Apache2.4
# Proveri sintaksu pre restarta:
C:\xampp\apache\bin\httpd.exe -t
C:\Apache24\bin\httpd.exe -t
# Ocekivano: "Syntax OK"
```

---

## 6. Automatski deploy skripta

```powershell
# Root (http://localhost/)
powershell -ExecutionPolicy Bypass -File scripts/deploy-apache.ps1

# Podfolder (http://localhost/nos-dashboard/)
powershell -ExecutionPolicy Bypass -File scripts/deploy-apache.ps1 -Subfolder

# Sa restartom Apache-a
powershell -ExecutionPolicy Bypass -File scripts/deploy-apache.ps1 -Restart

# Custom htdocs putanja
powershell -ExecutionPolicy Bypass -File scripts/deploy-apache.ps1 -Htdocs "D:\www\nos-dashboard" -Restart

# Ili preko npm:
npm run deploy:apache
```

Skripta radi: `npm run build` -> cisti `htdocs` -> `Copy-Item dist\* -> htdocs` -> (opciono) restart.

---

## 7. Backend (FastAPI) — mora biti pokrenut

Dashboard bez backend-a radi u **mock modu** (crveni LIVE badge), ali za prave KPI-jeve treba API:

```powershell
# Primer (ako imas server/ folder sa FastAPI):
cd C:\cetin\Test_plus
python -m uvicorn server.main:app --host 0.0.0.0 --port 8080
# ili:
# docker compose up -d  (ako imas docker-compose.yml)
```

Proveri:
- http://localhost:8080/health -> `{"status":"ok"}`
- http://localhost:8080/api/kpis?hours=1 -> JSON sa `data: [...]`
- http://localhost:8080/api/kpis/stream?hours=1 -> SSE stream (curl vidi `data: ...`)

Ako je backend na drugom hostu (npr. `10.20.30.40:8080`), promeni `Define BACKEND_URL http://10.20.30.40:8080` u `apache/nos-dashboard.conf` i restartuj Apache.

---

## 8. Kako se koristi (za krajnjeg korisnika)

1. Otvori **http://localhost/** (ili `http://server/` / `http://server/nos-dashboard/` zavisno od deploy-a)
2. **Toolbar**: izaberi vremenski opseg (1h / 24h / 7 dana) -> `Refresh`
3. **KPI kartice**: 9 metrika sa sparklines (trend zadnjih 20 snapshot-a) + SLA cilj ispod vrednosti
4. **NOC panel**: health ring, SLA bar, aktivni alarmi, incident timeline
5. **Mapa**: Leaflet mapa Srbije — klik na okrug/stanicu filtrira tabelu
6. **Tabela**: pretraga, filter "Samo kriticno", klik na red -> drawer sa detaljima + **Trend** grafovi po celiji
7. **Export CSV**: dugme iznad tabele

---

## 9. Cesta pitanja / Troubleshooting

**Q: Refresh na /neka-putanja daje 404?**
A: `.htaccess` nije aktivan. Proveri: `AllowOverride All` u `<Directory>` i da je `mod_rewrite` ukljucen. Za podfolder proveri `RewriteBase`.

**Q: /api/kpis vraca 404 ili CORS gresku?**
A: `ProxyPass` nije ukljucen ili backend nije pokrenut. Proveri `httpd -t` i `error.log`. Testiraj direktno `curl http://localhost:8080/api/kpis`.

**Q: SSE (LIVE badge crven) ne radi, ali REST radi?**
A: Nedostaje `flushpackets=on` ili firewall sece duge konekcije. Proveri `<Location /api/kpis/stream>` blok i da backend salje `Content-Type: text/event-stream`.

**Q: Posle `npm run build` promene se ne vide?**
A: Browser kesira `index.html`? `.htaccess` vec salje `no-cache` za HTML, ali uradi hard refresh (`Ctrl+F5`) ili ocisti kes. Proveri da je `dist/` kopiran u `htdocs` (ako koristis strategiju B).

**Q: Kako promeniti API URL bez rebuild-a?**
A: Ne moze — Vite ubacuje `VITE_*` u build (staticki). Promeni `.env.production` i ponovo `npm run build` + deploy. Alternativa: dodati `config.js` koji se ucitava runtime (nije trenutno implementirano — reci ako treba).

**Q: Kako na Linux serveru?**
A: Isto, samo putanje:
```bash
npm run build
sudo cp -r dist/* /var/www/nos-dashboard/
sudo cp apache/nos-dashboard.conf /etc/apache2/sites-available/nos-dashboard.conf
# u conf promeni Define DOCROOT "/var/www/nos-dashboard"
sudo a2enmod rewrite proxy proxy_http headers expires deflate
sudo a2ensite nos-dashboard
sudo apache2ctl configtest && sudo systemctl reload apache2
```

---

## 10. Komande — cheat sheet

```powershell
# Dev (Vite)
npm run dev                          # http://localhost:3000 (proxy /api -> :8080)

# Build
npm run build                        # root
npm run build:apache:subfolder       # podfolder /nos-dashboard/

# Deploy
powershell -ExecutionPolicy Bypass -File scripts/deploy-apache.ps1 -Restart

# Provera
httpd -t                              # Syntax OK?
Get-Content C:\xampp\apache\logs\nos-dashboard-error.log -Tail 20
curl http://localhost/api/kpis?hours=1
curl -N http://localhost/api/kpis/stream?hours=1  # SSE
```
