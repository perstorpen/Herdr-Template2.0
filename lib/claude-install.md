# Herdr-Template2.0: instructions for Claude

The README sends people here with one sentence: install, update or remove the template. Do what they asked.
Installing and updating are the same steps below (an update is a pull and the install run again).

A person asked you to do it for them. They may not be used to terminals: talk to them in their own
language (Swedish if they wrote Swedish), in short plain sentences, and tell them what you are doing as you go.

1. Check where you are: `uname -s` must say `Linux`. In WSL, `echo $WSL_DISTRO_NAME` says which Ubuntu. If the person
   seems to have several, say which one you are installing in.
2. Get the template:
   - If `~/Herdr-Template2.0` is missing: `git clone https://github.com/perstorpen/Herdr-Template2.0.git ~/Herdr-Template2.0`
   - If it is there: `git -C ~/Herdr-Template2.0 pull`
   - "Could not resolve host" means WSL has no network for the moment. Ask the person to run `wsl --shutdown` in
     PowerShell, open Ubuntu again, start `claude` and ask you again. Do not try to fix DNS files yourself.
3. Run `~/Herdr-Template2.0/install.sh` and read its output.
   - It needs `sudo` only when a system package is missing, and you cannot type a password. If it stops there, give the
     person this one line to run in Ubuntu themselves, then run `install.sh` again:
     `sudo apt update && sudo apt install -y git curl xz-utils python3 libatomic1`
   - Any other `FEL:` line: tell the person what failed in one sentence, fix it if it is clearly in your reach, and run
     `install.sh` again (it is safe to run again). Never edit files in `~/Herdr-Template2.0`.
4. When it says `Klart!`, check: `ls -l ~/.local/bin/herdr-template` exists, and `~/.claude/settings.json` mentions
   `Herdr-Template2.0`.
5. Tell the person, step by step (this is step 5 in the README):
   - Close this window and open Ubuntu again (the new font and command start working then). On Windows, close
     Windows Terminal entirely.
   - Then type `herdr-template ~/mitt-projekt` (any folder name works; it is made if missing).
   - In the first chat, answer yes when Claude asks if they trust the folder.
   - Type `info` in a chat to see every command.
   - Later versions: the status line says when there is one, and typing `uppdatera` in a chat takes it.
   Do not start herdr yourself: it is a full-screen program and must run in their own window.

## Removing the template

When the person asks to remove it, say first what will go and ask once whether the list and the counter should go too.
1. In `~/.claude/settings.json`, remove every hook, the `statusLine` and the `CLAUDE_CODE_PLUGIN_DIRS` folder that point
   into `~/Herdr-Template2.0` (keep everything else; keep a copy of the file first in `~/.herdr-template-backups/`).
2. `rm -f ~/.local/bin/herdr-template` and `rm -rf ~/Herdr-Template2.0`.
3. Only if they said yes: `rm -rf ~/.claude/herdr-template` (the list, the counter, the months, the pause setting).
Claude Code, herdr and Node stay. Tell them to close and open Ubuntu again.
