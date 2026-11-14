#!/usr/bin/env bash
# One image via Codex CLI image generation (ChatGPT subscription).
# Usage: tools/gen/codex_image.sh <out.png> <WxH> <prompt-file> [ref-image ...]
# The instruction goes in on stdin: `-i` is variadic and would swallow a positional prompt.
# Hard 10-minute limit per image.
set -uo pipefail
cd "$(dirname "$0")/../.."
out=$1 size=$2 prompt=$3; shift 3
refs=(); for r in "$@"; do refs+=(-i "$r"); done
note=""; [ $# -gt 0 ] && note=" Use the attached images as style and character references only."
printf 'Use your built-in image generation tool to generate exactly ONE image (%s) using the prompt in the file %s verbatim.%s Save it as %s (copy it from wherever the tool stores it). Do not create or modify any other files. Reply only with the saved path.\n' \
  "$size" "$prompt" "$note" "$out" |
  perl -e 'alarm 600; exec @ARGV' codex exec --ephemeral -s workspace-write -C "$PWD" ${refs[@]+"${refs[@]}"} >/dev/null 2>&1
[ -f "$out" ] && echo "ok $out" || { echo "FAILED $out"; exit 1; }
