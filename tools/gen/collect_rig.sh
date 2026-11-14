#!/bin/bash
# File a re-export of a rigged character (new clips added in Tripo Studio) as the next
# art/source/<name>_studio/<name>_studio-N.glb, and point <name>_studio-1.glb's successor at it.
#   tools/gen/collect_rig.sh <name>      (expects exactly one ~/Downloads/tripo_convert_*.glb)
set -euo pipefail
cd "$(dirname "$0")/../.."
name=$1; d=art/source/${name}_studio
shopt -s nullglob
f=(~/Downloads/tripo_convert_*.glb)
[[ ${#f[@]} -eq 1 ]] || { echo "expected exactly one tripo_convert_*.glb in ~/Downloads, found ${#f[@]}"; exit 1; }
n=1; while [[ -e $d/${name}_studio-$n.glb ]]; do n=$((n + 1)); done
mv "${f[0]}" "$d/${name}_studio-$n.glb"
echo "$d/${name}_studio-$n.glb"
