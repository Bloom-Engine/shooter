// SH-044 — cross-platform image downscaling for the asset converters.
//
// Four converters (convert-arena, convert-aliens, convert-aliens-anim,
// build-props) shelled out to `sips`, which is macOS-only. On the Windows dev
// box that means they simply cannot run: regenerating any texture-bearing asset
// required a Mac. That is a silly thing to be blocked by, and it is exactly the
// kind of friction that stops content from being remade.
//
// ffmpeg is already a documented dependency of this repo (the audio pipeline
// needs it), it exists on every platform, and it decodes PNG/JPEG/TGA/BMP — a
// strictly larger set than sips handled. So: one helper, used everywhere.

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

let checked = false;

/// Fail loudly and once, with the fix in the message. A converter that silently
/// skips its textures produces an asset that looks *almost* right, which is far
/// worse than one that refuses to build.
export function requireFfmpeg(): void {
  if (checked) return;
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    checked = true;
  } catch {
    throw new Error(
      'ffmpeg not found on PATH.\n' +
      '  The asset converters need it to decode/resize source textures.\n' +
      '  Windows: winget install Gyan.FFmpeg\n' +
      '  macOS:   brew install ffmpeg\n' +
      '  Linux:   apt install ffmpeg');
  }
}

/// Downscale `src` so its longest edge is at most `max` px, writing `dst`.
/// Preserves aspect ratio and never upscales — `scale` with `min(iw,MAX)` keeps
/// an already-small source untouched, which matters because upscaling a 256px
/// source to 1024 just wastes 16x the VRAM for no detail.
export function resizeMax(src: string, dst: string, max: number): void {
  requireFfmpeg();
  const dir = dirname(dst);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  // -y overwrite, -loglevel error so a clean run is quiet.
  const vf = `scale='min(${max},iw)':'min(${max},ih)':force_original_aspect_ratio=decrease`;
  execSync(`ffmpeg -y -loglevel error -i "${src}" -vf "${vf}" "${dst}"`,
           { stdio: 'inherit' });
}
