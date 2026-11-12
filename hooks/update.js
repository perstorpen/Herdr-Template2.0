#!/usr/bin/env node
'use strict';
// The "uppdatera" command (also "update" and "uppdatera mallen"). A UserPromptSubmit hook that answers at once,
// without going to Claude, so it costs no tokens:
//   1. refuses when files of the template itself have been changed on this computer, so nothing of the person's is lost,
//   2. fetches the new version from GitHub (git pull --ff-only),
//   3. runs install.sh again, which lays the new settings out,
//   4. says which version it went from and to, and what is new (the sections of CHANGELOG.md in between).
// The status line says when a new version is out (statusline.js, checkForUpdate).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// The template's own folder. Tests point it at a repo of their own.
const REPO = process.env.HERDR_TEMPLATE_REPO || path.join(__dirname, '..');
// Together under the hook's timeout in the settings (300 s).
const PULL_TIMEOUT_MS = 90 * 1000;
const INSTALL_TIMEOUT_MS = 180 * 1000;

const isUpdate = prompt => /^\s*(?:uppdatera(?:\s+mallen)?|update)\s*[.!]?\s*$/i.test(prompt);

function git(...args) {
  return spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8', timeout: PULL_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
}

function version() {
  try { return fs.readFileSync(path.join(REPO, 'version.txt'), 'utf8').trim(); } catch { return '?'; }
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

// The sections of the changelog for versions after `from` and up to `to`, newest first, as written.
function changelogSections(text, from, to) {
  const parts = String(text).split(/^(?=## )/m).filter(part => part.startsWith('## '));
  return parts.filter(part => {
    const match = /^##\s+(\d+(?:\.\d+)*)/.exec(part);
    return match && compareVersions(match[1], from) > 0 && compareVersions(match[1], to) <= 0;
  }).map(part => part.trim());
}

function gitProblem(result) {
  const text = `${result.stderr || ''}${result.error ? result.error.message : ''}`;
  if (/could not resolve host|unable to access|network|timed out|ETIMEDOUT/i.test(text) || result.error) {
    return 'Mallen kunde inte nå GitHub, så inget uppdaterades. Kolla att datorn har internet. I WSL tappar Ubuntu ibland '
      + 'nätverket: skriv wsl --shutdown i PowerShell, öppna Ubuntu igen och skriv uppdatera på nytt.';
  }
  if (/not possible to fast-forward|diverg|non-fast-forward/i.test(text)) {
    return 'Mallens mapp här har sparade ändringar som inte finns på GitHub, så den uppdateras inte av sig själv. '
      + 'Be Claude: "Uppdatera Herdr-Template2.0 och behåll det jag ändrat".';
  }
  return `Uppdateringen gick inte att hämta: ${text.trim().split('\n').slice(-2).join(' ') || 'okänt fel'}.`;
}

function update() {
  if (!fs.existsSync(path.join(REPO, '.git'))) return `Mallens mapp (${REPO}) är ingen git-mapp, så den kan inte uppdateras härifrån.`;

  const changed = git('status', '--porcelain', '--untracked-files=no');
  if (changed.status !== 0) return gitProblem(changed);
  const files = changed.stdout.split('\n').filter(Boolean).map(line => line.slice(3));
  if (files.length) {
    return `Mallen uppdaterades inte, eftersom dess egna filer är ändrade här på datorn (${files.join(', ')}), `
      + 'och en uppdatering kunde skriva över det. Be Claude: "Uppdatera Herdr-Template2.0 och behåll det jag ändrat", '
      + `eller släng ändringarna med  git -C ${REPO} checkout -- .  och skriv uppdatera igen.`;
  }

  const from = version();
  const before = git('rev-parse', 'HEAD').stdout.trim();
  const pulled = git('pull', '--ff-only', '--quiet');
  if (pulled.status !== 0 || pulled.error) return gitProblem(pulled);
  const after = git('rev-parse', 'HEAD').stdout.trim();
  if (before === after) return `Mallen är redan den senaste versionen (${from}).`;

  const to = version();
  const install = spawnSync('bash', [path.join(REPO, 'install.sh'), '--no-windows'], {
    cwd: REPO, encoding: 'utf8', timeout: INSTALL_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const head = from === to ? `Mallen är uppdaterad (version ${to}).` : `Mallen är uppdaterad från version ${from} till ${to}.`;
  if (install.status !== 0 || install.error) {
    const tail = `${install.stdout || ''}${install.stderr || ''}`.trim().split('\n').slice(-4).join('\n');
    return `${head} Men installationen stannade, så alla delar är kanske inte på plats:\n${tail}\n\n`
      + 'Be Claude: "Installationen av Herdr-Template2.0 stannade, kör install.sh och rätta felet".';
  }

  let news = [];
  try { news = changelogSections(fs.readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8'), from, to); } catch { /* no changelog */ }
  return [head, news.length ? `\nNytt:\n\n${news.join('\n\n')}` : '',
    '\nStäng Windows Terminal och starta mallen igen (herdr-template), så får alla chattar det nya.'].filter(Boolean).join('\n');
}

function main() {
  let prompt = '';
  try { prompt = JSON.parse(fs.readFileSync(0, 'utf8')).prompt ?? ''; } catch { return; }
  if (!isUpdate(prompt)) return;
  let answer;
  try { answer = update(); } catch (error) { answer = `Uppdateringen gick inte: ${error.message}`; }
  process.stdout.write(JSON.stringify({ continue: false, stopReason: answer }));
}

if (require.main === module) main();

module.exports = { isUpdate, changelogSections, compareVersions };
