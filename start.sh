#!/usr/bin/env bash
# Opens the template in herdr, on a folder of your choice:
#
#   herdr-template [folder] [session name]
#
# The folder is where the chats work (the current folder when none is given). herdr opens in a session of its own,
# named after the folder unless a name is given, with one space and these tabs, in this order:
#   Main Building · Interface · Questions · Side Quests · To Do List · Kontroll
# The four chats start Claude Code in the folder; To Do List and Kontroll are the lists' own windows. Run it again to open the
# session again: missing tabs are made, and what isn't running is started. Nothing is written in the folder.
set -uo pipefail

repo="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
bin="$HOME/.local/bin"
export PATH="$bin:$PATH"
node="$(command -v node)"
herdr="$(command -v herdr)"

case "${1:-}" in -h|--help) sed -n 2,10p "$0" | sed 's/^# \{0,1\}//'; exit 0 ;; esac
[ -n "$node" ] || { echo "Node saknas. Kör install.sh först." >&2; exit 1; }
[ -n "$herdr" ] || { echo "herdr saknas. Kör install.sh först." >&2; exit 1; }

folder="${1:-$PWD}"
case "$folder" in /*) ;; ~*) folder="${folder/#\~/$HOME}" ;; *) folder="$PWD/$folder" ;; esac
name="${2:-$(basename "$folder")}"
session=$(tr -c 'a-zA-Z0-9_-' '-' <<<"$name" | sed 's/-*$//')
[ -n "$session" ] || session=template

CHATS=("Main Building" "Interface" "Questions" "Side Quests")
# The windows that are not chats, and the program each runs.
declare -A WINDOWS=(["To Do List"]="$repo/todo/todo.js" [Kontroll]="$repo/kontroll/kontroll.js")
ORDER=("${CHATS[@]}" "To Do List" Kontroll)

h() { "$herdr" --session "$session" "$@" 2>/dev/null; }
field() { "$node" -e "$1" "${@:2}" 2>/dev/null; }
tabsJson() { h tab list; }
panesJson() { h pane list; }

# Tab id for a label, or empty.
tabOf() { tabsJson | field "const t=JSON.parse(require('fs').readFileSync(0,'utf8')).result?.tabs??[];process.stdout.write(t.find(x=>x.label===process.argv[1])?.tab_id??'')" "$1"; }
# The pane in a tab: "<pane id> <agent or -> <terminal title>".
paneOf() { panesJson | field "const p=(JSON.parse(require('fs').readFileSync(0,'utf8')).result?.panes??[]).find(x=>x.tab_id===process.argv[1]);if(p)process.stdout.write([p.pane_id,p.agent||'-',p.terminal_title||''].join(' '))" "$1"; }

build() {
  local i
  for i in $(seq 1 60); do panesJson | grep -q '"panes"' && break; sleep 0.5; done
  local first ws count
  first=$(tabsJson | field "const t=JSON.parse(require('fs').readFileSync(0,'utf8')).result?.tabs??[];if(t.length)process.stdout.write(t[0].tab_id+' '+t[0].workspace_id+' '+t.length)")
  [ -n "$first" ] || return
  read -r first ws count <<<"$first"
  # A new session has one bare tab: it becomes the first chat.
  if [ "$count" = 1 ] && [ -z "$(tabOf "${CHATS[0]}")" ]; then h tab rename "$first" "${CHATS[0]}" >/dev/null; fi
  local label
  for label in "${ORDER[@]}"; do
    [ -n "$(tabOf "$label")" ] || h tab create --workspace "$ws" --cwd "$folder" --label "$label" --no-focus >/dev/null
  done
  # Put the tabs in order: a pane moved to a new tab goes last, and a chat keeps running.
  local labels want pane
  labels=$(tabsJson | field "const t=JSON.parse(require('fs').readFileSync(0,'utf8')).result?.tabs??[];process.stdout.write(t.map(x=>x.label).filter(l=>process.argv.slice(1).includes(l)).join('|'))" "${ORDER[@]}")
  want=$(IFS='|'; echo "${ORDER[*]}")
  if [ "$labels" != "$want" ]; then
    for label in "${ORDER[@]}"; do
      read -r pane _ _ <<<"$(paneOf "$(tabOf "$label")")"
      [ -n "${pane:-}" ] && h pane move "$pane" --new-tab --label "$label" --no-focus >/dev/null
    done
  fi
  sleep 3   # herdr resumes the chats it had by itself; give it the time to.
  local tab agent title
  for label in "${ORDER[@]}"; do
    tab=$(tabOf "$label"); [ -n "$tab" ] || continue
    read -r pane agent title <<<"$(paneOf "$tab")"
    [ -n "${pane:-}" ] || continue
    if [ -n "${WINDOWS[$label]:-}" ]; then
      [ "$agent" = - ] && [ "$title" != "$label" ] && h pane run "$pane" "cd '$folder' && exec '$node' '${WINDOWS[$label]}' ui" >/dev/null
    elif [ "$agent" = - ]; then
      h pane run "$pane" "cd '$folder' && claude" >/dev/null
    fi
  done
  h tab focus "$(tabOf "${CHATS[0]}")" >/dev/null
}

mkdir -p "$folder"
cd "$folder" || exit 1
if [ -n "${HERDR_ENV:-}" ] && [ "${HERDR_SOCKET_PATH:-}" = "$HOME/.config/herdr/sessions/$session/herdr.sock" ]; then
  build   # run from inside this very session: only fix the tabs
  exit 0
fi
build &
unset HERDR_ENV HERDR_PANE_ID HERDR_TAB_ID HERDR_WORKSPACE_ID HERDR_SOCKET_PATH
exec "$herdr" --session "$session"
