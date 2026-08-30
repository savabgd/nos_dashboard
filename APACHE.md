# Apache — Kako pokrenuti sajt (jednostavno)

> **Ukratko:** `npm run dev` radi samo dok ti kucaš kod. Za firmu (Apache) moraš napraviti gotove fajlove (`dist/`) i dati ih Apache-u da ih servira. To je sve.

---

## Sta ti treba

- **Node.js** (vec imas — `npm` radi)
- **XAMPP** (to je Apache za Windows) — ako ga nemas, korak 1 ispod

---

## KORAK 1 — Instaliraj Apache (samo jednom)

Ako vec imas XAMPP ili Apache, preskoci na Korak 2.

1. Otvori https://www.apachefriends.org/download.html
2. Skini **XAMPP za Windows** (bilo koja verzija sa PHP 8.x)
3. Instaliraj u `C:\xampp` — samo klikci **Next / Next / Finish** (sve default)
4. Otvori **XAMPP Control Panel** (ikonica narandžasta, nadji u Start meniju)
5. U redu gde pise **Apache** klikni **Start**
   - Ako pise **Stop** i pozadina je zelena — radi!
   - Ako pise greska da je port 80 zauzet — ugasi Skype ili IIS, pa opet Start
6. Proveri: otvori browser na **http://localhost/dashboard**
   - Ako vidis XAMPP stranicu — Apache radi. Zatvori je, idemo dalje.

---

## KORAK 2 — Napravi fajlove za Apache (1 komanda)

Otvori PowerShell u folderu projekta i ukucaj:

```powershell
cd C:\cetin\Test_plus
npm run build
```

Sacekaj 10 sekundi. Treba da pise `✓ built in ...`.

Sta se desilo? Napravio se folder `dist/` — to su gotovi fajlovi za Apache:
```
dist/
  index.html        <- tvoj sajt
  .htaccess         <- govori Apache-u kako da otvara stranice bez 404
  assets/           <- JS i CSS (hasheovani)
  serbia-districts.geojson
```

**Proveri:** otvori `C:\cetin\Test_plus\dist` u Exploreru — ako vidis `index.html`, uspelo je.

---

## KORAK 3 — Podesi Apache (samo jednom, 2 minuta)

Otvorimo jedan fajl i ukljucimo 5 linija:

