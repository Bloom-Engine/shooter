#!/bin/bash
# Move the one Tripo Studio download of a static model (weapon, prop) from ~/Downloads into
# art/source/<name>_studio/<name>_hd.glb.   tools/gen/collect_static.sh <name>
set -euo pipefail
cd "$(dirname "$0")/../.."
name=$1; d=art/source/${name}_studio; mkdir -p "$d"
shopt -s nullglob
f=(~/Downloads/*.glb)
[[ ${#f[@]} -eq 1 ]] || { echo "expected exactly one .glb in ~/Downloads, found ${#f[@]}:"; ls -la "${f[@]}" 2>/dev/null; exit 1; }
mv "${f[0]}" "$d/${name}_hd.glb"
ls -la "$d"
