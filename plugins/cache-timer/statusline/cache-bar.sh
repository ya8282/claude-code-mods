#!/usr/bin/env bash
# Prints a colored prompt-cache countdown for a Claude Code status line, or nothing before the
# first response. Reads the status line's JSON on stdin; needs jq.
#
#   cache ███████░░░░░ 35m
#
# TTL: the one the API actually applied to the newest main-thread cache write in the transcript.
# Override with CACHE_TIMER_TTL=5m|1h. Unknown falls back to CLAUDE_CODE_PROMPT_CACHE_TTL, then 1h.

transcript=$(jq -r '.transcript_path // empty')
[ -f "$transcript" ] || exit 0

# The tail only: a cut-off first line is skipped by fromjson?.
read -r at tier < <(tail -c 2000000 "$transcript" | jq -rRs '
  split("\n") | map(fromjson? | select(.type == "assistant" and (.isSidechain | not)))
  | select(length > 0)
  | [ (last.timestamp | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601),
      (map(.message.usage.cache_creation // {}
           | if (.ephemeral_5m_input_tokens // 0) > 0 then "5m"
             elif (.ephemeral_1h_input_tokens // 0) > 0 then "1h" else empty end)
       | last // "-") ]
  | @tsv')
[ -n "$at" ] || exit 0

case "${CACHE_TIMER_TTL:-auto}" in 5m|1h) tier=$CACHE_TIMER_TTL ;; esac
[ "$tier" = "-" ] && tier=${CLAUDE_CODE_PROMPT_CACHE_TTL:-1h}
[ "$tier" = "5m" ] && ttl=300 || ttl=3600

left=$(( ttl - ($(date +%s) - at) ))
width=12
if [ "$left" -le 0 ]; then
    filled=0; color=31; label=cold
else
    filled=$(( (left * width + ttl / 2) / ttl )); [ "$filled" -lt 1 ] && filled=1
    pct=$(( left * 100 / ttl ))
    if [ "$pct" -ge 50 ]; then color=32; elif [ "$pct" -ge 20 ]; then color=33; else color=31; fi
    if [ "$left" -ge 120 ]; then label="$(( (left + 59) / 60 ))m"; else label=$(printf '%d:%02d' $((left / 60)) $((left % 60))); fi
fi
full=$(printf '%*s' "$filled" '' | sed 's/ /█/g')
empty=$(printf '%*s' $((width - filled)) '' | sed 's/ /░/g')
printf '\033[2mcache\033[0m \033[%sm%s\033[0;2m%s\033[0m \033[1;%sm%s\033[0m' "$color" "$full" "$empty" "$color" "$label"