1. Otvori fajl `C:\xampp\apache\conf\httpd.conf` u Notepad-u
2. Nadji (Ctrl+F) redove koji pocinju sa `#LoadModule rewrite_module` itd.
   Ukloni `#` ispred ovih 6 redova da budu ovako (bez #):

```apache
LoadModule rewrite_module modules/mod_rewrite.so
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_http_module modules/mod_proxy_http.so
LoadModule headers_module modules/mod_headers.so
LoadModule expires_module modules/mod_expires.so
LoadModule deflate_module modules/mod_deflate.so
```

3. Idi na **kraj** fajla `httpd.conf` i dodaj ovaj red:

```apache
Include conf/extra/nos-dashboard.conf
```

4. Kopiraj nas config fajl:

```powershell
Copy-Item C:\cetin\Test_plus\apache\nos-dashboard.conf C:\xampp\apache\conf\extra\nos-dashboard.conf
```

5. Restart Apache: u **XAMPP Control Panel** klikni **Stop** pa opet **Start** pored Apache.

**Proveri da nema greske:**

```powershell
C:\xampp\apache\bin\httpd.exe -t
```

Treba da pise `Syntax OK`. Ako ne pise, javi mi sta pise — resicemo.

> **Gde je backend?** U `apache/nos-dashboard.conf` vec pise `BACKEND_URL http://127.0.0.1:8080` — to je tvoj FastAPI. Ako je backend na drugom kompu (npr. `10.20.30.40`), promeni tu liniju i restartuj Apache.

---

## KORAK 4 — Kopiraj sajt na Apache (svaki put kad menjas kod)

Svaki put kad promenis nesto u kodu, ponovi:

```powershell
cd C:\cetin\Test_plus
powershell -ExecutionPolicy Bypass -File scripts/deploy-apache.ps1 -Restart
```

Ova skripta sama radi: `npm run build` + kopira `dist/` u `C:\xampp\htdocs\nos-dashboard` + restartuje Apache.

**Rucno (ako skripta ne radi):**

```powershell
npm run build
Copy-Item C:\cetin\Test_plus\dist\* C:\xampp\htdocs\nos-dashboard -Recurse -Force
# pa u XAMPP Control Panel: Stop / Start Apache
```

---

## KORAK 5 — Otvori sajt

Otvori u browseru:

- **http://localhost/** — ako si podesio `DOCROOT` na `dist` direktno (kao u `nos-dashboard.conf`)
- **http://localhost/nos-dashboard/** — ako si kopirao u `htdocs/nos-dashboard`

Treba da vidis **NOC Dashboard** sa KPI karticama, mapom i tabelom.

---

## Sta ako ne radi? (3 najcesca problema)

**1. Vidim XAMPP stranicu umesto dashboard-a**
→ `DocumentRoot` nije dobar. Otvori `C:\xampp\apache\conf\extra\nos-dashboard.conf`, proveri liniju `Define DOCROOT` — treba da pokazuje na `C:/cetin/Test_plus/dist` ili `C:/xampp/htdocs/nos-dashboard` (zavisno sta koristis). Pa restart Apache.

**2. Refresh daje 404 ili pise Not Found**
→ `mod_rewrite` nije ukljucen. Vrati se na Korak 3, proveri da si uklonio `#` ispred `LoadModule rewrite_module...` i da je `AllowOverride All` u configu. Restart.

**3. Pise LIVE crveno / nema podataka / CORS greska**
→ Backend (`:8080`) nije upaljen. Pokreni ga:

```powershell
cd C:\cetin\Test_plus
python -m uvicorn server.main:app --host 0.0.0.0 --port 8080
```

Proveri: **http://localhost:8080/health** treba da vrati `{"status":"ok"}`. Bez backend-a dashboard radi sa laznim podacima (to je normalno za test).

Posle svake promene koda: `Ctrl+F5` u browseru (hard refresh) da ocistis kes.

---

## Kako se koristi sajt (kad proradi)

1. **Toolbar gore:** izaberi period (1h / 24h / 7 dana) → **Refresh**
2. **KPI kartice:** 9 metrika, ispod svake pise SLA cilj (`≤ 1.5%`), sparkline je trend zadnjih 20 osvezavanja
3. **Mapa:** klik na okrug/stanicu filtrira tabelu
4. **Tabela:** kucaj u pretragu, klikni **Samo kriticno**, klik na red → detalji + grafovi
5. **Export CSV:** dugme iznad tabele

---

## Napredno (samo ako treba)

<details>
<summary>Klikni za detalje: podfolder, Linux, Docker, komande</summary>

**Podfolder deploy (http://server/nos-dashboard/):**
```powershell
npm run build:apache:subfolder
# trazi RewriteBase /nos-dashboard/ u .htaccess ili koristi apache/httpd-snippet.conf
```

**Linux server:**
```bash
npm run build
sudo cp -r dist/* /var/www/nos-dashboard/
sudo cp apache/nos-dashboard.conf /etc/apache2/sites-available/nos-dashboard.conf
# u conf promeni Define DOCROOT "/var/www/nos-dashboard"
sudo a2enmod rewrite proxy proxy_http headers expires deflate
sudo a2ensite nos-dashboard
sudo apache2ctl configtest && sudo systemctl reload apache2
```

**Docker:**
```powershell
docker run -d --name nos-apache -p 80:80 `
  -v C:\cetin\Test_plus\dist:/usr/local/apache2/htdocs/ `
  -v C:\cetin\Test_plus\apache\nos-dashboard.conf:/usr/local/apache2/conf/extra/nos-dashboard.conf `
  httpd:2.4
```

**Komande:**
```powershell
npm run dev                              # dev: http://localhost:3000
npm run build                            # build za root
C:\xampp\apache\bin\httpd.exe -t         # Syntax OK?
Get-Content C:\xampp\apache\logs\nos-dashboard-error.log -Tail 20
curl http://localhost/api/kpis?hours=1
```

**Fajlovi u projektu:**

| Fajl | Sta je |
|------|--------|
| `public/.htaccess` | SPA fallback + kesiranje (kopira se u dist/) |
| `apache/nos-dashboard.conf` | ceo VirtualHost |
| `apache/httpd-snippet.conf` | snippet za postojeci vhost |
| `.env.production` | `VITE_API_BASE_URL=` (prazno = ide preko Apache proxy-a) |
| `scripts/deploy-apache.ps1` | auto build+copy+restart |

</details>
