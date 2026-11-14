#!/bin/zsh
# Write <model>.astc.glb next to every game model: the same GLB with its textures as ASTC
# blocks (KTX2) and the engine's mip chains, which the GPU keeps compressed (a quarter of the
# memory at 4x4). The game loads these when present; Blender and the test tools keep using the
# plain .glb. Generated and git-ignored. Re-run after any model changes.
#
#   tools/gen/compress_assets.sh                  every model under assets/models
#   tools/gen/compress_assets.sh enemy_ravager    named models only
#   ASTC=6x6 tools/gen/compress_assets.sh         smaller blocks for colour and data
set -e
ROOT=${0:A:h:h:h}
COOK=$ROOT/../engine/tools/bloom-cook
[[ -x $COOK/target/release/bloom-cook ]] || (cd $COOK && cargo build --release)
cd $ROOT/assets/models
names=("$@")
[[ ${#names} -eq 0 ]] && names=(*.glb(N:r))
for n in $names; do
  [[ $n == *.astc ]] && continue
  src=$n.glb
  [[ -f $src ]] || continue
  out=$n.astc.glb
  if [[ $out -nt $src && -z $FORCE ]]; then continue; fi
  $COOK/target/release/bloom-cook glb-compress $src $out --astc ${ASTC:-4x4} --normal-astc ${NORMAL_ASTC:-4x4}
done
