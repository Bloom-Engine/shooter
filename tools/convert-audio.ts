// SH-044 — the audio converter.
//
// `assets/sounds/SOURCES.md` said, in as many words: "tools has no audio step —
// regenerate by hand if sources change." Every SFX in the game was produced by
// someone typing an ffmpeg line and remembering the flags. That is fine for
// three files and a liability for forty-two: nobody can reproduce the set, and
// the round-2 audio drop is unrepeatable if a source is ever re-cut.
//
// This is that step. The manifest below IS the documentation — adding a sound
// is a row, not a shell-history archaeology dig.
//
//   bun tools/convert-audio.ts            # convert everything that is missing
//   bun tools/convert-audio.ts --force    # re-convert even if the output exists
//   bun tools/convert-audio.ts --list     # what is missing, and why
//
// Output format is fixed by the engine, not by taste: `parse_wav` decodes 8/16-
// bit PCM only, so everything lands as 16-bit 44.1 kHz WAV. Mono for anything
// positional — a stereo source played through playSound3D would carry its own
// baked-in panning and fight the listener's.

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { requireFfmpeg } from './imgutil';

const OUT_DIR = 'assets/sounds';
const VENDOR  = 'vendor/unvanquished';

interface Sfx {
  /// Output filename under assets/sounds/.
  out: string;
  /// Source path. Relative paths resolve under vendor/; absolute-ish ones are
  /// used as given.
  src: string;
  /// Mono for positional sounds (see the note above); stereo for music.
  channels: 1 | 2;
  /// Linear gain applied at convert time. Prefer this over per-play volume for
  /// sounds that are ALWAYS too hot at the source — it keeps the runtime
  /// volumes meaning "how loud is this in the mix", not "how broken is the wav".
  gain?: number;
  /// Trim to this many seconds (long sources with silence at the end).
  seconds?: number;
}

// ---- the manifest -----------------------------------------------------------
// Kinds are 0..4 = dretch, mantis, marauder, dragoon, tyrant, matching
// KIND_NAME in main.ts and the Unvanquished level0..level4 classes.

const SOUNDS: Sfx[] = [];

function add(s: Sfx) { SOUNDS.push(s); }

// Alien vocals — the same GPL asset line as the models.
for (let k = 0; k < 5; k++) {
  for (let v = 1; v <= 3; v++) {
    add({ out: `alien${k}_die${v}.wav`,
          src: `${VENDOR}/pkg/res-legacy_src.dpkdir/sound/player/level${k}/death${v}.flac`,
          channels: 1 });
  }
  add({ out: `alien${k}_pain.wav`,
        src: `${VENDOR}/pkg/res-legacy_src.dpkdir/sound/player/level${k}/pain50_1.flac`,
        channels: 1 });
}
// Attacks come from different places per class (grab vs muzzle flash) — this
// asymmetry is precisely the sort of thing that was living only in a shell
// history.
add({ out: 'alien0_attack.wav', src: `${VENDOR}/pkg/res-legacy_src.dpkdir/models/weapons/level0/flash0.flac`, channels: 1 });
add({ out: 'alien1_attack.wav', src: `${VENDOR}/pkg/res-legacy_src.dpkdir/sound/player/level1/grab.flac`,     channels: 1 });
for (let k = 2; k <= 4; k++) {
  add({ out: `alien${k}_attack.wav`,
        src: `${VENDOR}/pkg/res-legacy_src.dpkdir/models/weapons/level${k}/flash0.flac`,
        channels: 1 });
}

add({ out: 'impact_flesh.wav', src: `${VENDOR}/pkg/res-legacy_src.dpkdir/models/weapons/level2/impactflesh0.flac`, channels: 1 });
add({ out: 'ricochet1.wav',    src: `${VENDOR}/pkg/res-legacy_src.dpkdir/models/weapons/rifle/ricochet0.flac`,     channels: 1 });
add({ out: 'ricochet2.wav',    src: `${VENDOR}/pkg/res-legacy_src.dpkdir/models/weapons/rifle/ricochet1.flac`,     channels: 1 });

// ---- run --------------------------------------------------------------------

const force = process.argv.includes('--force');
const list  = process.argv.includes('--list');

mkdirSync(OUT_DIR, { recursive: true });

let done = 0, skipped = 0, missing = 0;
const missingSrcs: string[] = [];

for (const s of SOUNDS) {
  const out = `${OUT_DIR}/${s.out}`;
  if (existsSync(out) && !force) { skipped++; continue; }
  if (!existsSync(s.src)) {
    missing++;
    missingSrcs.push(`${s.out}  <-  ${s.src}`);
    continue;
  }
  if (list) continue;

  requireFfmpeg();
  const filters: string[] = [];
  if (s.gain !== undefined && s.gain !== 1) filters.push(`volume=${s.gain}`);
  const fArg = filters.length > 0 ? `-af "${filters.join(',')}"` : '';
  const tArg = s.seconds !== undefined ? `-t ${s.seconds}` : '';
  execSync(
    `ffmpeg -y -loglevel error -i "${s.src}" ${tArg} ` +
    `-ac ${s.channels} -ar 44100 -sample_fmt s16 ${fArg} "${out}"`,
    { stdio: 'inherit' });
  console.log(`wrote ${out}`);
  done++;
}

console.log(`\n${done} converted, ${skipped} already present, ${missing} missing source.`);

if (missing > 0) {
  console.log(
    `\n${missing} source file(s) are not on disk. This is expected on a fresh\n` +
    `clone: the Unvanquished sources are a submodule and are NOT vendored here.\n` +
    `The committed .wav files in assets/sounds/ are the shipped result — you only\n` +
    `need these sources to RE-cut them.\n\n` +
    `  git clone --recurse-submodules \\\n` +
    `      https://github.com/UnvanquishedAssets/UnvanquishedAssets ${VENDOR}\n`);
  if (list) for (const m of missingSrcs) console.log('  ' + m);
}
