#!/usr/bin/env bash
# Runs every test in the template. None of them touches your own list, counter or settings.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
export PATH="$HOME/.local/bin:$PATH"
status=0
node --test lib/ hooks/ todo/ statusline/ || status=1
if command -v claude >/dev/null 2>&1; then
  claude plugin validate mod >/dev/null || { echo 'The mod in mod/ does not validate: claude plugin validate mod'; status=1; }
  claude plugin test mod || status=1
else
  echo 'Claude Code is not installed, so the tests of the buttons (mod/) were skipped.'
fi
bash -n install.sh && bash -n start.sh || status=1
exit $status
