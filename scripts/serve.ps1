param(
    [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$mimeTypes = @{
    '.html'        = 'text/html; charset=utf-8'
    '.css'         = 'text/css; charset=utf-8'
    '.js'          = 'application/javascript; charset=utf-8'
    '.mjs'         = 'application/javascript; charset=utf-8'
    '.json'        = 'application/json; charset=utf-8'
    '.webmanifest' = 'application/manifest+json; charset=utf-8'
    '.bin'         = 'application/octet-stream'
    '.jpg'         = 'image/jpeg'
    '.jpeg'        = 'image/jpeg'
    '.png'         = 'image/png'
    '.svg'         = 'image/svg+xml'
    '.ico'         = 'image/x-icon'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Static server listening at http://127.0.0.1:$Port/ (root: $root)"

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response

        $rel = $req.Url.AbsolutePath.TrimStart('/')
        if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
        $rel = $rel -replace '/', '\'

        $fullPath = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
        if (-not $fullPath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $fullPath -PathType Leaf)) {
            $res.StatusCode = 404
            $buf = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $rel")
            $res.ContentType = 'text/plain; charset=utf-8'
            $res.ContentLength64 = $buf.Length
            $res.OutputStream.Write($buf, 0, $buf.Length)
            $res.Close()
            continue
        }

        $ext = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
        $res.ContentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }
        $res.AddHeader('Cache-Control', 'no-cache')
        $bytes = [System.IO.File]::ReadAllBytes($fullPath)
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        $res.Close()
    }
} finally {
    $listener.Stop()
}
