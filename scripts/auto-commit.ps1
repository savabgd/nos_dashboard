param(
    [string]$Message = "",
    [switch]$Push,
    [switch]$Watch,
    [int]$WatchInterval = 30
)

$ErrorActionPreference = "Stop"

$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) {
    throw "This folder is not a Git repository. Run 'git init' first."
}

function Invoke-AutoCommit {
    param([string]$Msg)

    $pending = git status --porcelain
    if (-not $pending) {
        Write-Host "No changes to commit." -ForegroundColor DarkGray
        return $false
    }

    git add -A

    $staged = git diff --cached --name-status
    if (-not $staged) {
        Write-Host "No staged changes to commit." -ForegroundColor DarkGray
        return $false
    }

    $files = @($staged | ForEach-Object {
        $parts = $_ -split "\s+", 2
        [PSCustomObject]@{
            Status = $parts[0]
            Path = if ($parts.Count -gt 1) { $parts[1] } else { "" }
        }
    })

    $added = @($files | Where-Object { $_.Status -match "^A" }).Count
    $modified = @($files | Where-Object { $_.Status -match "^M" }).Count
    $deleted = @($files | Where-Object { $_.Status -match "^D" }).Count
    $renamed = @($files | Where-Object { $_.Status -match "^R" }).Count
    $total = $files.Count

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

    if ([string]::IsNullOrWhiteSpace($Msg)) {
        $summaryParts = @()
        if ($added -gt 0) { $summaryParts += "$added added" }
        if ($modified -gt 0) { $summaryParts += "$modified modified" }
        if ($deleted -gt 0) { $summaryParts += "$deleted deleted" }
        if ($renamed -gt 0) { $summaryParts += "$renamed renamed" }
        if ($summaryParts.Count -eq 0) { $summaryParts += "$total changed" }

        $Msg = "Auto commit: " + ($summaryParts -join ", ")
    }

    $commitMessageLines = @(
        $Msg,
        "",
        "Timestamp: $timestamp",
        "",
        "Changed files:",
        ""
    ) + ($files | ForEach-Object { "- $($_.Status) $($_.Path)" })

    $messageFile = New-TemporaryFile
    try {
        Set-Content -LiteralPath $messageFile -Value ($commitMessageLines -join [Environment]::NewLine) -NoNewline
        git commit -F $messageFile
    }
    finally {
        Remove-Item -LiteralPath $messageFile -Force -ErrorAction SilentlyContinue
    }

    # Append to changelog
    $changelogPath = Join-Path $repoRoot "CHANGELOG-auto.md"
    $changelogEntry = @(
        "## $timestamp",
        "",
        "**$Msg**",
        "",
        "| Status | File |",
        "| ------ | ---- |"
    )
    foreach ($f in $files) {
        $changelogEntry += "| $($f.Status) | $($f.Path) |"
    }
    $changelogEntry += ""

    $header = "# Auto Commit Changelog`n`n"
    if (-not (Test-Path $changelogPath)) {
        Set-Content -LiteralPath $changelogPath -Value ($header + ($changelogEntry -join "`n") + "`n") -NoNewline
    } else {
        $existing = Get-Content -LiteralPath $changelogPath -Raw
        $newContent = $header + ($changelogEntry -join "`n") + "`n" + $existing.Substring($header.Length)
        Set-Content -LiteralPath $changelogPath -Value $newContent -NoNewline
    }

    Write-Host ""
    Write-Host "Committed at $timestamp" -ForegroundColor Green
    Write-Host "  Added:    $added" -ForegroundColor Green
    Write-Host "  Modified: $modified" -ForegroundColor Yellow
    Write-Host "  Deleted:  $deleted" -ForegroundColor Red
    Write-Host "  Renamed:  $renamed" -ForegroundColor Cyan
    Write-Host "  Total:    $total" -ForegroundColor White
    Write-Host "  Logged to: CHANGELOG-auto.md" -ForegroundColor DarkGray
    Write-Host ""

    if ($Push) {
        Write-Host "Pushing to remote..." -ForegroundColor Cyan
        git push
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Push successful." -ForegroundColor Green
        } else {
            Write-Host "Push failed (no remote configured or network error)." -ForegroundColor Red
        }
    }

    return $true
}

# --- Watch mode ---
if ($Watch) {
    Write-Host "Watch mode: checking every $WatchInterval seconds. Press Ctrl+C to stop." -ForegroundColor Cyan
    $lastHash = git rev-parse HEAD 2>$null
    while ($true) {
        Start-Sleep -Seconds $WatchInterval
        $pending = git status --porcelain
        if ($pending) {
            Write-Host "`n[$(Get-Date -Format 'HH:mm:ss')] Changes detected, committing..." -ForegroundColor Yellow
            Invoke-AutoCommit -Msg $Message
        }
    }
    return
}

# --- Single run ---
Invoke-AutoCommit -Msg $Message