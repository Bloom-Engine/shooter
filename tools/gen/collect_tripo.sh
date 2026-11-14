#!/bin/bash
# Move the two Tripo Studio downloads of one model from ~/Downloads into art/source/<name>_studio/.
#   tools/gen/collect_tripo.sh <name>
# tripo_convert_*.glb (rigged export) -> <name>_studio-1.glb ; *_Clone1.glb (original mesh) -> <name>_hd.glb
set -euo pipefail
cd "$(dirname "$0")/../.."
name=$1; d=art/source/${name}_studio; mkdir -p "$d"
shopt -s nullglob
rig=(~/Downloads/tripo_convert_*.glb); hd=(~/Downloads/*_Clone*.glb)
[[ ${#rig[@]} -le 1 && ${#hd[@]} -le 1 ]] || { echo "more than one candidate in ~/Downloads:"; ls -la "${rig[@]}" "${hd[@]}"; exit 1; }
[[ ${#rig[@]} -eq 1 ]] && mv "${rig[0]}" "$d/${name}_studio-1.glb"
[[ ${#hd[@]} -eq 1 ]] && mv "${hd[0]}" "$d/${name}_hd.glb"
ls -la "$d"
