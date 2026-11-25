param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$Evidence
)
$ErrorActionPreference = "Stop"
if ($env:GITHUB_ACTIONS -ne "true" -or $env:RUNNER_OS -ne "Windows" -or
    $env:RUNNER_ENVIRONMENT -ne "github-hosted") {
  throw "This acceptance run requires a disposable GitHub-hosted Windows runner."
}

$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$root = Join-Path $env:RUNNER_TEMP ("wantedframe-review-" + [Guid]::NewGuid().ToString("N"))
$appPath = Join-Path $root "app"
$profile = Join-Path $env:APPDATA "WantedFrame"
$preferences = Join-Path $profile "setup-preferences.json"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$startupKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
$watcher = "WantedFrameWarframeWatcher"

if (Test-Path -LiteralPath $profile) { throw "An existing WantedFrame profile was found." }
New-Item -ItemType Directory -Path $root | Out-Null

function Invoke-Installer($path, $arguments) {
  $process = Start-Process -FilePath $path -ArgumentList $arguments -PassThru
  if (-not $process.WaitForExit(180000)) {
    & taskkill.exe /PID $process.Id /T /F | Out-Null
    throw "Installer process did not exit within three minutes."
  }
  $process.Refresh()
  if ($process.ExitCode -ne 0) { throw "Installer process exited with $($process.ExitCode)." }
}

Invoke-Installer $installerPath @("/S", "/currentuser", "/D=$appPath")
$application = Join-Path $appPath "WantedFrame.exe"
$uninstaller = Join-Path $appPath "Uninstall WantedFrame.exe"
if (-not (Test-Path -LiteralPath $application) -or -not (Test-Path -LiteralPath $uninstaller)) {
  throw "The install did not create the application and uninstaller."
}
$choice = Get-Content -Raw -LiteralPath $preferences | ConvertFrom-Json
if ($choice.autoInstallHelper -ne $false) { throw "Review installer enabled the helper." }

& pnpm run test:packaged $application --review
if ($LASTEXITCODE -ne 0) { throw "Installed application smoke failed." }

# Exercise only installation-owned files and keys in the disposable profile.
foreach ($key in @($runKey, $startupKey)) {
  if (-not (Test-Path -LiteralPath $key)) { New-Item -Path $key -Force | Out-Null }
}
New-ItemProperty -Path $runKey -Name $watcher -Value "fixture" -Force | Out-Null
New-ItemProperty -Path $startupKey -Name $watcher -Value "fixture" -Force | Out-Null
$metadata = Join-Path $profile "warframe-watcher.json"
Set-Content -LiteralPath $metadata -Value "{}"
Invoke-Installer $uninstaller @("/S", "/currentuser")
$deadline = [DateTime]::UtcNow.AddSeconds(30)
while ((Test-Path -LiteralPath $application) -and [DateTime]::UtcNow -lt $deadline) {
  Start-Sleep -Milliseconds 250
}
if ((Test-Path -LiteralPath $application) -or (Test-Path -LiteralPath $metadata) -or
    (Get-ItemProperty -Path $runKey -Name $watcher -ErrorAction SilentlyContinue) -or
    (Get-ItemProperty -Path $startupKey -Name $watcher -ErrorAction SilentlyContinue)) {
  throw "Uninstall left installation-owned artifacts."
}
if (-not (Test-Path -LiteralPath $preferences)) { throw "Uninstall removed profile preferences." }

$result = @{
  install = "pass"
  launchAndExit = "pass"
  uninstall = "pass"
  profilePreserved = $true
  installerSha256 = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
}
$result | ConvertTo-Json | Set-Content -LiteralPath $Evidence
