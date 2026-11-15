# Installs or updates Concerto for the current user on Windows:
#   the release package in %LOCALAPPDATA%\Concerto\app, a `concerto` command in
#   %LOCALAPPDATA%\Concerto\bin (added to your user PATH), and the Concerto skills for the agents
#   found on this machine (Claude Code, Codex, pi). Rerun it to update. No administrator rights.
#   irm https://raw.githubusercontent.com/RemiPelloux/Concerto/main/scripts/install.ps1 | iex
# CONCERTO_ARCHIVE installs another package: a URL or a local concerto.zip.
$ErrorActionPreference = "Stop"

$Root = if ($env:CONCERTO_HOME) { $env:CONCERTO_HOME } else { Join-Path $env:LOCALAPPDATA "Concerto" }
$App = Join-Path $Root "app"
$Bin = Join-Path $Root "bin"
$Archive = if ($env:CONCERTO_ARCHIVE) { $env:CONCERTO_ARCHIVE } else { "https://github.com/RemiPelloux/Concerto/releases/latest/download/concerto.zip" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "concerto install: Node 22 or newer is required: https://nodejs.org" }
$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 22) { throw "concerto install: Node 22 or newer is required, found $major." }

$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("concerto-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  $Zip = Join-Path $Tmp "concerto.zip"
  if ($Archive -match '^https?://') {
    Write-Host "Downloading $Archive"
    Invoke-WebRequest -UseBasicParsing -Uri $Archive -OutFile $Zip
  } else {
    Copy-Item -Path $Archive -Destination $Zip
  }
  Expand-Archive -Path $Zip -DestinationPath $Tmp -Force
  if (-not (Test-Path (Join-Path $Tmp "concerto\dist\cli.js"))) { throw "concerto install: the package has no dist\cli.js." }
  # Only ever replace a Concerto install: CONCERTO_HOME pointing anywhere else stops here.
  if (Test-Path $App) {
    $manifest = Join-Path $App "package.json"
    if (-not ((Test-Path $manifest) -and ((Get-Content -Raw $manifest) -match '"name": "concerto"'))) { throw "concerto install: $App exists and is not a Concerto install." }
    Remove-Item -Recurse -Force $App
  }
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  Move-Item -Path (Join-Path $Tmp "concerto") -Destination $App
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Force -Path $Bin | Out-Null
$Cli = Join-Path $App "dist\cli.js"
Set-Content -Encoding ASCII -Path (Join-Path $Bin "concerto.cmd") -Value "@echo off`r`nnode `"$Cli`" %*"
Write-Host "Installed $(node $Cli --version) in $App"

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not (($UserPath -split ";") -contains $Bin)) {
  $NewPath = if ($UserPath) { "$UserPath;$Bin" } else { $Bin }
  [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
  Write-Host "Added $Bin to your PATH. Open a new terminal for it to apply."
}
$env:Path = "$env:Path;$Bin"

Write-Host "Teaching your agents to use Concerto:"
node $Cli --install-skills
Write-Host "Done. Run: concerto --doctor"
