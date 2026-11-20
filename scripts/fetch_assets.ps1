$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $PSScriptRoot
$tileCache = Join-Path $root '.tilecache'
$vendorDir = Join-Path $root 'vendor'

New-Item -ItemType Directory -Force -Path $tileCache | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $vendorDir 'addons\controls') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $vendorDir 'addons\lines') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $vendorDir 'addons\environments') | Out-Null

function Test-PngHeader([string]$Path) {
    if (-not (Test-Path $Path)) { return $false }
    $fi = Get-Item $Path
    if ($fi.Length -lt 100) { return $false }
    $fs = [System.IO.File]::OpenRead($Path)
    try {
        $buf = New-Object byte[] 4
        $read = $fs.Read($buf, 0, 4)
        return ($read -eq 4 -and $buf[0] -eq 0x89 -and $buf[1] -eq 0x50 -and $buf[2] -eq 0x4E -and $buf[3] -eq 0x47)
    } finally {
        $fs.Dispose()
    }
}

function Test-ValidJs([string]$Path) {
    if (-not (Test-Path $Path)) { return $false }
    $fi = Get-Item $Path
    if ($fi.Length -lt 200) { return $false }
    $head = Get-Content -Path $Path -TotalCount 5 -Encoding UTF8 -ErrorAction SilentlyContinue | Out-String
    if ($head -match '<!DOCTYPE|<html|<HTML|404 Not Found') { return $false }
    return $true
}

$wc = New-Object System.Net.WebClient
$wc.Headers.Add('User-Agent', 'Mozilla/5.0 Exodus3DAssetFetcher/1.0')

Write-Host '=== 1. Downloading 36 AWS Mapzen Terrarium DEM tiles (z=8, x=149..154, y=102..107) ==='
$tileCount = 0
for ($x = 149; $x -le 154; $x++) {
    for ($y = 102; $y -le 107; $y++) {
        $tileCount++
        $dest = Join-Path $tileCache ("8_${x}_${y}.png")
        if (Test-PngHeader $dest) {
            Write-Host "  [cache] 8/${x}/${y}.png"
            continue
        }
        $url = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/8/${x}/${y}.png"
        Write-Host "  [fetch $tileCount/36] $url"
        $wc.DownloadFile($url, $dest)
        if (-not (Test-PngHeader $dest)) {
            throw "Invalid PNG header for $dest from $url"
        }
    }
}

Write-Host '=== 2. Downloading Three.js r160 vendor ES modules ==='
$vendorFiles = @(
    @{ url = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'; dest = (Join-Path $vendorDir 'three.module.js') },
    @{ url = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js'; dest = (Join-Path $vendorDir 'addons\controls\OrbitControls.js') },
    @{ url = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/MapControls.js'; dest = (Join-Path $vendorDir 'addons\controls\MapControls.js') },
    @{ url = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/lines/Line2.js'; dest = (Join-Path $vendorDir 'addons\lines\Line2.js') },
    @{ url = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/lines/LineGeometry.js'; dest = (Join-Path $vendorDir 'addons\lines\LineGeometry.js') },
    @{ url = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/lines/LineMaterial.js'; dest = (Join-Path $vendorDir 'addons\lines\LineMaterial.js') },
    @{ url = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/lines/LineSegments2.js'; dest = (Join-Path $vendorDir 'addons\lines\LineSegments2.js') },
    @{ url = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/lines/LineSegmentsGeometry.js'; dest = (Join-Path $vendorDir 'addons\lines\LineSegmentsGeometry.js') },
    @{ url = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/environments/RoomEnvironment.js'; dest = (Join-Path $vendorDir 'addons\environments\RoomEnvironment.js') }
)

foreach ($item in $vendorFiles) {
    if (Test-ValidJs $item.dest) {
        Write-Host "  [cache] $($item.dest)"
        continue
    }
    Write-Host "  [fetch] $($item.url)"
    $wc.DownloadFile($item.url, $item.dest)
    if (-not (Test-ValidJs $item.dest)) {
        throw "Invalid JS file downloaded at $($item.dest)"
    }
}

$wc.Dispose()

Write-Host '=== Verification ==='
$pngOk = (Get-ChildItem $tileCache -Filter '*.png' | Where-Object { Test-PngHeader $_.FullName }).Count
$jsOk = ($vendorFiles | Where-Object { Test-ValidJs $_.dest }).Count
Write-Host "Terrarium PNGs valid: $pngOk / 36"
Write-Host "Vendor JS valid: $jsOk / $($vendorFiles.Count)"
if ($pngOk -ne 36 -or $jsOk -ne $vendorFiles.Count) {
    throw 'Asset verification failed.'
}
Write-Host 'ALL ASSETS DOWNLOADED AND VERIFIED.'
