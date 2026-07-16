// Encode the mastered music to what the game ships.
//
//   bun tools/encode-music.ts
//
// tools/music-master.ts writes loop-cut WAVs into assets/music/; this turns
// each one into the OGG the game loads (the engine's decode_audio handles
// Vorbis natively — assets/sounds/ambient.ogg shipped that way long before
// the beds did) and deletes the WAV intermediate. WAV was 33.9 MB of repo
// weight for six files; OGG q8 (~256 kbps VBR) is ~5 MB and transparent for
// game music under a mixer.
//
// Requires ffmpeg on PATH — the same dependency SH-044's audio ingest uses.

import { readdirSync, existsSync, unlinkSync } from 'node:fs';

const DIR = 'assets/music';
const Q = '8';   // libvorbis VBR quality: ~256 kbps, transparent

if (!existsSync(DIR)) {
  console.log(`[encode-music] ${DIR} missing - nothing to do`);
  process.exit(0);
}

let n = 0;
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.wav')) continue;
  const src = `${DIR}/${f}`;
  const dst = `${DIR}/${f.slice(0, -4)}.ogg`;
  const r = Bun.spawnSync(['ffmpeg', '-loglevel', 'error', '-y',
                           '-i', src, '-c:a', 'libvorbis', '-q:a', Q, dst]);
  if (r.exitCode !== 0) {
    console.log(`[encode-music] FAILED: ${src}`);
    console.log(new TextDecoder().decode(r.stderr));
    process.exit(1);
  }
  unlinkSync(src);
  console.log(`[encode-music] ${src} -> ${dst}`);
  n = n + 1;
}
console.log(`[encode-music] ${n} file(s) encoded`);
