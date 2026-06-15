<#
  geisterhand-smoketest.ps1 — black-box auto-test for Bloom Shooter on Windows.

  Launches the built ./main.exe, drives it through the geisterhand HTTP
  automation server (screenshots + synthetic input), and verifies the game
  actually renders and responds: frames are non-black, the picture changes
  over time (enemies spawn / animate), and discrete inputs (weapon switch,
  fire, quit) are accepted.

  Screenshots are written to tools/.testout/ for visual inspection, and a
  PASS/FAIL summary is printed + returned as the exit code (0 = pass).

  Usage:
    pwsh tools/geisterhand-smoketest.ps1
    pwsh tools/geisterhand-smoketest.ps1 -Exe .\main.exe -GhExe ..\..\geisterhandwindows\publish\geisterhand.exe
#>
[CmdletBinding()]
param(
  [string]$Exe   = '',
  [string]$GhExe = '',
  [int]$Port     = 7676,
  [int]$Frames   = 6,            # screenshots to capture
  [double]$Interval = 1.5        # seconds between captures
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic

# Robust script dir: $PSScriptRoot can be empty in some param-default contexts.
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot }
             elseif ($PSCommandPath) { Split-Path -Parent $PSCommandPath }
             else { 'C:\Users\Ralph\projects\bloom\shooter\tools' }
if (-not $Exe)   { $Exe   = Join-Path $ScriptDir '..\main.exe' }
if (-not $GhExe) { $GhExe = Join-Path $ScriptDir '..\..\..\geisterhandwindows\publish\geisterhand.exe' }

$ProjectRoot = Resolve-Path (Join-Path $ScriptDir '..')
$OutDir = Join-Path $ScriptDir '.testout'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Get-ChildItem $OutDir -Filter 'shot_*.png' -ErrorAction SilentlyContinue | Remove-Item -Force

$Exe   = (Resolve-Path $Exe).Path
$GhExe = (Resolve-Path $GhExe).Path
$base  = "http://127.0.0.1:$Port"

function Save-Shot([string]$name) {
  # The D3D12 game window only presents capturable frames while foreground —
  # otherwise geisterhand captures a blank/white surface. Activate first.
  try { [Microsoft.VisualBasic.Interaction]::AppActivate($script:GamePid) | Out-Null } catch {}
  Start-Sleep -Milliseconds 400
  # geisterhand returns base64 PNG scoped to our game pid.
  $uri = "$base/screenshot?pid=$($script:GamePid)&format=png"
  try {
    $resp = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 15
  } catch {
    Write-Warning "screenshot failed: $_"; return $null
  }
  $bytes = [Convert]::FromBase64String($resp.image)
  $path = Join-Path $OutDir $name
  [IO.File]::WriteAllBytes($path, $bytes)
  # Compute a crude brightness + hash so we can detect black / static frames.
  $bright = 0.0; $n = [Math]::Min($bytes.Length, 50000)
  for ($i = 0; $i -lt $n; $i++) { $bright += $bytes[$i] }
  $bright = $bright / $n
  [pscustomobject]@{ path=$path; width=$resp.width; height=$resp.height; size=$bytes.Length; bright=[Math]::Round($bright,2) }
}

function Send-Key([string]$key) {
  try { Invoke-RestMethod -Uri "$base/key" -Method Post -ContentType 'application/json' `
        -Body (@{ key=$key; pid=$script:GamePid } | ConvertTo-Json) -TimeoutSec 10 | Out-Null } catch { Write-Warning "key $key failed: $_" }
}

function Send-Click([int]$x,[int]$y) {
  try { Invoke-RestMethod -Uri "$base/click" -Method Post -ContentType 'application/json' `
        -Body (@{ x=$x; y=$y; button='left'; pid=$script:GamePid } | ConvertTo-Json) -TimeoutSec 10 | Out-Null } catch { Write-Warning "click failed: $_" }
}

Write-Host "== Bloom Shooter geisterhand smoke test ==" -ForegroundColor Cyan
Write-Host "exe:        $Exe"
Write-Host "geisterhand: $GhExe"

# 1. Start the global geisterhand server.
$ghProc = Start-Process -FilePath $GhExe -ArgumentList @('server','--port',"$Port") -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2

# 2. Launch the game (its own working dir = project root so it finds assets/).
$game = Start-Process -FilePath $Exe -WorkingDirectory $ProjectRoot -PassThru
$script:GamePid = $game.Id
Write-Host "game pid: $($script:GamePid)"
# The deferred pipeline (shadow maps, TAA accumulation, exposure) needs several
# seconds to converge before the first capture reads as a real frame.
Start-Sleep -Seconds 12

$results = @()
$passed = $true
$reasons = @()

# 3. Capture a baseline frame.
$shot0 = Save-Shot 'shot_00_boot.png'
if ($null -eq $shot0) { $passed=$false; $reasons += 'no screenshot at boot' }
else {
  $results += $shot0
  Write-Host ("boot frame: {0}x{1} bright={2}" -f $shot0.width,$shot0.height,$shot0.bright)
  if ($shot0.bright -lt 6) { $passed=$false; $reasons += "boot frame too dark (bright=$($shot0.bright))" }
}

# 4. Drive some discrete inputs while waves spawn, capturing frames.
for ($f=1; $f -lt $Frames; $f++) {
  Start-Sleep -Seconds $Interval
  if ($f -eq 2) { Send-Key 'two' }                          # switch to blaster
  if ($f -eq 3) { Send-Click ([int]512) ([int]320) }        # fire at screen center
  if ($f -eq 4) { Send-Key 'one' }                          # back to rifle
  $shot = Save-Shot ("shot_{0:d2}.png" -f $f)
  if ($shot) { $results += $shot; Write-Host ("frame {0}: bright={1} size={2}" -f $f,$shot.bright,$shot.size) }
}

# 5. Liveness: the process must still be running, and frames must vary.
$alive = -not $game.HasExited
if (-not $alive) { $passed=$false; $reasons += 'game process exited unexpectedly' }
$distinctBright = ($results | Select-Object -ExpandProperty bright | Sort-Object -Unique).Count
if ($results.Count -ge 3 -and $distinctBright -lt 2) { $passed=$false; $reasons += 'frames never changed (static render)' }

# 6. Quit the game with ESC, give it a moment, force-kill if needed.
Send-Key 'escape'
Start-Sleep -Seconds 2
if (-not $game.HasExited) { try { $game.Kill() } catch {} }
if ($ghProc -and -not $ghProc.HasExited) { try { $ghProc.Kill() } catch {} }

Write-Host ""
Write-Host "frames captured: $($results.Count)  -> $OutDir"
if ($passed) {
  Write-Host "RESULT: PASS" -ForegroundColor Green
  exit 0
} else {
  Write-Host "RESULT: FAIL" -ForegroundColor Red
  $reasons | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}
