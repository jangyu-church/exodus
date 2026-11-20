$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $PSScriptRoot
$imgDir = Join-Path $root 'images'
New-Item -ItemType Directory -Force -Path $imgDir | Out-Null

$ua = 'ExodusJourneyMap/1.0 (https://github.com/jangyu-church; educational biblical archaeology viewer)'

function Test-ValidImage([string]$Path) {
    if (-not (Test-Path $Path)) { return $false }
    $fi = Get-Item $Path
    if ($fi.Length -lt 5120) { return $false }
    $fs = [System.IO.File]::OpenRead($Path)
    try {
        $buf = New-Object byte[] 4
        $n = $fs.Read($buf, 0, 4)
        if ($n -lt 4) { return $false }
        $isJpg = ($buf[0] -eq 0xFF -and $buf[1] -eq 0xD8)
        $isPng = ($buf[0] -eq 0x89 -and $buf[1] -eq 0x50 -and $buf[2] -eq 0x4E -and $buf[3] -eq 0x47)
        return ($isJpg -or $isPng)
    } finally {
        $fs.Dispose()
    }
}

function Invoke-CommonsJson([string]$QueryString) {
    $url = "https://commons.wikimedia.org/w/api.php?$QueryString"
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.UserAgent = $ua
    $req.Timeout = 20000
    $resp = $req.GetResponse()
    try {
        $sr = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
        return ($sr.ReadToEnd() | ConvertFrom-Json)
    } finally {
        $resp.Close()
    }
}

function Download-Binary([string]$Url, [string]$Dest) {
    $req = [System.Net.HttpWebRequest]::Create($Url)
    $req.UserAgent = $ua
    $req.Timeout = 30000
    $resp = $req.GetResponse()
    try {
        $inStream = $resp.GetResponseStream()
        $outStream = [System.IO.File]::Create($Dest)
        try {
            $inStream.CopyTo($outStream)
        } finally {
            $outStream.Dispose()
        }
    } finally {
        $resp.Close()
    }
}

function Strip-Html([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return '' }
    $clean = $Text -replace '<[^>]+>', ' '
    $clean = $clean -replace '\s+', ' '
    return $clean.Trim()
}

function Find-CommonsFile([string]$Query, [string]$MustMatchRegex = '') {
    $enc = [Uri]::EscapeDataString($Query)
    $res = Invoke-CommonsJson "action=query&list=search&srnamespace=6&srlimit=8&srsearch=$enc&format=json"
    Start-Sleep -Milliseconds 300
    if ($res.query.search) {
        foreach ($hit in $res.query.search) {
            if ($hit.title -match '\.(jpg|jpeg|png)$') {
                if ([string]::IsNullOrEmpty($MustMatchRegex) -or ($hit.title -match $MustMatchRegex)) {
                    return $hit.title
                }
            }
        }
    }
    return $null
}

$targets = @(
    @{ local = 'merneptah-stele.jpg'; file = 'File:Merenptah Israel Stele Cairo.jpg'; fallback = 'Merenptah Israel Stele Cairo' },
    @{ local = 'merneptah-israel-closeup.jpg'; file = 'File:Closeup of the Merneptah Stele, mentioning ysrỉꜣr ("Israel").jpg'; fallback = 'Closeup of the Merneptah Stele Israel' },
    @{ local = 'mount-ebal.jpg'; file = "File:Joshua's Altar 20.jpg"; fallback = 'Joshua Altar Mount Ebal' },
    @{ local = 'soleb-temple.jpg'; file = 'File:Temple at Soleb (8) (34130092710).jpg'; fallback = 'Temple at Soleb' },
    @{ local = 'soleb-yhw3.png'; file = 'File:Solebinscription.png'; fallback = 'Soleb Shasu Yahweh' },
    @{ local = 'timna-shrine.jpg'; file = 'File:Temple of Hathor in Timna Park in summer 2011 (1).JPG'; fallback = 'Temple of Hathor in Timna' },
    @{ local = 'timna-shrine-2.jpg'; file = 'File:Old shrine in Timna park in summer 2011.JPG'; fallback = 'Old shrine in Timna' },
    @{ local = 'serabit-sphinx.png'; file = 'File:Serabit sphinx (EA41748).png'; fallback = 'Serabit sphinx EA41748' },
    @{ local = 'rekhmire-bricks.jpg'; file = 'File:Brickmakers, Tomb of Rekhmire MET DT10882.jpg'; fallback = 'Brickmakers Tomb of Rekhmire' },
    @{ local = 'ways-of-horus.png'; file = 'File:HorusWay-Karnak-Northern exterior wall-(d).png'; fallback = 'HorusWay Karnak' },
    @{ local = 'kadesh-barnea.jpg'; file = 'File:PikiWiki Israel 75836 the oasis of kadesh barnea.jpg'; fallback = 'kadesh barnea oasis' },
    @{ local = 'kuntillet-ajrud.jpg'; file = 'File:Ajrud.jpg'; fallback = 'Kuntillet Ajrud' },
    @{ local = 'deir-alla.png'; file = "File:Deir 'Alla Inscription.png"; fallback = 'Deir Alla Inscription' },
    @{ local = 'mesha-stele.jpg'; file = 'File:Mesha stele (Louvre, AO 5066).jpg'; fallback = 'Mesha stele Louvre' },
    @{ local = 'mount-nebo.jpg'; file = 'File:Mount Nebo BW 6.JPG'; fallback = 'Mount Nebo Siyagha' },
    @{ local = 'jericho-sultan.jpg'; file = 'File:Tell_es-sultan.jpg'; fallback = 'Tell es-Sultan Jericho' },
    @{ local = 'four-room-model.jpg'; file = 'File:Israelite house mockup, Iron Age, 1200-586 BC - Harvard Semitic Museum - Cambridge, MA - DSC06022.jpg'; fallback = 'Israelite house mockup Harvard' },
    @{ local = 'four-room-ruins.jpg'; file = 'File:Horvat Haluqim - Four room house.JPG'; fallback = 'Horvat Haluqim Four room house' },
    @{ local = 'jebel-musa.jpg'; file = 'File:Sunrise at Mount Moses.jpg'; fallback = 'Sunrise at Mount Moses' },
    @{ local = 'har-karkom.jpg'; file = 'File:The "Temples Boulevard" - Har Karkom.jpg'; fallback = 'Har Karkom Temples' },
    @{ local = 'jebel-al-lawz.jpg'; file = 'File:Jabal Al-Lawz Location.jpg'; fallback = 'Jabal Al-Lawz' }
)

