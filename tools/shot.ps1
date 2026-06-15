# Build the shooter and capture one gameplay screenshot via geisterhand.
# Usage: powershell -ExecutionPolicy Bypass -File tools/shot.ps1 -Name foo [-Settle 6]
# Settle defaults to 12s: the deferred pipeline (shadow maps, TAA accumulation,
# auto-exposure adaptation) needs several seconds to converge, and the D3D12
# window must be foreground for geisterhand to capture a non-blank frame.
param([string]$Name = 'shot', [int]$Settle = 12)
$ErrorActionPreference = 'Stop'
$proj = 'C:\Users\Ralph\projects\bloom\shooter'
$gh   = 'C:\Users\Ralph\projects\geisterhandwindows\publish\geisterhand.exe'
Set-Location $proj
# Kill any running instance first — it locks main.exe and the link can't overwrite it.
Get-Process main,geisterhand -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400
$b = cmd /c "perry compile src/main.ts -o main 2>&1"
if ($LASTEXITCODE -ne 0) { Write-Host "BUILD FAILED:" -ForegroundColor Red; $b | Select-Object -Last 14; exit 1 }
Write-Host "build ok"
$srv = Start-Process $gh -ArgumentList @('server','--port','7676') -PassThru -WindowStyle Hidden
$game = Start-Process "$proj\main.exe" -WorkingDirectory $proj -PassThru -RedirectStandardError "$proj\_run_err.txt"
Start-Sleep -Seconds $Settle
$dst = "$proj\tools\.testout\$Name.png"
if (-not $game.HasExited) {
  # The D3D12 game window only presents capturable frames while it is the
  # foreground window — geisterhand otherwise captures a blank/white surface.
  Add-Type -AssemblyName Microsoft.VisualBasic
  try { [Microsoft.VisualBasic.Interaction]::AppActivate($game.Id) | Out-Null } catch {}
  Start-Sleep -Milliseconds 600
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:7676/screenshot?pid=$($game.Id)&format=png" -TimeoutSec 15
    $bytes = [Convert]::FromBase64String($r.image)
    [IO.File]::WriteAllBytes($dst, $bytes)
    $n=[Math]::Min($bytes.Length,60000); $sum=0; for($i=0;$i -lt $n;$i++){$sum+=$bytes[$i]}
    Write-Host ("saved $dst ($($r.width)x$($r.height)) bright=$([Math]::Round($sum/$n,1)) size=$($bytes.Length)") -ForegroundColor Green
  } catch { Write-Host "screenshot failed: $_" -ForegroundColor Red }
} else {
  Write-Host "GAME EXITED early code=$($game.ExitCode)" -ForegroundColor Red
  Get-Content "$proj\_run_err.txt" -Tail 14
}
Get-Process main,geisterhand -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
