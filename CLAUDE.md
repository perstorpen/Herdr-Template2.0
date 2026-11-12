# CLAUDE.md – working on Herdr-Template2.0

This repository is the template itself, public on GitHub (`perstorpen/Herdr-Template2.0`). Anyone may clone and install
it; only its owner pushes. The people who use it are often not programmers: every text they see is plain Swedish.

## Rules

1. **Nothing personal goes in.** No names, e-mail addresses, home paths, computer names, chats, token figures, company
   or project names. Commits use the GitHub no-reply address
   (`git -c user.name=perstorpen -c user.email=351072806+perstorpen@users.noreply.github.com commit ...`).
2. **Everything starts empty** for a new user: the To Do List, the counter, the months, Kontroll.
3. **Never install the template on the owner's own computer.** It has its own setup with the same
   buttons and status line, so a second set would double them. Test in a throwaway HOME or a separate WSL distribution
   (`wsl --install -d Ubuntu --name Malltest`).
4. Each part keeps its tests green: `./test.sh` before every push.
5. What a user types or sees is described in three places that must agree: `hooks/info.js` (the `info` command),
   `README.md` and, for installing, `lib/claude-install.md`. A new command or button is added to all three, and
   `hooks/agent.js` learns to leave it alone if a hook answers it.

## Releasing a new version

Users get a notice in their status line within six hours of a push and take it with the command `uppdatera`, which
shows them the CHANGELOG sections that are new to them. So for every change people should get:

1. Make the change and run `./test.sh`.
2. Raise `version.txt` (semver: `2.0.1` a fix, `2.1.0` something new, `3.0.0` something that works differently).
3. Add a section at the top of `CHANGELOG.md`: `## <version> – <date>`, then short Swedish lines on what the user
   will notice. No technical words.
4. Commit and push to `main`. That is the release.

## Where things are

| Part | Files |
|---|---|
| Installing | `install.sh`, `lib/claude-install.md` (what Claude follows), `lib/merge-settings.js`, `config/settings.template.json` |
| The tabs | `start.sh` |
| To Do List and `to do` | `todo/todo.js` |
| Kontroll and `kontroll genomgång` | `kontroll/kontroll.js` |
| Status line, counter, update notice | `statusline/statusline.js` |
| Buttons under the prompt | `mod/` (a Claude Code mod; tests with `claude plugin test mod`) |
| `info`, `uppdatera`, `pause`, `agent`, `time` | `hooks/` |
| herdr's look | `config/herdr-config.toml` |
