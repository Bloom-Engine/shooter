// Dev-only: render procedural textures to PNGs for eyeballing. Not in the build.
import { encodePng, makeTexture,
         grassTexture, stoneTexture, woodTexture, floorTexture, grassBladeTexture, flowerTexture } from './png';
import { writeFileSync } from 'node:fs';

function tile3(name: string, tex: Uint8Array, TILE: number) {
  const REP = 3, W = TILE * REP, H = TILE * REP;
  const tiled = makeTexture(W, H, (x, y) => {
    const sx = x % TILE, sy = y % TILE;
    const o = (sy * TILE + sx) * 4;
    return [tex[o], tex[o + 1], tex[o + 2], 255];
  });
  writeFileSync(`tools/.testout/${name}.png`, encodePng(W, H, tiled));
  console.log('wrote', name, W, 'x', H);
}

// Composite an RGBA cutout over a sky-blue background so the alpha shape shows.
function overBg(name: string, tex: Uint8Array, S: number) {
  const out = makeTexture(S, S, (x, y) => {
    const o = (y * S + x) * 4;
    const a = tex[o + 3] / 255;
    const bg = [120, 150, 190];
    return [
      Math.floor(tex[o] * a + bg[0] * (1 - a)),
      Math.floor(tex[o + 1] * a + bg[1] * (1 - a)),
      Math.floor(tex[o + 2] * a + bg[2] * (1 - a)),
      255,
    ];
  });
  writeFileSync(`tools/.testout/${name}.png`, encodePng(S, S, out));
  console.log('wrote', name, S, 'x', S);
}

tile3('grass_preview', grassTexture(256), 256);
tile3('stone_preview', stoneTexture(512), 512);
overBg('blade_preview', grassBladeTexture(256), 256);
overBg('flower_preview', flowerTexture(256), 256);

// Phase-0: leaf + bark previews (leaf over sky to judge the cutout coverage).
import { leafTexture, barkTexture } from './png';
overBg('leaf_preview', leafTexture(256), 256);
tile3('bark_preview', barkTexture(256), 256);
