"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMaterial = applyMaterial;
// src/main/material.ts - the window backdrop material.
//
// Mica and Acrylic are DWM system backdrops; the older Aero glass is the undocumented
// SetWindowCompositionAttribute blur. Electron exposes neither, so a short PowerShell script
// calls them on the window handle Electron hands out.
//
// Two things make this awkward, and both are handled by reporting rather than assuming:
//   * a window that has already been created cannot always be switched to a backdrop, so the
//     main window applies the saved material at creation time;
//   * if the call fails there is no way to tell from here, so the script's own report is kept
//     and the caller can fall back to the flat renderer background.
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const BACKDROP = {
    // DWMSBT_* from the Windows 11 backdrop API
    mica: 2,
    acrylic: 3,
    tabbed: 4,
};
/** The PowerShell that does the work. Kept as a string so there is no extra file to ship. */
function script(hwnd, mode) {
    return `
$ErrorActionPreference = 'Stop'
$hwnd = [IntPtr]${hwnd}
$mode = '${mode}'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DomeBackdrop {
  [DllImport("dwmapi.dll", PreserveSig = true)]
  public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

  [DllImport("user32.dll", PreserveSig = true)]
  public static extern int SetWindowCompositionAttribute(IntPtr hwnd, ref AccentPolicy data);

  [StructLayout(LayoutKind.Sequential)]
  public struct AccentPolicy {
    public int AccentState;
    public int AccentFlags;
    public int GradientColor;
    public int AnimationId;
  }
}
"@

# DWMWA_USE_IMMERSIVE_DARK_MODE (20) and DWMWA_SYSTEMBACKDROP_TYPE (38)
$backdrops = @{ 'mica' = 2; 'acrylic' = 3; 'tabbed' = 4 }

function Set-Backdrop([int]$type) {
  $v = $type
  return [DomeBackdrop]::DwmSetWindowAttribute($hwnd, 38, [ref]$v, 4)
}

function Set-Blur([int]$state, [int]$flags, [int]$colour) {
  $p = New-Object DomeBackdrop+AccentPolicy
  $p.AccentState = $state
  $p.AccentFlags = $flags
  $p.GradientColor = $colour
  $p.AnimationId = 0
  return [DomeBackdrop]::SetWindowCompositionAttribute($hwnd, [ref]$p)
}

$report = @{ ok = $false; applied = 'none'; reason = '' }

if ($mode -eq 'none') {
  # turn the backdrop off and go back to an opaque window
  [void](Set-Backdrop 1)          # DWMSBT_NONE
  [void](Set-Blur 0 0 0)          # ACCENT_DISABLED
  $report = @{ ok = $true; applied = 'none'; reason = '' }
}
elseif ($backdrops.ContainsKey($mode)) {
  $hr = Set-Backdrop $backdrops[$mode]
  if ($hr -eq 0) {
    $report = @{ ok = $true; applied = $mode; reason = '' }
  } else {
    # older builds only have the blur path, so try it before giving up
    $hr2 = Set-Blur 4 2 0x99FFFFFF   # ACCENT_ENABLE_ACRYLICBLURBEHIND
    $report = @{
      ok = ($hr2 -eq 0)
      applied = $(if ($hr2 -eq 0) { 'acrylic' } else { 'none' })
      reason = "DwmSetWindowAttribute(38,$($backdrops[$mode])) failed with 0x$('{0:X8}' -f $hr)"
    }
  }
}
elseif ($mode -eq 'aero') {
  # The classic Aero path is SetWindowCompositionAttribute with ACCENT_ENABLE_BLURBEHIND.
  # Measured on the target build that call is refused, so it is tried first and the DWM acrylic
  # backdrop is the fallback: the request was for glass, and the report names which one arrived.
  $hr = Set-Blur 3 2 0x00000000
  if ($hr -ne 0) {
    $hr2 = Set-Backdrop 3
    $report = @{
      ok = ($hr2 -eq 0)
      applied = $(if ($hr2 -eq 0) { 'acrylic' } else { 'none' })
      reason = $(if ($hr2 -eq 0) { 'Aero glass is refused on this build; the acrylic backdrop was used instead' } else { 'the Aero path and the acrylic backdrop were both refused' })
    }
  } else {
    $report = @{ ok = $true; applied = 'aero'; reason = '' }
  }
}
elseif ($mode -eq 'blur') {
  # a heavier, darker glass. ACCENT_ENABLE_ACRYLICBLURBEHIND is the strongest legacy state;
  # where it is refused the DWM tabbed backdrop is the closest thing that is granted.
  $hr = Set-Blur 4 2 0xB3000000
  if ($hr -ne 0) {
    $hr2 = Set-Backdrop 4
    $report = @{
      ok = ($hr2 -eq 0)
      applied = $(if ($hr2 -eq 0) { 'tabbed' } else { 'none' })
      reason = $(if ($hr2 -eq 0) { 'the heavy blur is refused on this build; the tabbed backdrop was used instead' } else { 'the heavy blur and the tabbed backdrop were both refused' })
    }
  } else {
    $report = @{ ok = $true; applied = 'blur'; reason = '' }
  }
}
else {
  $report = @{ ok = $false; applied = 'none'; reason = "unknown material '$mode'" }
}

$report | ConvertTo-Json -Compress
`.trim();
}
/** Turns a Buffer from getNativeWindowHandle into the decimal pointer PowerShell needs. */
function hwndToDecimal(handle) {
    // the buffer is pointer sized: 8 bytes on x64, 4 on ia32
    return handle.length >= 8
        ? handle.readBigUInt64LE(0).toString(10)
        : String(handle.readUInt32LE(0));
}
/**
 * Applies a material to a window. Resolves with what actually took effect, so the caller can
 * fall back to the renderer's own background when the system refuses.
 */
function applyMaterial(win, mode) {
    if (process.platform !== 'win32') {
        return Promise.resolve({ applied: 'none', ok: false, reason: 'only Windows has these materials' });
    }
    let hwnd;
    try {
        hwnd = hwndToDecimal(win.getNativeWindowHandle());
    }
    catch (e) {
        return Promise.resolve({ applied: 'none', ok: false, reason: String(e?.message ?? e) });
    }
    const ps = node_path_1.default.join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const exe = node_fs_1.default.existsSync(ps) ? ps : 'powershell.exe';
    return new Promise((resolve) => {
        let out = '';
        let settled = false;
        const done = (result) => {
            if (settled)
                return;
            settled = true;
            resolve(result);
        };
        let child;
        try {
            child = (0, node_child_process_1.spawn)(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script(hwnd, mode)], {
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        }
        catch (e) {
            done({ applied: 'none', ok: false, reason: String(e?.message ?? e) });
            return;
        }
        child.stdout?.on('data', (b) => {
            out += b.toString('utf8');
        });
        child.on('error', (e) => done({ applied: 'none', ok: false, reason: String(e.message) }));
        child.on('close', () => {
            const text = out.trim().split(/\r?\n/).pop() ?? '';
            try {
                const parsed = JSON.parse(text);
                done({
                    applied: (parsed.applied ?? 'none'),
                    ok: !!parsed.ok,
                    reason: parsed.reason || undefined,
                });
            }
            catch {
                done({ applied: 'none', ok: false, reason: text.slice(0, 200) || 'the script produced no report' });
            }
        });
        // a stuck helper must not hold the window up
        setTimeout(() => {
            try {
                child.kill();
            }
            catch {
                /* already gone */
            }
            done({ applied: 'none', ok: false, reason: 'the material helper timed out' });
        }, 5000);
    });
}
