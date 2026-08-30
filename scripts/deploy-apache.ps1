#Requires -Version 5.1
<#
.SYNOPSIS
  Build + deploy NOC Dashboard na Apache (Windows).

.DESCRIPTION
  1. Pokrece `npm run build` (Vite -> dist/)
  2. Kopira dist/ u Apache DocumentRoot (htdocs)
  3. Opciono restartuje Apache servis

.PARAMETER Htdocs
  Putanja do Apache htdocs foldera. Auto-detekcija: XAMPP -> Apache24 -> C:/Apache24/htdocs
  Primer: -Htdocs "C:\xampp\htdocs\nos-dashboard"

.PARAMETER Subfolder
  Ako je $true: build sa VITE_BASE_PATH=/nos-dashboard/ (za http://server/nos-dashboard/)
  Default: $false (root: http://server/)

.PARAMETER Restart
  Restartuj Apache servis posle kopiranja.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/deploy-apache.ps1
  powershell -ExecutionPolicy Bypass -File scripts/deploy-apache.ps1 -Subfolder -Restart
  powershell -ExecutionPolicy Bypass -File scripts/deploy-apache.ps1 -Htdocs "C:\Apache24\htdocs"
#>
[CmdletBinding()]
param(
  [string]$Htdocs = "",
  [switch]$Subfolder,
  [switch]$Restart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $ProjectRoot

# --- 1. Detektuj htdocs ako nije zadat ---
if (-not $Htdocs) {
  $candidates = @(
    "C:\xampp\htdocs\nos-dashboard",
    "C:\Apache24\htdocs\nos-dashboard",
    "C:\Apache24\htdocs",
    "C:\wamp64\www\nos-dashboard"
  )
  foreach ($c in $candidates) {
    $parent = Split-Path $c -Parent
    if (Test-Path $parent) { $Htdocs = $c; break }
  }
  if (-not $Htdocs) { $Htdocs = "C:\xampp\htdocs\nos-dashboard" }
}
Write-Host "Deploy target: $Htdocs" -ForegroundColor Cyan

# --- 2. Build ---
if ($Subfolder) {
  Write-Host "Build (subfolder /nos-dashboard/)..." -ForegroundColor Yellow
  $env:VITE_BASE_PATH = "/nos-dashboard/"
  # cross-env nije obavezan na Windows - postavi env direktno
  & npm.cmd run build
} else {
  Write-Host "Build (root /)..." -ForegroundColor Yellow
  Remove-Item Env:VITE_BASE_PATH -ErrorAction SilentlyContinue
  & npm.cmd run build
}
if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE)" }

if (-not (Test-Path "$ProjectRoot\dist\index.html")) {
  throw "dist/index.html ne postoji - build nije uspeo?"
}
if (-not (Test-Path "$ProjectRoot\dist\.htaccess")) {
  Write-Warning ".htaccess nije u dist/ - proveri da postoji public/.htaccess"
}

# --- 3. Kopiraj ---
Write-Host "Kopiram dist/ -> $Htdocs ..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $Htdocs | Out-Null
# Ocisti staro (osim .htaccess ako ga rucno menjas na serveru - ovde brisemo sve)
Get-ChildItem -Path $Htdocs -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -Path "$ProjectRoot\dist\*" -Destination $Htdocs -Recurse -Force
Write-Host "Kopirano:" -ForegroundColor Green
Get-ChildItem $Htdocs | Format-Table Name, Length -AutoSize | Out-String | Write-Host

# --- 4. Uputstvo za vhost ---
Write-Host ""
Write-Host "SLEDECI KORAK (jednokratno):" -ForegroundColor Magenta
Write-Host "  1. Kopiraj apache/nos-dashboard.conf u Apache conf/extra/ i ukljuci ga u httpd.conf:"
Write-Host "       Include conf/extra/nos-dashboard.conf" -ForegroundColor Gray
Write-Host "  2. U httpd.conf ukljuci module (ukloni # ispred):" -ForegroundColor Gray
Write-Host "       LoadModule rewrite_module modules/mod_rewrite.so" -ForegroundColor DarkGray
Write-Host "       LoadModule proxy_module modules/mod_proxy.so" -ForegroundColor DarkGray
Write-Host "       LoadModule proxy_http_module modules/mod_proxy_http.so" -ForegroundColor DarkGray
Write-Host "       LoadModule headers_module modules/mod_headers.so" -ForegroundColor DarkGray
Write-Host "       LoadModule expires_module modules/mod_expires.so" -ForegroundColor DarkGray
Write-Host "       LoadModule deflate_module modules/mod_deflate.so" -ForegroundColor DarkGray
Write-Host "  3. Restart Apache. Vidi APACHE.md za detalje." -ForegroundColor Gray

# --- 5. Restart (opciono) ---
if ($Restart) {
  Write-Host ""
  Write-Host "Restart Apache..." -ForegroundColor Yellow
  $svc = Get-Service -Name "Apache2.4","Apache24","wampapache64","httpd" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($svc) {
    Restart-Service $svc.Name -Force
    Write-Host "Servis $($svc.Name) restartovan." -ForegroundColor Green
  } else {
    Write-Host "Nisam nasao Apache servis - restartuj rucno:" -ForegroundColor Yellow
    Write-Host "  XAMPP: XAMPP Control Panel -> Apache -> Stop/Start" -ForegroundColor Gray
    Write-Host "  Apache24: httpd -k restart" -ForegroundColor Gray
  }
}

Write-Host ""
Write-Host "Gotovo. Otvori http://localhost/  (ili http://localhost/nos-dashboard/ za subfolder)" -ForegroundColor Green