# Bonus search queries for additional real artifacts
$bonusSearches = @(
    @{ local = 'timna-serpent.jpg'; queries = @('Timna copper serpent', 'Timna bronze serpent', 'Copper snake Timna'); regex = 'Timna|serpent|snake' },
    @{ local = 'tell-el-daba.jpg'; queries = @('Tell el-Daba', 'Avaris excavation', 'Qantir Pi-Ramesses'); regex = 'Daba|Avaris|Qantir|Ramesses' },
    @{ local = 'papyrus-anastasi.jpg'; queries = @('Papyrus Anastasi', 'Papyrus Sallier', 'Egyptian hieratic papyrus British Museum'); regex = 'Anastasi|Brooklyn|hieratic' }
)

foreach ($bs in $bonusSearches) {
    $foundTitle = $null
    foreach ($q in $bs.queries) {
        try {
            $foundTitle = Find-CommonsFile $q $bs.regex
            if ($foundTitle) { break }
        } catch {
            Write-Host "  [bonus search warn] $q : $($_.Exception.Message)"
        }
    }
    if ($foundTitle) {
        Write-Host "  [bonus match] $($bs.local) <- $foundTitle"
        $targets += @{ local = $bs.local; file = $foundTitle; optional = $true }
    } else {
        Write-Host "  [bonus skip] $($bs.local) no matching file"
    }
}

$credits = [ordered]@{}
$okCount = 0
$failCount = 0

foreach ($item in $targets) {
    $dest = Join-Path $imgDir $item.local
    $titleToUse = $item.file

    try {
        $titleEnc = [Uri]::EscapeDataString($titleToUse)
        $infoJson = Invoke-CommonsJson "action=query&titles=$titleEnc&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1200&format=json"
        Start-Sleep -Milliseconds 300

        $pageProp = $infoJson.query.pages.PSObject.Properties | Select-Object -First 1
        $page = $pageProp.Value
        if ((-not $page.imageinfo -or $page.imageinfo.Count -eq 0) -and $item.fallback) {
            $altTitle = Find-CommonsFile $item.fallback
            if ($altTitle) {
                Write-Host "  [fallback match] $($item.local) <- $altTitle"
                $titleToUse = $altTitle
                $titleEnc = [Uri]::EscapeDataString($titleToUse)
                $infoJson = Invoke-CommonsJson "action=query&titles=$titleEnc&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1200&format=json"
                Start-Sleep -Milliseconds 300
                $pageProp = $infoJson.query.pages.PSObject.Properties | Select-Object -First 1
                $page = $pageProp.Value
            }
        }

        if (-not $page.imageinfo -or $page.imageinfo.Count -eq 0) {
            throw "No imageinfo returned for $titleToUse"
        }
        $ii = $page.imageinfo[0]
        $dlUrl = if ($ii.thumburl) { $ii.thumburl } else { $ii.url }

        $artist = Strip-Html ($ii.extmetadata.Artist.value)
        $license = Strip-Html ($ii.extmetadata.LicenseShortName.value)
        if (-not $license) { $license = 'Wikimedia Commons' }
        $creditLine = if ($artist) { "$artist · $license" } else { $license }

        $credits[$item.local] = @{
            title = $titleToUse
            sourceUrl = $ii.descriptionurl
            author = $artist
            license = $license
            credit = $creditLine
            width = $ii.width
            height = $ii.height
        }

        if (Test-ValidImage $dest) {
            Write-Host "  [cache] $($item.local)"
            $okCount++
            continue
        }

        Write-Host "  [fetch] $($item.local) <- $dlUrl"
        Download-Binary $dlUrl $dest
        Start-Sleep -Milliseconds 300

        if (-not (Test-ValidImage $dest)) {
            if ($item.optional) {
                Remove-Item -Force -ErrorAction SilentlyContinue $dest
                Write-Host "  [optional skip invalid] $($item.local)"
                continue
            }
            throw "Downloaded image invalid or too small: $dest"
        }
        $okCount++
    } catch {
        if ($item.optional) {
            Write-Host "  [optional skip] $($item.local) : $($_.Exception.Message)"
        } else {
            Write-Host "  [ERROR] $($item.local) : $($_.Exception.Message)"
            $failCount++
        }
    }
}

$creditsPath = Join-Path $imgDir 'credits.json'
$credits | ConvertTo-Json -Depth 5 | Set-Content -Path $creditsPath -Encoding UTF8

Write-Host "=== Summary: $okCount downloaded/cached, $failCount failed ==="
if ($failCount -gt 0) {
    throw "$failCount required image downloads failed."
}
