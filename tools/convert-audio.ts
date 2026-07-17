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
  /// SH-052b — seconds INTO the source to start the cut. For long field
  /// recordings where the usable stretch is not at the head (pick it with
  /// analysis, not ears — see the ticket for the RMS/brightness window scan).
  startAt?: number;
  /// SH-052b — make the cut a seamless LOOP: ffmpeg cuts `seconds + loopFade`,
  /// then the extra tail is cross-faded over the head sample-by-sample and the
  /// file is truncated to `seconds`. Requires `seconds`. This is the same
  /// tail-over-head construction gen-sfx.ts uses for its synthesised loops.
  loopFade?: number;
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

// ---- Sonniss GDC 2024 (royalty-free game use; see assets/sounds/SOURCES.md) --
// Not a submodule: extract the needed packs from the bundle zip into
// vendor/sonniss/ (gitignored). The committed .wav IS the shipped result; the
// row exists so the cut is reproducible, not because the source is required.
//
// SH-052b — the river is a REAL creek now (the synthesised stand-in read as
// fake — sine-chirp "babble" is the tell). Source: Bolt's "Immersive Creek"
// pack, babbling brook, XY stereo pair. The 33.5 s window at 49 s was chosen
// by scanning every candidate window for minimum RMS + brightness variance
// (level-constant, no bird calls, no handling): best score 0.144. Gain 2.32
// lands the window peak at ~0.6, where the old stand-in sat.
add({ out: 'river_loop.wav',
      src: 'vendor/sonniss/Bolt - Immersive Creek -  Ambisonic Recordings of Undisturbed Creeks in Vermont/' +
           'WATRFlow_Babbling Brook, Snow Melt, Calm, Constant, Bubbling_BOLT_Immersive Creek_RODE NTSF1 XY.wav',
      channels: 1, gain: 2.32, startAt: 49.0, seconds: 32.0, loopFade: 1.5 });

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
  const fade = s.loopFade !== undefined && s.seconds !== undefined ? s.loopFade : 0;
  const cut = s.seconds !== undefined ? s.seconds + fade : undefined;
  const tArg = cut !== undefined ? `-t ${cut}` : '';
  const ssArg = s.startAt !== undefined ? `-ss ${s.startAt}` : '';
  execSync(
    `ffmpeg -y -loglevel error ${ssArg} -i "${s.src}" ${tArg} ` +
    `-ac ${s.channels} -ar 44100 -sample_fmt s16 ${fArg} "${out}"`,
    { stdio: 'inherit' });
  if (fade > 0) loopify(out, s.seconds!, fade, s.channels);
  console.log(`wrote ${out}`);
  done++;
}

/// SH-052b — turn a `body + fade` cut into a seamless `body` loop: the extra
/// tail is cross-faded over the head (equal-power, so broadband material keeps
/// constant energy through the seam), then the file is truncated. Operates on
/// the 16-bit output in place — sample counts, not seconds, so it is exact.
function loopify(path: string, bodySec: number, fadeSec: number, channels: number): void {
  const buf = require('fs').readFileSync(path);
  // Find the 'data' chunk — ffmpeg loves to slip a LIST (encoder metadata)
  // chunk in before it, so a hardcoded offset 44 corrupts the file.
  let off = 12;                             // past RIFF + size + WAVE
  let dataOff = -1;
  let dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') { dataOff = off + 8; dataLen = size; break; }
    off += 8 + size + (size & 1);           // chunks are word-aligned
  }
  if (dataOff < 0) {
    console.warn(`  loopify(${path}): no data chunk found — left as-is`);
    return;
  }
  const n = dataLen >> 1;                   // total s16 samples
  const bodyN = Math.floor(bodySec * 44100) * channels;
  const fadeN = Math.min(Math.floor(fadeSec * 44100) * channels, n - bodyN);
  if (fadeN <= 0 || bodyN + fadeN > n) {
    console.warn(`  loopify(${path}): cut too short for the fade — left as-is`);
    return;
  }
  for (let i = 0; i < fadeN; i++) {
    const t = i / fadeN;
    // Equal-power: uncorrelated noise-like signals sum to constant energy.
    const wIn = Math.sin(t * Math.PI / 2);
    const wOut = Math.cos(t * Math.PI / 2);
    const head = buf.readInt16LE(dataOff + i * 2);
    const tail = buf.readInt16LE(dataOff + (bodyN + i) * 2);
    let v = Math.round(head * wIn + tail * wOut);
    if (v > 32767) v = 32767;
    if (v < -32768) v = -32768;
    buf.writeInt16LE(v, dataOff + i * 2);
  }
  // Truncate to the body and patch the RIFF sizes.
  const outBytes = dataOff + bodyN * 2;
  buf.writeUInt32LE(outBytes - 8, 4);       // RIFF chunk size
  buf.writeUInt32LE(bodyN * 2, dataOff - 4); // data chunk size
  require('fs').writeFileSync(path, buf.subarray(0, outBytes));
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
