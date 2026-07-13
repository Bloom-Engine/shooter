# f12-shot.ps1 — run the game, PostMessage F12 at T seconds, collect the engine's own 4K screenshot.
param([int]$At = 26, [string]$World = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Win32Post {
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
'@
$proj = 'C:\Users\Ralph\projects\bloom\shooter'
Set-Location $proj
# Snapshot the existing screenshots so we can identify the NEW one afterward
# (do NOT delete anything — these files may be the user's).
$before = @(Get-ChildItem "$proj\screenshot_*.png" -ErrorAction SilentlyContinue | ForEach-Object Name)
Get-Process main -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400
$gameArgs = @()
if ($World -ne '') { $gameArgs = @('--world', $World) }
if ($gameArgs.Count -gt 0) {
  $game = Start-Process "$proj\main.exe" -ArgumentList $gameArgs -WorkingDirectory $proj -PassThru -RedirectStandardError "$proj\_run_err.txt"
} else {
  $game = Start-Process "$proj\main.exe" -WorkingDirectory $proj -PassThru -RedirectStandardError "$proj\_run_err.txt"
}
Start-Sleep -Seconds $At
if ($game.HasExited) { Write-Host "GAME EXITED code=$($game.ExitCode)"; exit 1 }
$game.Refresh()
$hwnd = $game.MainWindowHandle
# WM_KEYDOWN=0x100, WM_KEYUP=0x101, VK_F12=0x7B
[Win32Post]::PostMessage($hwnd, 0x100, [IntPtr]0x7B, [IntPtr]0) | Out-Null
Start-Sleep -Milliseconds 120
[Win32Post]::PostMessage($hwnd, 0x101, [IntPtr]0x7B, [IntPtr]0) | Out-Null
Start-Sleep -Seconds 2
Get-Process main -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$shot = Get-ChildItem "$proj\screenshot_*.png" | Where-Object { $before -notcontains $_.Name } | Sort-Object LastWriteTime | Select-Object -Last 1
if ($shot) { Write-Host "shot: $($shot.Name)" } else { Write-Host "no screenshot produced"; Select-String -Path "$proj\_run_err.txt" -Pattern 'screenshot' | Select-Object -Last 3 -ExpandProperty Line }
