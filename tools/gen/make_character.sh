#!/bin/bash
# Turn a Tripo Studio character export into the game model, with a normal map baked from the
# 1.9M-triangle original.
#
#   tools/gen/make_character.sh <name> <height-m> [studio_import.py options...]
#   e.g. tools/gen/make_character.sh enemy_ravager 1.9 --rename "Hit=death" --drop-clips run_upstairs
#
# Reads   art/source/<name>_studio/<name>_studio-N.glb   rigged + animated export (4k, in place; highest N)
#         art/source/<name>_studio/<name>_hd.glb         original mesh (History -> oldest -> Save as New Model)
# Writes  assets/models/<name>.glb
#
# The bake runs against an UNROTATED import: bake_normals.py fits the original to the game mesh by
# bounding box, and the game mesh is turned 90 degrees to face glTF +X (the shooter's convention).
# A tangent-space map does not care about that turn, so it is injected into the rotated model.
set -euo pipefail
cd "$(dirname "$0")/../.."
name=$1 height=$2; shift 2
# the newest export: Studio re-exports with added clips are filed as _studio-2, -3, ... (collect_rig.sh)
src=$(ls art/source/${name}_studio/${name}_studio-*.glb | sort -t- -k2 -n | tail -1)
hd=art/source/${name}_studio/${name}_hd.glb
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
q() { grep -E "STUDIO|BAKE fit|Error|Traceback" || true; }
blender -b -P tools/blender/studio_import.py -- "$src" "$tmp/game.glb" --height "$height" --deg 90 --tex 4096 "$@" 2>&1 | q
if [[ -f $hd ]]; then
  blender -b -P tools/blender/studio_import.py -- "$src" "$tmp/unrot.glb" --height "$height" --tex 4096 2>&1 | grep -E "Error|Traceback" || true
  blender -b -P tools/blender/bake_normals.py -- "$hd" "$tmp/unrot.glb" "$tmp/n.png" --size 4096 2>&1 | q
  sips -s format jpeg -s formatOptions 95 "$tmp/n.png" --out "$tmp/n.jpg" >/dev/null
  python3 tools/gen/glb_replace_image.py "$tmp/game.glb" "assets/models/$name.glb" normal "$tmp/n.jpg"
else
  echo "no $hd: keeping Tripo's own normal map"
  cp "$tmp/game.glb" "assets/models/$name.glb"
fi
ls -la "assets/models/$name.glb"
