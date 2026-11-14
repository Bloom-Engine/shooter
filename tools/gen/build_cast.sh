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
# Trooper clips (src/main.ts): 0 crouch_idle  1 crouch_walk  2 death_back  3 death_front  4 hit_back
#   5 hit_front  6 idle  7 roll  8 run  9 sprint  10 strafe_left  11 strafe_right  12 walk
#   13 walk_back.  jump, swap and reload were generated too and are left out: the jump barely
#   leaves the ground, nothing plays the swap yet, and the reload is done with the off hand's IK
#   in src/main.ts (the clip waved the hand at the helmet).
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
  # The first five Text2Motion clips are kept only where nothing replaced them (run); the rest
  # of the set is the second batch (art/source/trooper_clips.md has the prompts).
  tools/gen/make_character.sh player_trooper 1.85 --tag-weapon --grip \
    --rename "sneaks forward=old_crouch_walk,walks forward=old_walk,stands still=old_idle,stays crouched=old_crouch_idle,sprints forward=run,Sidesteps to the left=strafe_left,Sidesteps to the right=strafe_right,Steps backward=walk_back,Marches forward=walk,Stands guard=idle,Dashes forward=sprint,Crouches low=crouch_idle,Creeps forward=crouch_walk,Leaps straight=jump,Dives forward=roll,Swaps the rifle=reload,Slings the rifle=swap,Flinches from=hit_front,Stumbles from=hit_back,Shot in the chest=death_back,Shot from behind=death_front" \
    --loop "run,walk,walk_back,strafe_left,strafe_right,sprint,crouch_walk" \
    --active "roll,hit_front,hit_back" --trim "death_back=0.3:3.2,death_front=0.3:3.2" \
    --drop-clips "old_crouch_walk,old_walk,old_idle,old_crouch_idle,jump,swap,reload"
fi
