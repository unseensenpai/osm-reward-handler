# update.ps1 — OSM Reward Handler otomatik güncelleyici
#
# GitHub Releases'ten son sürümü indirir ve bu klasörün üstüne açar.
# Kurulumdan sonra chrome://extensions sayfasından "Yenile" demeniz yeterli.
#
# Kullanım:
#   .\update.ps1              son sürüme güncelle
#   .\update.ps1 -Check       yalnızca kontrol et, indirme
#   .\update.ps1 -Force       aynı sürüm olsa da yeniden indir
#
# NOT: Chrome uzantıları kendilerini güncelleyemez (unpacked kurulumda uzantı
# kendi dosyalarına yazamaz). Bu script o boşluğu doldurur.

[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$Owner = "unseensenpai"
$Repo  = "osm-reward-handler"
$Root  = $PSScriptRoot

function Write-Step($msg)  { Write-Host "  $msg" }
function Write-Ok($msg)    { Write-Host "  $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "  $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "  $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "OSM Reward Handler - Guncelleyici" -ForegroundColor Cyan
Write-Host "=================================="

# --- Mevcut surum ---------------------------------------------------------
$manifestPath = Join-Path $Root "manifest.json"
if (-not (Test-Path $manifestPath)) {
    Write-Err "manifest.json bulunamadi. Bu script uzanti klasorunde calistirilmali."
    exit 1
}

$current = (Get-Content $manifestPath -Raw | ConvertFrom-Json).version
Write-Step "Mevcut surum : v$current"

# --- Son surum ------------------------------------------------------------
try {
    $api = "https://api.github.com/repos/$Owner/$Repo/releases/latest"
    $rel = Invoke-RestMethod -Uri $api -Headers @{
        "Accept"     = "application/vnd.github+json"
        "User-Agent" = "osm-reward-handler-updater"
    }
} catch {
    Write-Err "GitHub'a ulasilamadi: $($_.Exception.Message)"
    exit 1
}

$latest = $rel.tag_name -replace '^v', ''
Write-Step "Son surum    : v$latest"

# --- Karsilastir ----------------------------------------------------------
# [version] tipi "3.4.10 > 3.4.9" karsilastirmasini dogru yapar (metin yapmaz).
$needsUpdate = $false
try {
    $needsUpdate = [version]$latest -gt [version]$current
} catch {
    $needsUpdate = $latest -ne $current
}

if (-not $needsUpdate -and -not $Force) {
    Write-Host ""
    Write-Ok "Zaten guncelsiniz."
    Write-Host ""
    exit 0
}

if ($needsUpdate) {
    Write-Host ""
    Write-Host "  Yeni surum mevcut: v$latest" -ForegroundColor Green
}

if ($Check) {
    Write-Host ""
    Write-Step "(-Check verildi, indirme yapilmadi)"
    Write-Host ""
    exit 0
}

# --- ZIP asset'ini bul ----------------------------------------------------
$asset = $rel.assets | Where-Object { $_.name -like "*.zip" } | Select-Object -First 1
if (-not $asset) {
    Write-Err "Release'te ZIP dosyasi yok: $($rel.html_url)"
    exit 1
}

$tmp     = Join-Path ([System.IO.Path]::GetTempPath()) "osm-update-$([guid]::NewGuid())"
$zipPath = Join-Path $tmp $asset.name
$extract = Join-Path $tmp "extract"

New-Item -ItemType Directory -Path $tmp -Force | Out-Null

Write-Host ""
Write-Step "Indiriliyor: $($asset.name) ($([math]::Round($asset.size/1KB)) KB)"

try {
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -UseBasicParsing
} catch {
    Write-Err "Indirme basarisiz: $($_.Exception.Message)"
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}

Write-Step "Aciliyor..."
try {
    Expand-Archive -Path $zipPath -DestinationPath $extract -Force
} catch {
    Write-Err "ZIP acilamadi: $($_.Exception.Message)"
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}

# ZIP tek bir ust klasor iceriyorsa onun icine in.
$source = $extract
$roots  = @(Get-ChildItem $extract)
if ($roots.Count -eq 1 -and $roots[0].PSIsContainer) {
    $source = $roots[0].FullName
}

if (-not (Test-Path (Join-Path $source "manifest.json"))) {
    Write-Err "Indirilen pakette manifest.json yok; kurulum iptal edildi."
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}

# --- Yedek al -------------------------------------------------------------
# Kullanici verisi (chrome.storage) uzantida degil tarayicida durur, ondan
# etkilenmez. Yine de dosyalarin yedegi guvence olsun.
$backup = Join-Path $Root ".backup-v$current"
Write-Step "Yedek: .backup-v$current"

if (Test-Path $backup) { Remove-Item $backup -Recurse -Force }
New-Item -ItemType Directory -Path $backup -Force | Out-Null

Get-ChildItem $Root -Force |
    Where-Object { $_.Name -notlike ".backup-*" -and $_.Name -ne ".git" } |
    ForEach-Object { Copy-Item $_.FullName -Destination $backup -Recurse -Force }

# --- Kur ------------------------------------------------------------------
Write-Step "Dosyalar guncelleniyor..."

# .git ve yedekler korunur; geri kalan paketten gelenle degistirilir.
Get-ChildItem $source -Force | ForEach-Object {
    $dest = Join-Path $Root $_.Name
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Copy-Item $_.FullName -Destination $dest -Recurse -Force
}

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

$installed = (Get-Content $manifestPath -Raw | ConvertFrom-Json).version

Write-Host ""
Write-Ok "Kurulum tamam: v$current -> v$installed"
Write-Host ""
Write-Host "  SON ADIM:" -ForegroundColor Yellow
Write-Host "    1. chrome://extensions adresini ac"
Write-Host "    2. OSM Reward Handler kartindaki yenile (donen ok) simgesine bas"
Write-Host ""
Write-Step "Sorun olursa yedek burada: .backup-v$current"
Write-Host ""
