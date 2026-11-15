#!/bin/zsh
# Rebuild the three forest trees, the far tree-line card and the three scanned plant cards from
# their Poly Haven sources (CC0). The exact recipe; about ten minutes, most of it Blender.
#
#   tools/gen/build_trees.sh            everything
#   tools/gen/build_trees.sh trees      only the trees and the far card
#   tools/gen/build_trees.sh plants     only the plant cards
#
# After the trees: copy the three "CANOPY" lines into CANOPY_* in src/camera.ts and the
# "TRUNK r" numbers into TREE_TRUNK_R in src/main.ts, and run tools/gen/compress_assets.sh
# prop_tree prop_tree2 prop_tree3 (release bundles ship the compressed copies).
set -e
ROOT=${0:A:h:h:h}
cd $ROOT
P=tools/.cache/polyhaven
W=tools/.cache/tree_work
what=${1:-all}
python3 tools/gen/fetch_polyhaven.py tree_small_02 island_tree_02 --trunk-4k
python3 tools/gen/fetch_polyhaven.py grass_medium_01 shrub_03
tree() { blender -b -P tools/blender/tree_from_scan.py -- "$@" --work $W 2>&1 | grep -E '^(LEAN|TREE|CANOPY|TRUNK|Traceback|  File|[A-Za-z]*Error)' }
card() { blender -b -P tools/blender/plant_card.py -- "$@" 2>&1 | grep -E '^(CARD|COVERAGE|Traceback|  File|[A-Za-z]*Error)' }
if [[ $what == all || $what == trees ]]; then
  # An upright broadleaf, a low many-stemmed tree, and the broadleaf again, taller.
  tree $P/tree_small_02/tree_small_02_2k.gltf assets/models/prop_tree.glb --scale 1.9 --tile 0.30 --card 0.48 \
       --cards 720 --across 0.35 --under 0.35 --trunk-tris 6000 --branch-tris 3600 --wood 0.62 --sink 0.03
  tree $P/island_tree_02/island_tree_02_2k.gltf assets/models/prop_tree2.glb --scale 1.9 --tile 0.40 --card 0.48 \
       --cards 720 --across 0.35 --under 0.35 --trunk-tris 7000 --branch-tris 3000 --sink 0.24 --wood 0.40 --wood-tint 1.0,0.86,0.70
  tree $P/tree_small_02/tree_small_02_2k.gltf assets/models/prop_tree3.glb --scale 2.25 --tile 0.30 --card 0.48 \
       --cards 780 --across 0.35 --under 0.35 --seed 7 --trunk-tris 6000 --branch-tris 3600 --wood 0.62 --sink 0.03
  blender -b -P tools/blender/tree_impostor.py -- assets/models/prop_tree.glb assets/textures/flora_tree.png 2>&1 | grep -E 'TREE|Error'
fi
if [[ $what == all || $what == plants ]]; then
  GA=$P/grass_medium_01/textures/grass_medium_01_alpha_2k.png
  card $P/grass_medium_01/grass_medium_01_2k.gltf assets/textures/flora_grass.png \
       --pick large_a,mid_a,large_c,large_b --gap -0.07 --alpha $GA
  card $P/grass_medium_01/grass_medium_01_2k.gltf assets/textures/flora_tallgrass.png \
       --pick tall_a,mid_c,tall_c,tall_b,mid_b --gap -0.06 --alpha $GA
  card $P/shrub_03/shrub_03_2k.gltf assets/textures/flora_herb.png \
       --pick shrub_03_a,shrub_03_b --gap -0.02 --alpha $P/shrub_03/textures/shrub_03_alpha_2k.png
fi
