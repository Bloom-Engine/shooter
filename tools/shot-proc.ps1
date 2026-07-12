# Capture the window of an ALREADY-RUNNING process, by name.
#
# shot-window.ps1 launches the game itself, which is wrong for anything with a slow
# start (the editor blocks ~20 s loading every GLB in the project). This one attaches
# to a process that is already up.
#
#   powershell -File tools\shot-proc.ps1 -Name bloom-editor -Out tools\.testout\ed.png
#
# Window rect only — never the desktop. A desktop grab catches whatever else is on
# screen, and without PMv2 DPI awareness it silently returns a 2560x1440 crop of a 4K
# window.
param([string]$Name = 'main', [string]$Out = 'tools\.testout\proc.png')

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public struct RECT { public int L, T, R, B; }
public static class WP {
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
}
'@
# PER_MONITOR_AWARE_V2 (-4): without it GetWindowRect lies on a scaled 4K display.
[WP]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null

$p = Get-Process -Name $Name -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { Write-Host "no process '$Name'"; exit 1 }
$p.Refresh()
$h = $p.MainWindowHandle
if ($h -eq [IntPtr]::Zero) { Write-Host "'$Name' has no window yet"; exit 1 }

[WP]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 600

$r = New-Object RECT
[WP]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.R - $r.L
$hgt = $r.B - $r.T
if ($w -le 0 -or $hgt -le 0) { Write-Host "bad window rect"; exit 1 }

$bmp = New-Object System.Drawing.Bitmap($w, $hgt)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$bmp.Save((Join-Path (Get-Location) $Out), [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose(); $bmp.Dispose()
Write-Host "saved $Out  ${w}x${hgt}  (from '$Name')"
