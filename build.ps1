# Builds dist\GameNetKit.exe: web UI (vite) -> single html -> embedded in a C# exe compiled with the csc that ships with Windows.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ui = Join-Path $root 'ui'
$dist = Join-Path $root 'dist'

Push-Location $ui
if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund }
npx vite build
if ($LASTEXITCODE -ne 0) { throw 'vite build failed' }
Pop-Location

New-Item -ItemType Directory -Force $dist | Out-Null
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:winexe /optimize+ /out:"$dist\GameNetKit.exe" `
    /win32manifest:"$root\src\app.manifest" /win32icon:"$root\src\app.ico" `
    /resource:"$ui\dist\index.html,ui.html" `
    /reference:System.Web.Extensions.dll /reference:System.Core.dll /reference:System.Management.dll /reference:System.Security.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
    "$root\src\Program.cs" "$root\src\UiHost.Extra.cs" "$root\src\Worker.cs" "$root\src\Analyzer.cs" "$root\src\Firewall.cs" "$root\src\Guard.cs" "$root\src\UiHost.People.cs" "$root\src\UiHost.Window.cs" "$root\src\ProcUtil.cs" "$root\src\GuardInstall.cs" "$root\src\UiHost.Settings.cs" "$root\src\UiHost.Sync.cs" "$root\src\AssemblyInfo.cs" "$root\src\Tray.cs" "$root\src\UiHost.Tools.cs"
if ($LASTEXITCODE -ne 0) { throw 'csc failed' }
Copy-Item "$root\games.json", "$root\config.json" $dist -Force
Get-ChildItem $dist | Select-Object Name, Length
