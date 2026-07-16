# f12-live.ps1 - F12 the ALREADY-RUNNING game. No relaunch, no kill.
#
# The older f12-shot.ps1 kills any running instance and boots its own
# DEFAULT-CONFIG one - which silently voided every capture taken "during" a
# harness run or an arg-configured A/B (2026-07-16: a whole day of pictures
# contradicting numbers traced to exactly this). Use THIS script whenever the
# caller owns the game process: it photographs the instance that is actually
# running, flags, harness state, env and all.
#
# ASCII only on purpose - PowerShell reads .ps1 as ANSI.
param([string]$Proc = 'main')
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Win32PostLive {
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
'@
$proj = 'C:\Users\Ralph\projects\bloom\shooter'
$before = @(Get-ChildItem "$proj\screenshot_*.png" -ErrorAction SilentlyContinue | ForEach-Object Name)
$game = Get-Process $Proc -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $game) { Write-Host "no '$Proc' process running"; exit 1 }
$game.Refresh()
$hwnd = $game.MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) { Write-Host "no main window on '$Proc'"; exit 1 }
# WM_KEYDOWN=0x100, WM_KEYUP=0x101, VK_F12=0x7B
[Win32PostLive]::PostMessage($hwnd, 0x100, [IntPtr]0x7B, [IntPtr]0) | Out-Null
Start-Sleep -Milliseconds 120
[Win32PostLive]::PostMessage($hwnd, 0x101, [IntPtr]0x7B, [IntPtr]0) | Out-Null
Start-Sleep -Seconds 3
$shot = Get-ChildItem "$proj\screenshot_*.png" -ErrorAction SilentlyContinue |
  Where-Object { $before -notcontains $_.Name } | Sort-Object LastWriteTime | Select-Object -Last 1
if ($shot) { Write-Host "shot: $($shot.Name)" } else { Write-Host "no screenshot produced" }
