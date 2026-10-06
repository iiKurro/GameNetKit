# GameNetKit - finds which game servers you connect to and measures ping / packet loss.
# Read-only: captures packet headers with pktmon (built into Windows), pings, looks up location.
# It does not block anything and does not change any setting.
param(
    [switch]$SelfTest,
    [string]$Game
)

$ErrorActionPreference = 'Stop'
$Version = '0.1.0'
# Works both as a .ps1 and when compiled to an exe (where $PSCommandPath is empty).
$SelfPath = $PSCommandPath
if (-not $SelfPath) { $SelfPath = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName }
$IsExe = -not $PSCommandPath
$Root = Split-Path -Parent $SelfPath

function Test-Admin {
    $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Read-Json($name, $default) {
    $path = Join-Path $Root $name
    if (Test-Path $path) { return (Get-Content $path -Raw | ConvertFrom-Json) }
    return $default
}

function Test-PublicIp([string]$ip) {
    $o = $ip.Split('.') | ForEach-Object { [int]$_ }
    if ($o[0] -eq 10 -or $o[0] -eq 127 -or $o[0] -eq 0 -or $o[0] -ge 224) { return $false }
    if ($o[0] -eq 192 -and $o[1] -eq 168) { return $false }
    if ($o[0] -eq 172 -and $o[1] -ge 16 -and $o[1] -le 31) { return $false }
    if ($o[0] -eq 169 -and $o[1] -eq 254) { return $false }
    if ($o[0] -eq 100 -and $o[1] -ge 64 -and $o[1] -le 127) { return $false }
    return $true
}

# Turns pktmon text lines into per-remote-IP stats, keeping only packets that use one of the game's local ports.
function Read-Capture($lines, $ports) {
    $rx = [regex]'(\d{1,3}(?:\.\d{1,3}){3})\.(\d{1,5}) > (\d{1,3}(?:\.\d{1,3}){3})\.(\d{1,5}):.*?length (\d+)'
    $stats = @{}
    $matched = 0
    foreach ($line in $lines) {
        $m = $rx.Match($line)
        if (-not $m.Success) { continue }
        $matched++
        $sp = [int]$m.Groups[2].Value
        $dp = [int]$m.Groups[4].Value
        if ($ports.Contains($sp)) { $remote = $m.Groups[3].Value; $rport = $dp }
        elseif ($ports.Contains($dp)) { $remote = $m.Groups[1].Value; $rport = $sp }
        else { continue }
        if (-not (Test-PublicIp $remote)) { continue }
        if (-not $stats.ContainsKey($remote)) {
            $stats[$remote] = [pscustomobject]@{ IP = $remote; Packets = 0; Bytes = 0L; Port = $rport }
        }
        $stats[$remote].Packets++
        $stats[$remote].Bytes += [long]$m.Groups[5].Value
    }
    return [pscustomobject]@{ Servers = @($stats.Values | Sort-Object Packets -Descending); ParsedLines = $matched }
}

function Measure-Ping([string]$ip, [int]$count) {
    $ping = New-Object System.Net.NetworkInformation.Ping
    $times = @(); $lost = 0
    for ($i = 0; $i -lt $count; $i++) {
        try {
            $r = $ping.Send($ip, 1000)
            if ($r.Status -eq 'Success') { $times += [int]$r.RoundtripTime } else { $lost++ }
        } catch { $lost++ }
        Start-Sleep -Milliseconds 200
    }
    if ($times.Count -eq 0) { return [pscustomobject]@{ Avg = $null; Max = $null; Jitter = $null; Loss = 100 } }
    $avg = ($times | Measure-Object -Average).Average
    $jit = 0
    if ($times.Count -gt 1) {
        $d = for ($i = 1; $i -lt $times.Count; $i++) { [math]::Abs($times[$i] - $times[$i - 1]) }
        $jit = ($d | Measure-Object -Average).Average
    }
    return [pscustomobject]@{
        Avg = [math]::Round($avg); Max = ($times | Measure-Object -Maximum).Maximum
        Jitter = [math]::Round($jit, 1); Loss = [math]::Round(100 * $lost / $count)
    }
}

# Location lookup: sends only the server IPs to ip-api.com (free, no key).
function Get-Geo($ips) {
    $map = @{}
    try {
        $body = ConvertTo-Json -InputObject @($ips | ForEach-Object { @{ query = $_; fields = 'status,country,city,isp,query' } })
        $res = Invoke-RestMethod -Method Post -Uri 'http://ip-api.com/batch' -Body $body -ContentType 'application/json' -TimeoutSec 15
        foreach ($r in $res) { if ($r.status -eq 'success') { $map[$r.query] = $r } }
    } catch { Write-Host "  (location lookup failed: $($_.Exception.Message))" -ForegroundColor DarkYellow }
    return $map
}

function Get-Ptr([string]$ip) {
    try { return (Resolve-DnsName $ip -Type PTR -QuickTimeout -ErrorAction Stop | Select-Object -First 1).NameHost } catch { return '' }
}

function Rate($s) {
    if ($null -eq $s.Avg) { return 'no ping reply (server blocks ping)' }
    if ($s.Loss -ge 3) { return 'BAD - packet loss' }
    if ($s.Avg -ge 100 -or $s.Jitter -ge 15) { return 'BAD - high ping/jitter' }
    if ($s.Avg -ge 60) { return 'ok' }
    return 'GOOD'
}

function Show-Report($servers, $cfg, $gameName, $outDir) {
    $top = @($servers | Select-Object -First $cfg.topServers)
    if ($top.Count -eq 0) { Write-Host 'No game servers found.' -ForegroundColor Red; return }
    Write-Host "`nMeasuring $($top.Count) servers (ping x$($cfg.pingCount))..." -ForegroundColor Cyan
    $geo = Get-Geo ($top | ForEach-Object { $_.IP })
    $rows = foreach ($s in $top) {
        $p = Measure-Ping $s.IP $cfg.pingCount
        $g = $geo[$s.IP]
        [pscustomobject]@{
            Game = $gameName; IP = $s.IP; Port = $s.Port; Packets = $s.Packets; KB = [math]::Round($s.Bytes / 1KB)
            Country = $(if ($g) { $g.country } else { '?' }); City = $(if ($g) { $g.city } else { '?' })
            Provider = $(if ($g) { $g.isp } else { '?' }); Host = (Get-Ptr $s.IP)
            AvgPing = $p.Avg; MaxPing = $p.Max; Jitter = $p.Jitter; LossPct = $p.Loss; Verdict = (Rate $p)
        }
    }
    Write-Host ''
    $rows | Format-Table IP, Country, City, Packets, AvgPing, MaxPing, Jitter, LossPct, Verdict -AutoSize | Out-String -Width 200 | Write-Host
    Write-Host "Top row = most traffic = most likely your actual match server." -ForegroundColor Yellow
    if ($outDir) {
        New-Item -ItemType Directory -Force $outDir | Out-Null
        $csv = Join-Path $outDir ("{0}_{1:yyyyMMdd_HHmmss}.csv" -f ($gameName -replace '\W', ''), (Get-Date))
        $rows | Export-Csv $csv -NoTypeInformation -Encoding UTF8
        Write-Host "Saved: $csv" -ForegroundColor Green
        Start-Process explorer.exe $outDir
    }
}

function Invoke-UpdateCheck($cfg) {
    if (-not $cfg.updateUrl -or $IsExe) { return }   # the exe is updated by downloading a new release
    try {
        $remote = (Invoke-RestMethod -Uri ($cfg.updateUrl.TrimEnd('/') + '/version.txt') -TimeoutSec 8).ToString().Trim()
        if ($remote -ne $Version) {
            $a = Read-Host "New version $remote available (you have $Version). Update now? (y/n)"
            if ($a -eq 'y') {
                foreach ($f in 'GameNetKit.ps1', 'games.json') {
                    Invoke-WebRequest -Uri ($cfg.updateUrl.TrimEnd('/') + '/' + $f) -OutFile (Join-Path $Root $f) -TimeoutSec 20
                }
                Write-Host 'Updated. Run it again.' -ForegroundColor Green
                Read-Host 'Press Enter to close'; exit
            }
        }
    } catch { }
}

# ---------------------------------------------------------------- self test (no admin, no game needed)
if ($SelfTest) {
    Write-Host "SELF TEST v$Version" -ForegroundColor Cyan
    $cfg = Read-Json 'config.json' ([pscustomobject]@{ topServers = 8; pingCount = 4; captureSeconds = 240; updateUrl = '' })
    $cfg.pingCount = 4
    $sample = @(
        '[ 0]0000.0000::2026-10-06 20:00:00.1 PktGroupId 1, PktNumber 1, Appearance 1, Direction Tx , Type Ethernet , Component 1, Edge 1, Filter 1, OriginalSize 100, LoggedSize 100',
        '	 aa-bb-cc-dd-ee-ff > 11-22-33-44-55-66, ethertype IPv4 (0x0800), length 100: 192.168.1.5.54321 > 8.8.8.8.7777: UDP, length 58',
        '	 192.168.1.5.54321 > 8.8.8.8.7777: UDP, length 58',
        '	 8.8.8.8.7777 > 192.168.1.5.54321: UDP, length 120',
        '	 192.168.1.5.54321 > 1.1.1.1.7777: UDP, length 40',
        '	 192.168.1.5.60000 > 9.9.9.9.53: UDP, length 40',
        '	 192.168.1.5.54321 > 192.168.1.1.53: UDP, length 40'
    )
    $testPorts = New-Object 'System.Collections.Generic.HashSet[int]'
    [void]$testPorts.Add(54321)
    $r = Read-Capture $sample $testPorts
    Write-Host ("Parsed lines: {0}, servers found: {1} (expected 2: 8.8.8.8 first, 1.1.1.1)" -f $r.ParsedLines, $r.Servers.Count)
    $r.Servers | Format-Table -AutoSize | Out-String | Write-Host
    Show-Report $r.Servers $cfg 'SelfTest' $null
    exit
}

# ---------------------------------------------------------------- real run
if (-not (Test-Admin)) {
    $extra = ''
    if ($Game) { $extra = " -Game `"$Game`"" }
    if ($IsExe) { Start-Process $SelfPath -Verb RunAs -ArgumentList $extra.Trim() }
    else { Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$SelfPath`"$extra" }
    exit
}

$cfg = Read-Json 'config.json' ([pscustomobject]@{ topServers = 8; pingCount = 10; captureSeconds = 240; updateUrl = '' })
$games = @(Read-Json 'games.json' @() | Where-Object { $_.enabled })
if ($games.Count -eq 0) { Write-Host 'No enabled games in games.json'; Read-Host 'Press Enter'; exit }

Write-Host "=== GameNetKit v$Version ===" -ForegroundColor Cyan
Invoke-UpdateCheck $cfg

$g = $null
if ($Game) { $g = $games | Where-Object { $_.name -eq $Game } | Select-Object -First 1 }
if (-not $g -and $games.Count -eq 1) { $g = $games[0] }
if (-not $g) {
    for ($i = 0; $i -lt $games.Count; $i++) { Write-Host ("  [{0}] {1}" -f ($i + 1), $games[$i].name) }
    $n = [int](Read-Host 'Pick a game number')
    $g = $games[$n - 1]
}

$procName = $g.process -replace '\.exe$', ''
Write-Host "`nGame: $($g.name)" -ForegroundColor Green
Write-Host "Start the game now and join a match. Waiting for $procName.exe ..."
while (-not (Get-Process -Name $procName -ErrorAction SilentlyContinue)) { Start-Sleep -Seconds 2 }
Write-Host 'Game detected. Get into a MATCH (not just the menu). Capture starts when you press Enter.' -ForegroundColor Yellow
Read-Host 'Press Enter when you are in a match'

$work = Join-Path $env:TEMP 'GameNetKit'
New-Item -ItemType Directory -Force $work | Out-Null
$etl = Join-Path $work 'cap.etl'
$txt = Join-Path $work 'cap.txt'
Remove-Item $etl, $txt -ErrorAction SilentlyContinue

$ports = New-Object 'System.Collections.Generic.HashSet[int]'
try {
    & pktmon stop 2>$null | Out-Null
    & pktmon filter remove 2>$null | Out-Null
    & pktmon filter add GameUDP -t UDP | Out-Null
    & pktmon start --capture --comp nics --pkt-size 128 --file-name $etl --file-size 300 | Out-Null

    $end = (Get-Date).AddSeconds($cfg.captureSeconds)
    while ((Get-Date) -lt $end) {
        $pids = @(Get-Process -Name $procName -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
        foreach ($e in (Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $pids -contains $_.OwningProcess })) { [void]$ports.Add([int]$e.LocalPort) }
        $left = [int]($end - (Get-Date)).TotalSeconds
        if ($left % 15 -lt 3) { Write-Host "  capturing... $left s left (game ports seen: $($ports.Count))" }
        Start-Sleep -Seconds 3
    }
} finally {
    & pktmon stop 2>$null | Out-Null
    & pktmon filter remove 2>$null | Out-Null
}

Write-Host 'Analyzing capture...' -ForegroundColor Cyan
& pktmon etl2txt $etl --out $txt | Out-Null
if (-not (Test-Path $txt)) { Write-Host 'Capture file missing - pktmon failed.' -ForegroundColor Red; Read-Host 'Press Enter'; exit }

$r = Read-Capture ([System.IO.File]::ReadLines($txt)) $ports
Write-Host ("Packets parsed: {0} | game ports: {1} | servers: {2}" -f $r.ParsedLines, $ports.Count, $r.Servers.Count)
if ($r.ParsedLines -eq 0 -or $r.Servers.Count -eq 0) {
    $dbg = Join-Path $Root 'Results'
    New-Item -ItemType Directory -Force $dbg | Out-Null
    Copy-Item $txt (Join-Path $dbg 'debug_capture.txt') -Force
    Write-Host "Nothing usable. Debug file saved: $dbg\debug_capture.txt (send it to the author)" -ForegroundColor Red
    Get-Content $txt -TotalCount 12 | Write-Host
    Read-Host 'Press Enter'; exit
}

Show-Report $r.Servers $cfg $g.name (Join-Path $Root 'Results')
Read-Host "`nPress Enter to close"
