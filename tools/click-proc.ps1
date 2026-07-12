# Click inside a running process's window, in WINDOW-RELATIVE pixels.
#
# For driving the editor's UI from a script: the whole value of a "wire up the UI"
# change is that the buttons are actually clickable, and asserting that from a unit
# test is exactly the thing a unit test cannot do.
#
#   powershell -File tools\click-proc.ps1 -Name bloom-editor -X 1796 -Y 149
#
# Coordinates are relative to the window's top-left, in physical pixels.
param([string]$Name = 'bloom-editor', [int]$X = 0, [int]$Y = 0, [int]$Count = 1)

$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public struct RECT { public int L, T, R, B; }
public static class CK {
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);
}
'@
[CK]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null

$p = Get-Process -Name $Name -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { Write-Host "no process '$Name'"; exit 1 }
$p.Refresh()
$h = $p.MainWindowHandle
if ($h -eq [IntPtr]::Zero) { Write-Host "no window"; exit 1 }

[CK]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 300

$r = New-Object RECT
[CK]::GetWindowRect($h, [ref]$r) | Out-Null
$sx = $r.L + $X
$sy = $r.T + $Y

for ($i = 0; $i -lt $Count; $i++) {
  [CK]::SetCursorPos($sx, $sy) | Out-Null
  Start-Sleep -Milliseconds 120
  [CK]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)   # LEFTDOWN
  Start-Sleep -Milliseconds 60
  [CK]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)   # LEFTUP
  Start-Sleep -Milliseconds 220
}
Write-Host "clicked $Name at window ($X,$Y) -> screen ($sx,$sy) x$Count"
