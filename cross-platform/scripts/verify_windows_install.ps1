$ErrorActionPreference = 'Stop'
$root = Join-Path $env:RUNNER_TEMP 'opendesk-install-verification'
New-Item -ItemType Directory -Force -Path $root | Out-Null
$installer = Get-ChildItem 'src-tauri/target/release/bundle/nsis/*.exe' | Select-Object -First 1
if (!$installer) { throw 'NSIS installer missing' }
$installDir = Join-Path $root 'installed'
$process = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
$exe = Join-Path $installDir 'document-workbench-tw.exe'
if (!(Test-Path $exe)) { throw 'Installed executable missing' }
$env:OPENDESK_DATA_DIR = Join-Path $root 'profile'
$env:OPENDESK_DIAGNOSTICS = Join-Path $root 'diagnostics'
$process = Start-Process -FilePath $exe -ArgumentList @('--verify-install', "`"$root`"") -PassThru
if (!$process.WaitForExit(180000)) { $process.Kill(); throw 'Installed verification timed out' }
if ($process.ExitCode -ne 0) { throw "Installed verification failed: $($process.ExitCode)" }
$proof = Get-Content (Join-Path $root 'verification.json') -Raw | ConvertFrom-Json
$version = (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
if (!$proof.passed -or !$proof.packaged_core -or $proof.version -ne $version) { throw 'Installed proof is invalid' }
$gui = Start-Process -FilePath $exe -PassThru
try {
  $readyPath = Join-Path $env:OPENDESK_DIAGNOSTICS 'window_ready.json'
  $deadline = (Get-Date).AddSeconds(90)
  while (!(Test-Path $readyPath) -and (Get-Date) -lt $deadline -and !$gui.HasExited) { Start-Sleep -Milliseconds 500; $gui.Refresh() }
  if (!(Test-Path $readyPath)) { throw 'Installed window did not initialize' }
  $ready = Get-Content $readyPath -Raw | ConvertFrom-Json
  if ($ready.version -ne $version -or $ready.summary.navigation -ne 6) { throw 'Installed window proof is invalid' }
  $gui.Refresh()
  if ($gui.MainWindowHandle -eq 0) { throw 'Installed app has no visible main window' }
  $proof | Add-Member NoteProperty window_ready $true
} finally {
  if (!$gui.HasExited) { [void]$gui.CloseMainWindow(); if (!$gui.WaitForExit(15000)) { $gui.Kill(); $gui.WaitForExit() } }
}
$uninstaller = Join-Path $installDir 'uninstall.exe'
if (!(Test-Path $uninstaller)) { throw 'Uninstaller missing' }
$process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
if ($process.ExitCode -ne 0) { throw 'Uninstaller failed' }
$deadline = (Get-Date).AddSeconds(30)
while ((Test-Path $exe) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
if (Test-Path $exe) { throw 'Uninstaller left installed executable' }
$proof | Add-Member NoteProperty uninstall $true
$proof | ConvertTo-Json -Depth 8 | Set-Content 'windows-install-verification.json' -Encoding utf8
Write-Output 'Windows install, packaged core, recovery, window and uninstall: PASS'
