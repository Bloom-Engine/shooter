# Capture ONLY the game's own window rectangle.
#
# Why not the engine's takeScreenshot(): on this box the TS call never reaches
# the native FFI at all (no "screenshot requested" log, no file) — see
# docs/tickets.md EN-038. Why not a full-desktop grab: the game may fail to go
# fullscreen, and then the capture would contain whatever else is on screen.
# GetWindowRect keeps the capture to the game and nothing else.
param([int]$At = 8, [string]$Out = 'tools\.testout\shot.png')

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public struct RECT { public int L, T, R, B; }
public static class W {
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
}
'@
[W]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null

$proj = 'C:\Users\Ralph\projects\bloom\shooter'
Set-Location $proj
Get-Process main -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400

$g = Start-Process "$proj\main.exe" -WorkingDirectory $proj -PassThru `
    -RedirectStandardOutput "$proj\tools\.testout\shot_out.txt" `
    -RedirectStandardError  "$proj\tools\.testout\shot_err.txt"

Start-Sleep -Seconds 3
$g.Refresh()
$h = $g.MainWindowHandle
if ($h -eq [IntPtr]::Zero) { Write-Host "no window"; $g.Kill(); exit 1 }
[W]::ShowWindow($h, 3) | Out-Null          # SW_MAXIMIZE
[W]::SetForegroundWindow($h) | Out-Null

Start-Sleep -Seconds ([Math]::Max(1, $At - 3))
if ($g.HasExited) { Write-Host "exited early"; exit 1 }

$r = New-Object RECT
[W]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.R - $r.L
$hh = $r.B - $r.T
if ($w -le 0 -or $hh -le 0) { Write-Host "bad rect"; $g.Kill(); exit 1 }

$bmp = New-Object System.Drawing.Bitmap $w, $hh
$gr = [System.Drawing.Graphics]::FromImage($bmp)
$gr.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$bmp.Save("$proj\$Out", [System.Drawing.Imaging.ImageFormat]::Png)
$gr.Dispose(); $bmp.Dispose()
Write-Host "saved $Out  ${w}x${hh}  (window rect $($r.L),$($r.T))"

Start-Sleep -Milliseconds 500
if (-not $g.HasExited) { $g.Kill() }
Get-Content "$proj\tools\.testout\shot_out.txt" -ErrorAction SilentlyContinue | Select-Object -Last 3
