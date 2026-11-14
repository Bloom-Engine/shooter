#!/bin/bash
# Rebuild every character's game model from its Tripo Studio exports (art/source/<name>_studio/).
# The whole recipe for the cast lives here; see art/source/README.md for where the exports come from.
#
#   tools/gen/build_cast.sh                 all eight
#   tools/gen/build_cast.sh enemy_skitter   named ones only
#
# Creature clips, sorted by name as the game addresses them (src/enemies.ts):
#   0 c_attack  1 c_run  2 death  3 fall  4 hit_to_body_01  5 idle  6 run  7 slash  8 walk
# c_run / c_attack are each creature's own Text2Motion clips; the rest are shared presets and the
# shared death. c_run is cut to its most seamless stride loop; slash and death are trimmed.
# Trooper clips: 0 crouch_idle  1 crouch_walk  2 idle  3 run  4 walk  (src/main.ts).
set -uo pipefail
cd "$(dirname "$0")/../.."
want=("$@")
on() { [[ ${#want[@]} -eq 0 ]] || [[ " ${want[*]} " == *" $1 "* ]]; }
creature() {   # name height "run phrase" "attack phrase" ["phrase of a superseded attack to drop"]
  on "$1" || return 0
  echo "== $1"
  local ren="Hit=death,$3=c_run,$4=c_attack" drop="run_upstairs"
  if [[ -n "${5:-}" ]]; then ren="$ren,$5=old_attack"; drop="$drop,old_attack"; fi
  tools/gen/make_character.sh "$1" "$2" --rename "$ren" \
    --trim "slash=1.0:2.6,death=0.6:3.0" --loop "c_run" --active "c_attack" --drop-clips "$drop"
}
# Skitter and Bruiser: second, more forceful attack takes (their first came out as a guard pose).
creature enemy_skitter  0.8 "scurries forward"              "Furious melee attack"      "lunges forward and attacks"
creature enemy_stalker  1.7 "runs forward in long"          "predator attacks"
creature enemy_ravager  1.9 "charges forward in a heavy"    "predator attacks"
creature enemy_bruiser  2.4 "charges forward like a gorilla" "Heavy overhead hammer blow" "brute attacks"
creature enemy_colossus 3.5 "colossus advances"             "colossus attacks"
creature enemy_spitter  1.9 "runs forward at a loose"       "spits venom"
creature enemy_bombard  2.4 "trudges forward"               "fires a volley"
if on player_trooper; then
  echo "== player_trooper"
  tools/gen/make_character.sh player_trooper 1.85 --tag-weapon \
    --rename "sneaks forward=crouch_walk,walks forward=walk,stands still=idle,stays crouched=crouch_idle,sprints forward=run" \
    --loop "run,walk,crouch_walk"
fi
