# Builds dist\GameNetKit.exe: web UI (vite) -> single html -> embedded in a C# exe compiled with the csc that ships with Windows.
# The app's own window uses WebView2: its SDK files come from the official NuGet package (pinned version, checked against a known hash)
# and are embedded in the exe, so nothing has to sit beside it.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ui = Join-Path $root 'ui'
$dist = Join-Path $root 'dist'

# ---- WebView2 SDK (downloaded once into .cache)
$wvVersion = '1.0.4258.31'
$wvSha256 = '56F7F4B8BF9AEE4B8EFEFBBDD4F67D5F74EBD1B100ED0806DA71BF76AF481AA9'
$wv = Join-Path $root '.cache\webview2'
$needed = 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.x64.dll', 'WebView2Loader.x86.dll'
if (($needed | Where-Object { -not (Test-Path (Join-Path $wv $_)) }).Count -gt 0) {
    New-Item -ItemType Directory -Force $wv | Out-Null
    $pkg = Join-Path $wv 'package.zip'
    Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$wvVersion/microsoft.web.webview2.$wvVersion.nupkg" -OutFile $pkg -UseBasicParsing
    if ((Get-FileHash $pkg -Algorithm SHA256).Hash -ne $wvSha256) { Remove-Item $pkg -Force; throw 'WebView2 package does not match the expected hash' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($pkg)
    try {
        $map = @{
            'lib/net462/Microsoft.Web.WebView2.Core.dll'      = 'Microsoft.Web.WebView2.Core.dll'
            'lib/net462/Microsoft.Web.WebView2.WinForms.dll'  = 'Microsoft.Web.WebView2.WinForms.dll'
            'runtimes/win-x64/native/WebView2Loader.dll'      = 'WebView2Loader.x64.dll'
            'runtimes/win-x86/native/WebView2Loader.dll'      = 'WebView2Loader.x86.dll'
        }
        foreach ($entry in $zip.Entries) {
            if ($map.ContainsKey($entry.FullName)) { [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $wv $map[$entry.FullName]), $true) }
        }
    } finally { $zip.Dispose() }
    Remove-Item $pkg -Force
}

Push-Location $ui
if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund }
npx vite build
if ($LASTEXITCODE -ne 0) { throw 'vite build failed' }
Pop-Location

New-Item -ItemType Directory -Force $dist | Out-Null
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:winexe /optimize+ /out:"$dist\GameNetKit.exe" `
    /win32manifest:"$root\src\app.manifest" /win32icon:"$root\src\app.ico" `
    /resource:"$ui\dist\index.html,ui.html" /resource:"$root\assets\promo.mp4,promo.mp4" `
    /resource:"$wv\Microsoft.Web.WebView2.Core.dll,Microsoft.Web.WebView2.Core.dll" /resource:"$wv\Microsoft.Web.WebView2.WinForms.dll,Microsoft.Web.WebView2.WinForms.dll" `
    /resource:"$wv\WebView2Loader.x64.dll,WebView2Loader.x64.dll" /resource:"$wv\WebView2Loader.x86.dll,WebView2Loader.x86.dll" `
    /reference:"$wv\Microsoft.Web.WebView2.Core.dll" /reference:"$wv\Microsoft.Web.WebView2.WinForms.dll" `
    /reference:System.Web.Extensions.dll /reference:System.Core.dll /reference:System.Management.dll /reference:System.Security.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
    "$root\src\Program.cs" "$root\src\UiHost.Extra.cs" "$root\src\Worker.cs" "$root\src\Analyzer.cs" "$root\src\Firewall.cs" "$root\src\Guard.cs" "$root\src\UiHost.People.cs" "$root\src\UiHost.Window.cs" "$root\src\ProcUtil.cs" "$root\src\GuardInstall.cs" "$root\src\UiHost.Settings.cs" "$root\src\UiHost.Sync.cs" "$root\src\AssemblyInfo.cs" "$root\src\Tray.cs" "$root\src\Overlay.cs" "$root\src\OverlayLive.cs" "$root\src\UiHost.Tools.cs" "$root\src\UiHost.Overlay.cs" "$root\src\WebHost.cs" "$root\src\UiHost.Art.cs" "$root\src\RegionLock.cs"
if ($LASTEXITCODE -ne 0) { throw 'csc failed' }
Copy-Item "$root\games.json", "$root\config.json" $dist -Force
Get-ChildItem $dist | Select-Object Name, Length
