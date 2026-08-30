#Requires -Version 5.1
# Podesava C:\xampp\apache\conf\httpd.conf za NOC Dashboard
# Ukljucuje 6 modula + Include za nos-dashboard.conf

$httpdConf = "C:\xampp\apache\conf\httpd.conf"
if (-not (Test-Path $httpdConf)) {
  $httpdConf = "C:\Apache24\conf\httpd.conf"
}
if (-not (Test-Path $httpdConf)) {
  Write-Error "Ne nalazim httpd.conf (probano C:\xampp\apache\conf\httpd.conf i C:\Apache24\conf\httpd.conf)"
  exit 1
}

Write-Host "Menjam: $httpdConf" -ForegroundColor Cyan
$text = Get-Content $httpdConf -Raw

$replacements = @(
  @("#LoadModule rewrite_module", "LoadModule rewrite_module"),
  @("#LoadModule proxy_module", "LoadModule proxy_module"),
  @("#LoadModule proxy_http_module", "LoadModule proxy_http_module"),
  @("#LoadModule headers_module", "LoadModule headers_module"),
  @("#LoadModule expires_module", "LoadModule expires_module"),
  @("#LoadModule deflate_module", "LoadModule deflate_module")
)

foreach ($pair in $replacements) {
  $before = $pair[0]
  $after = $pair[1]
  if ($text.Contains($before)) {
    $text = $text.Replace($before, $after)
    Write-Host "  ukljucen: $after" -ForegroundColor Green
  } elseif ($text.Contains($after)) {
    Write-Host "  vec ukljucen: $after" -ForegroundColor DarkGray
  }
}

if ($text -notmatch "nos-dashboard\.conf") {
  $text += "`nInclude conf/extra/nos-dashboard.conf`n"
  Write-Host "  dodat: Include conf/extra/nos-dashboard.conf" -ForegroundColor Green
} else {
  Write-Host "  vec postoji: Include nos-dashboard.conf" -ForegroundColor DarkGray
}

# Backup
$backup = "$httpdConf.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item $httpdConf $backup
Write-Host "Backup: $backup" -ForegroundColor DarkGray

Set-Content -Path $httpdConf -Value $text -NoNewline
Write-Host "httpd.conf podesen!" -ForegroundColor Green
Write-Host ""
Write-Host "Sledece: C:\xampp\apache\bin\httpd.exe -t  (treba Syntax OK)" -ForegroundColor Yellow
Write-Host "Pa: XAMPP Control Panel -> Apache -> Stop / Start" -ForegroundColor Yellow
