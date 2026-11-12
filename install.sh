#!/usr/bin/env bash
# Installs Herdr-Template2.0 on this computer (Ubuntu, also in WSL on Windows):
#   Node, Claude Code and herdr when they are missing, the template's settings for Claude Code (status line, hooks,
#   buttons), herdr's look, the command `herdr-template`, and on Windows the Nerd Font for the icons.
# Safe to run again. A file it replaces is first kept in ~/.herdr-template-backups/<time>/.
#
#   ./install.sh               everything
#   ./install.sh --no-windows  skip the font and Windows Terminal
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_VERSION=26.13.0
FONT_VERSION=v3.5.1
FONT_FACE='CaskaydiaMono NF'
FONT_PREFIX=CaskaydiaMonoNerdFont-
BACKUP_DIR="$HOME/.herdr-template-backups/$(date +%Y%m%d-%H%M%S)"
DATA_DIR="$HOME/.claude/herdr-template"
WANT_WINDOWS=1
[ "${1:-}" = "--no-windows" ] && WANT_WINDOWS=0

export PATH="$HOME/.local/bin:$PATH"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nFEL: %s\n' "$*" >&2; exit 1; }

# Copies a file into place. A different file already there is kept under BACKUP_DIR first.
place() {
  local source="$1" target="$2"
  if [ -e "$target" ]; then
    cmp -s "$source" "$target" && return 0
    mkdir -p "$BACKUP_DIR"
    cp -p "$target" "$BACKUP_DIR/$(printf '%s' "$target" | sed 's#^/##; s#/#__#g')"
    echo "   Ersatt, den gamla finns i $BACKUP_DIR: $target"
  else
    echo "   Ny fil: $target"
  fi
  mkdir -p "$(dirname "$target")"
  cp "$source" "$target"
}

check_system() {
  [ "$(uname -s)" = Linux ] || fail "Mallen körs i Ubuntu (Linux). På Windows: installera WSL Ubuntu först, se README."
  local missing=() pair
  for pair in curl:curl git:git python3:python3 xz:xz-utils; do
    command -v "${pair%%:*}" >/dev/null 2>&1 || missing+=("${pair##*:}")
  done
  # Node needs these libraries, and a fresh Ubuntu (24.04 in WSL, for one) comes without libatomic.
  # ldconfig is in /sbin, which is not on every PATH.
  local ldconfig
  ldconfig="$(command -v ldconfig || echo /sbin/ldconfig)"
  for pair in libatomic.so.1:libatomic1 libstdc++.so.6:libstdc++6; do
    "$ldconfig" -p 2>/dev/null | grep -q "${pair%%:*}" || missing+=("${pair##*:}")
  done
  [ "${#missing[@]}" -eq 0 ] && return 0
  local line="sudo apt update && sudo apt install -y ${missing[*]}"
  # Run by Claude (or anything else without a terminal), sudo can't ask for the password.
  if ! sudo -n true 2>/dev/null && [ ! -t 0 ]; then
    fail "Det här behöver ditt lösenord, så du kör det själv i Ubuntu och sedan installationen igen:
   $line"
  fi
  say "Installerar ${missing[*]} (frågar efter ditt Ubuntu-lösenord)"
  sudo apt-get update
  sudo apt-get install -y "${missing[@]}"
}

add_local_bin_to_path() {
  grep -qs '\.local/bin' "$HOME/.bashrc" && return 0
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
}

# Node 22 or later has what the template needs. One that is already there is used.
# A node that is there but can't start (a library missing) counts as missing.
node_ok() {
  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" || return 1
  [ -n "$major" ] && [ "$major" -ge 22 ]
}

install_node() {
  node_ok && return 0
  say "Installerar Node $NODE_VERSION i ~/.local"
  local name="node-v$NODE_VERSION-linux-x64" base="https://nodejs.org/dist/v$NODE_VERSION"
  [ "$(uname -m)" = aarch64 ] && name="node-v$NODE_VERSION-linux-arm64"
  curl -fsSL "$base/$name.tar.xz" -o "$WORK/$name.tar.xz"
  curl -fsSL "$base/SHASUMS256.txt" -o "$WORK/SHASUMS256.txt"
  (cd "$WORK" && grep " $name.tar.xz\$" SHASUMS256.txt | sha256sum -c --quiet -)
  mkdir -p "$HOME/.local/opt" "$HOME/.local/bin"
  tar -xJf "$WORK/$name.tar.xz" -C "$HOME/.local/opt"
  local tool
  for tool in node npm npx; do ln -sfn "$HOME/.local/opt/$name/bin/$tool" "$HOME/.local/bin/$tool"; done
  hash -r
  node_ok || fail "Node gick inte att installera."
}

