'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
// Each test's folder is removed at exit, or every run leaves its folders in /tmp.
const TEMP_DIRS = [];
process.on('exit', () => TEMP_DIRS.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
const tempDir = prefix => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP_DIRS.push(dir);
  return dir;
};
const { spawnSync } = require('child_process');
const { isTimePrompt, otherActiveAgents, lastOfScreen, buildContext } = require('./time.js');

test('only a prompt that is exactly "time" counts', () => {
  for (const prompt of ['time', 'Time', ' TIME\n']) assert.ok(isTimePrompt(prompt), prompt);
  for (const prompt of ['time left', 'what time is it', 'sometime', '']) assert.ok(!isTimePrompt(prompt), prompt);
});

test('takes working and blocked agents, but not idle ones or the one that got the command', () => {
  const agents = [
    { pane_id: 'p1', agent_status: 'working' },
    { pane_id: 'p2', agent_status: 'idle' },
    { pane_id: 'p3', agent_status: 'working' },
    { pane_id: 'p4', agent_status: 'blocked' },
  ];
  assert.deepStrictEqual(otherActiveAgents(agents, 'p3').map(one => one.pane_id), ['p1', 'p4']);
});

test('keeps the newest part of a screen and drops empty lines', () => {
  assert.strictEqual(lastOfScreen('old\n\n  \nnew', 100), 'old\nnew');
  assert.strictEqual(lastOfScreen('abcdef', 3), 'def');
});

test('shares the room between the agents', () => {
  const agent = pane_id => ({ pane_id, tabLabel: pane_id, agent_status: 'working', screen: 'x'.repeat(50000) });
  assert.ok(buildContext([agent('a'), agent('b'), agent('c')]).length < 10000);
});

function fakeHerdr(agents) {
  const dir = tempDir('time-');
  const replies = path.join(dir, 'agents.json');
  fs.writeFileSync(replies, JSON.stringify({ result: { agents } }));
  const bin = path.join(dir, 'herdr');
  fs.writeFileSync(bin, `#!/bin/bash
case "$1 $2" in
  "tab list") echo '{"result":{"tabs":[{"tab_id":"t1","label":"Main App Building"}]}}' ;;
  "agent list") cat '${replies}' ;;
  "pane read") echo "skärmen i $3" ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
  return bin;
}

function runHook(prompt, env, sessionId) {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'time.js')], { input: JSON.stringify({ prompt, session_id: sessionId }), encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  assert.strictEqual(run.status, 0, run.stderr);
  return run.stdout ? JSON.parse(run.stdout) : null;
}

test('hands the chat the screens of the other agents', () => {
  const bin = fakeHerdr([
    { pane_id: 'p1', tab_id: 't1', agent_status: 'working' },
    { pane_id: 'p3', tab_id: 't3', agent_status: 'working' },
  ]);
  const context = runHook('time', { HERDR_ENV: '1', HERDR_BIN_PATH: bin, HERDR_PANE_ID: 'p3' }).hookSpecificOutput.additionalContext;
  assert.match(context, /tab="Main App Building"/);
  assert.match(context, /skärmen i p1/);
  assert.doesNotMatch(context, /skärmen i p3/);
});

test('its own session decides which chat it is, when the pane id belongs to another chat', () => {
  const bin = fakeHerdr([
    { pane_id: 'p1', tab_id: 't1', agent_status: 'working', agent_session: { value: 'main' } },
    { pane_id: 'p3', tab_id: 't3', agent_status: 'working', agent_session: { value: 'mine' } },
  ]);
  const context = runHook('time', { HERDR_ENV: '1', HERDR_BIN_PATH: bin, HERDR_PANE_ID: 'p1' }, 'mine').hookSpecificOutput.additionalContext;
  assert.match(context, /skärmen i p1/);
  assert.doesNotMatch(context, /skärmen i p3/);
});

test('stops the prompt when no other agent is active', () => {
  const bin = fakeHerdr([{ pane_id: 'p3', tab_id: 't3', agent_status: 'working' }]);
  const answer = runHook('time', { HERDR_ENV: '1', HERDR_BIN_PATH: bin, HERDR_PANE_ID: 'p3' });
  assert.strictEqual(answer.continue, false);
  assert.match(answer.stopReason, /Inga andra agenter/);
});

test('says so when herdr cannot be reached, and leaves other prompts alone', () => {
  assert.match(runHook('time', {}).stopReason, /inte i herdr/);
  assert.match(runHook('time', { HERDR_ENV: '1', HERDR_BIN_PATH: '/nonexistent' }).stopReason, /Kunde inte/);
  assert.strictEqual(runHook('fixa knappen', { HERDR_ENV: '1' }), null);
});
