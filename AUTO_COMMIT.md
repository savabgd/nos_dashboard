# Automatsko komitovanje (Auto-Commit)

Projekat sadrži skriptu `scripts/auto-commit.ps1` koja automatski:
- dodaje sve promene (`git add -A`)
- pravi commit sa opisom šta je promenjeno
- beleži svaku promenu u `CHANGELOG-auto.md` (sa vremenskom oznakom i tabelom fajlova)
- opcionalno radi `git push` na remote

## Korišćenje preko npm skripti

| Komanda | Šta radi |
| ------- | -------- |
| `npm run commit:auto` | Jednokratan auto-commit (sve promene) |
| `npm run commit:auto:push` | Auto-commit + `git push` |
| `npm run commit:auto:watch` | Watch režim — commit-uje čim detektuje promene (na 30s) |
| `npm run commit:auto:watch:push` | Watch režim + push posle svakog commit-a |

## Korišćenje direktno (PowerShell)

```powershell
# Osnovni auto-commit (generiše poruku automatski)
powershell -ExecutionPolicy Bypass -File scripts/auto-commit.ps1

# Sa custom porukom
powershell -ExecutionPolicy Bypass -File scripts/auto-commit.ps1 -Message "popravljen KPI izračun"

# Commit + push
powershell -ExecutionPolicy Bypass -File scripts/auto-commit.ps1 -Push

# Watch režim (provera na svakih 30s)
powershell -ExecutionPolicy Bypass -File scripts/auto-commit.ps1 -Watch

# Watch režim sa custom intervalom (npr. 10s) + push
powershell -ExecutionPolicy Bypass -File scripts/auto-commit.ps1 -Watch -WatchInterval 10 -Push
```

## Parametri

| Parametar | Tip | Podrazumevano | Opis |
| --------- | -- | ------------- | ---- |
| `-Message` | string | `""` | Poruka commit-a. Ako se ne navede, generiše se automatski (npr. `Auto commit: 2 modified, 1 added`). |
| `-Push` | switch | `$false` | Posle commit-a radi `git push`. |
| `-Watch` | switch | `$false` | Kontinuirano prati promene i commit-uje. |
| `-WatchInterval` | int | `30` | Interval u sekundama za watch režim. |

## Šta se beleži

### 1. Git commit poruka
Sadrži naslov, timestamp i listu promenjenih fajlova sa statusom:

```
Auto commit: 1 added, 1 modified

Timestamp: 2026-07-18 12:06:45

Changed files:

- A scripts/auto-commit.ps1
- M package.json
```

### 2. `CHANGELOG-auto.md`
Dnevnik svih auto-commit-ova sa tabelom promena:

```markdown
## 2026-07-18 12:06:45

**Auto commit: 1 added, 1 modified**

| Status | File |
| ------ | ---- |
| A | scripts/auto-commit.ps1 |
| M | package.json |
```

## Statusi fajlova (git)

| Oznaka | Značenje |
| ------ | -------- |
| `A` | Added (novi fajl) |
| `M` | Modified (izmenjen) |
| `D` | Deleted (obrisan) |
| `R` | Renamed (preimenovan) |
| `C` | Copied (kopiran) |

## Napomene

- Skripta radi samo ako je folder git repozitorijum (`git init`).
- `CHANGELOG-auto.md` se kreira automatski pri prvom auto-commit-u.
- Watch režim zaustavljaš sa `Ctrl+C`.
- Ako nema promena, skripta ne pravi prazan commit.
- Za `push` mora biti konfigurisan remote (`git remote add origin <url>`).