install_claude() {
  command -v claude >/dev/null 2>&1 && return 0
  say "Installerar Claude Code"
  curl -fsSL https://claude.ai/install.sh | bash
}

install_herdr() {
  command -v herdr >/dev/null 2>&1 && return 0
  say "Installerar herdr"
  curl -fsSL https://herdr.dev/install.sh | sh
}

# herdr writes its own hook into Claude's settings, so it knows which chats work and which wait.
connect_herdr_to_claude() {
  herdr integration status 2>/dev/null | grep -q '^claude: current' && return 0
  say "Kopplar ihop herdr och Claude Code"
  herdr integration install claude
}

apply_settings() {
  say "Lägger in mallens inställningar för Claude Code och herdr"
  local node merged
  node="$(command -v node)"
  merged="$WORK/settings.json"
  node "$REPO/lib/merge-settings.js" "$REPO/config/settings.template.json" "$HOME/.claude/settings.json" "$REPO" "$node" > "$merged"
  place "$merged" "$HOME/.claude/settings.json"
  place "$REPO/config/herdr-config.toml" "$HOME/.config/herdr/config.toml"
  mkdir -p "$DATA_DIR" "$HOME/.local/bin"
  ln -sfn "$REPO/start.sh" "$HOME/.local/bin/herdr-template"
  chmod +x "$REPO/start.sh"
}

run_powershell() {
  (cd /mnt/c && powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$@")
}

install_font() {
  local fonts="$1/AppData/Local/Microsoft/Windows/Fonts"
  if ! ls "$fonts/${FONT_PREFIX}"*.ttf >/dev/null 2>&1; then
    say "Installerar teckensnittet $FONT_FACE"
    curl -fsSL "https://github.com/ryanoasis/nerd-fonts/releases/download/$FONT_VERSION/CascadiaMono.zip" -o "$WORK/font.zip"
    mkdir -p "$fonts"
    python3 -I - "$WORK/font.zip" "$fonts" "$FONT_PREFIX" <<'PY'
import os, sys, zipfile
archive, target, prefix = sys.argv[1:]
with zipfile.ZipFile(archive) as z:
    for name in z.namelist():
        base = os.path.basename(name)
        if base.startswith(prefix) and base.endswith('.ttf'):
            with open(os.path.join(target, base), 'wb') as out:
                out.write(z.read(name))
PY
  fi
  # "-Command -" reads stdin line by line and skips statements over several lines, so the script is read whole.
  run_powershell 'Invoke-Expression ([Console]::In.ReadToEnd())' < "$REPO/lib/register-fonts.ps1"
}

set_terminal_font() {
  local home="$1" found=0 file changed
  for file in \
    "$home"/AppData/Local/Packages/Microsoft.WindowsTerminal*/LocalState/settings.json \
    "$home/AppData/Local/Microsoft/Windows Terminal/settings.json"; do
    [ -f "$file" ] || continue
    found=1
    changed="$WORK/terminal.json"
    node "$REPO/lib/set-terminal-font.js" "$file" "$FONT_FACE" > "$changed"
    if [ -s "$changed" ]; then place "$changed" "$file"; fi
  done
  [ "$found" -eq 1 ] || echo "   Hittade inga inställningar för Windows Terminal. Välj $FONT_FACE i profilen Ubuntu själv."
}

setup_windows() {
  if ! command -v powershell.exe >/dev/null 2>&1; then
    echo "   Inte Windows (eller WSL utan Windows), så teckensnittet hoppas över. Se README om ikonerna ser fel ut."
    return 0
  fi
  local home
  home="$(wslpath -u "$(run_powershell '$env:USERPROFILE' | tr -d '\r')")"
  say "Ställer in teckensnittet för ikonerna i Windows Terminal"
  install_font "$home" || echo "   Teckensnittet gick inte att installera. Se README, avsnittet om ikoner."
  set_terminal_font "$home"
}

check_system
add_local_bin_to_path
install_node
install_claude
install_herdr
apply_settings
connect_herdr_to_claude
[ "$WANT_WINDOWS" -eq 1 ] && setup_windows

say "Klart!"
cat <<EOF
   1. Stäng terminalen och öppna den igen, så att teckensnittet och kommandona börjar gälla.
   2. Starta mallen på en mapp:   herdr-template ~/mitt-projekt
   3. Första gången loggar du in på ditt Claude-konto i en av chattarna, och svarar ja på frågan om du litar på mappen.
   Skriv info i en chatt för att se alla kommandon.
EOF
