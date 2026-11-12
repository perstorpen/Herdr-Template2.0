'use strict';
// Runs the real hook against throwaway repos: a bare one stands for GitHub, a clone for the installed template.
// The template's own folder and its GitHub remote are never touched.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { isUpdate, changelogSections } = require('./update.js');

const SCRIPT = path.join(__dirname, 'update.js');
const DIRS = [];
process.on('exit', () => DIRS.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout;
}

const CHANGELOG = versions => `# Nytt i mallen\n\n${versions.map(v => `## ${v} – 2026-11-12\n\n- Nytt i ${v}.\n`).join('\n')}`;

// An install.sh that only leaves a mark, or fails, so the test sees it was run and how.
const INSTALL_OK = '#!/usr/bin/env bash\necho "ran $*" > "$(dirname "$0")/installed.txt"\n';
const INSTALL_FAIL = '#!/usr/bin/env bash\necho "FEL: Node gick inte att installera."\nexit 1\n';

function repos(version = '2.0.0') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'update-test-'));
  DIRS.push(home);
  const origin = path.join(home, 'origin.git');
  const work = path.join(home, 'work');
  const repo = path.join(home, 'template');
  git(home, 'init', '-q', '--bare', '-b', 'main', origin);
  git(home, 'clone', '-q', origin, work);
  fs.writeFileSync(path.join(work, 'version.txt'), `${version}\n`);
  fs.writeFileSync(path.join(work, 'CHANGELOG.md'), CHANGELOG([version]));
  fs.writeFileSync(path.join(work, 'install.sh'), INSTALL_OK);
  fs.writeFileSync(path.join(work, '.gitignore'), 'installed.txt\n');
  git(work, 'add', '.');
  git(work, 'commit', '-qm', version);
  git(work, 'push', '-q', 'origin', 'HEAD:main');
  git(home, 'clone', '-q', origin, repo);
  const release = (next, versions, install = INSTALL_OK) => {
    fs.writeFileSync(path.join(work, 'version.txt'), `${next}\n`);
    fs.writeFileSync(path.join(work, 'CHANGELOG.md'), CHANGELOG(versions));
    fs.writeFileSync(path.join(work, 'install.sh'), install);
    git(work, 'commit', '-qam', next);
    git(work, 'push', '-q', 'origin', 'HEAD:main');
  };
  return { home, repo, release };
}

function say(repo, prompt) {
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify({ prompt }), encoding: 'utf8', env: { ...process.env, HERDR_TEMPLATE_REPO: repo },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : null;
}

test('only the bare command is the command', () => {
  for (const prompt of ['uppdatera', 'Uppdatera mallen', ' update ', 'uppdatera.']) assert.ok(isUpdate(prompt), prompt);
  for (const prompt of ['uppdatera filen', 'kan du uppdatera?', 'update the readme', '']) assert.ok(!isUpdate(prompt), prompt);
  const { repo } = repos();
  assert.strictEqual(say(repo, 'uppdatera README'), null);
});

test('a new version is fetched, installed, and its news shown, answered at once', () => {
  const { repo, release } = repos('2.0.0');
  release('2.1.0', ['2.1.0', '2.0.0']);
  release('2.2.0', ['2.2.0', '2.1.0', '2.0.0']);
  const out = say(repo, 'uppdatera');
  assert.strictEqual(out.continue, false);
  assert.match(out.stopReason, /från version 2\.0\.0 till 2\.2\.0/);
  assert.match(out.stopReason, /## 2\.2\.0[\s\S]*## 2\.1\.0/);
  assert.doesNotMatch(out.stopReason, /## 2\.0\.0/);
  assert.match(out.stopReason, /Stäng Windows Terminal och starta mallen igen/);
  assert.strictEqual(fs.readFileSync(path.join(repo, 'installed.txt'), 'utf8').trim(), 'ran --no-windows');
  assert.strictEqual(fs.readFileSync(path.join(repo, 'version.txt'), 'utf8').trim(), '2.2.0');
});

test('up to date: says so with the version, and installs nothing', () => {
  const { repo } = repos('2.0.0');
  assert.strictEqual(say(repo, 'update').stopReason, 'Mallen är redan den senaste versionen (2.0.0).');
  assert.ok(!fs.existsSync(path.join(repo, 'installed.txt')));
});

test('changed files of the template are never overwritten', () => {
  const { repo, release } = repos('2.0.0');
  release('2.1.0', ['2.1.0', '2.0.0']);
  fs.appendFileSync(path.join(repo, 'install.sh'), '# my own line\n');
  const out = say(repo, 'uppdatera');
  assert.match(out.stopReason, /uppdaterades inte.*install\.sh/s);
  assert.match(out.stopReason, /Be Claude/);
  assert.strictEqual(fs.readFileSync(path.join(repo, 'version.txt'), 'utf8').trim(), '2.0.0');
  assert.match(fs.readFileSync(path.join(repo, 'install.sh'), 'utf8'), /my own line/);
});

test('without GitHub: says so plainly, with the WSL hint', () => {
  const { repo } = repos('2.0.0');
  git(repo, 'remote', 'set-url', 'origin', path.join(os.tmpdir(), 'no-such-origin.git'));
  const out = say(repo, 'uppdatera');
  assert.match(out.stopReason, /inte nå GitHub|gick inte att hämta/);
});

test('a host that cannot be found gives the wsl --shutdown hint', () => {
  const { repo } = repos('2.0.0');
  git(repo, 'remote', 'set-url', 'origin', 'https://no-such-host.invalid/x.git');
  assert.match(say(repo, 'uppdatera').stopReason, /wsl --shutdown/);
});

test('an install that stops is reported with its last lines', () => {
  const { repo, release } = repos('2.0.0');
  release('2.1.0', ['2.1.0', '2.0.0'], INSTALL_FAIL);
  const out = say(repo, 'uppdatera');
  assert.match(out.stopReason, /till 2\.1\.0.*installationen stannade/s);
  assert.match(out.stopReason, /FEL: Node gick inte att installera/);
});

test('the changelog gives the sections after the old version up to the new one', () => {
  const text = CHANGELOG(['2.10.0', '2.9.0', '2.1.0', '2.0.0']);
  assert.deepStrictEqual(changelogSections(text, '2.1.0', '2.10.0').map(s => s.split('\n')[0]), ['## 2.10.0 – 2026-11-12', '## 2.9.0 – 2026-11-12']);
  assert.deepStrictEqual(changelogSections(text, '2.10.0', '2.10.0'), []);
});

test('the template\'s own changelog has a section for its version', () => {
  const root = path.join(__dirname, '..');
  const version = fs.readFileSync(path.join(root, 'version.txt'), 'utf8').trim();
  assert.match(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), new RegExp(`^## ${version.replace(/\./g, '\\.')} – \\d{4}-\\d{2}-\\d{2}$`, 'm'));
});
