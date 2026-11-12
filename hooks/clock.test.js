'use strict';
// Runs the real hook against a throwaway folder, so no chat's own clock is touched.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { startsTask, started, stopped, shownMs, interruptedAt } = require('./clock.js');

const SCRIPT = path.join(__dirname, 'clock.js');
const DIRS = [];
process.on('exit', () => DIRS.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clock-test-'));
  DIRS.push(dir);
  return dir;
}

function hook(dir, mode, input, more = {}) {
  const env = { ...process.env, CLOCK_DIR: dir, ...more };
  if (!('TODO_WORKER' in more)) delete env.TODO_WORKER;
  const r = spawnSync(process.execPath, [SCRIPT, mode], { input: JSON.stringify(input), encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '', 'the clock never answers a prompt');
}
const saved = (dir, session = 'chat-1') => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, `${session}.json`), 'utf8')); } catch { return null; }
};

test('the clock starts from nothing at each new prompt and stands still after the chat has stopped', () => {
  const MIN = 60000;
  const T = Date.parse('2026-11-12T10:00:00Z');
  let clock = started(T);
  assert.strictEqual(shownMs(clock, T + 5 * MIN), 5 * MIN, 'running');
  clock = stopped(clock, T + 7 * MIN);
  assert.strictEqual(shownMs(clock, T + 500 * MIN), 7 * MIN, 'stopped: the time stays');
  assert.deepStrictEqual(stopped(clock, T + 900 * MIN), clock, 'a second stop adds nothing');
  assert.strictEqual(shownMs(started(T + 600 * MIN), T + 601 * MIN), MIN, 'a new prompt starts over');
  assert.strictEqual(stopped(null, T), null);
  // Broken off with Esc: the time ends there, not now.
  assert.strictEqual(shownMs(started(T), T + 50 * MIN, T + 3 * MIN), 3 * MIN);
  assert.strictEqual(shownMs(started(T + 10 * MIN), T + 50 * MIN, T + 3 * MIN), 40 * MIN, 'a break before this prompt is an old one');
});

test('the hooks keep one clock per chat', () => {
  const dir = sandbox();
  hook(dir, 'stop', { session_id: 'chat-1' });
  assert.strictEqual(saved(dir), null, 'a stop with no prompt before it writes nothing');
  hook(dir, 'prompt', { session_id: 'chat-1', prompt: 'bygg en sida' });
  const running = saved(dir);
  assert.strictEqual(running.workedMs, 0);
  assert.ok(Math.abs(Date.now() - running.runningSince) < 5000);
  hook(dir, 'prompt', { session_id: 'chat-2', prompt: 'en annan sak' });
  hook(dir, 'stop', { session_id: 'chat-1' });
  const done = saved(dir);
  assert.strictEqual(done.runningSince, null);
  assert.ok(done.workedMs >= 0 && done.workedMs < 5000);
  assert.ok(saved(dir, 'chat-2').runningSince, 'the other chat still runs');
  hook(dir, 'stop', { session_id: 'chat-1' });
  assert.deepStrictEqual(saved(dir), done, 'woken by something else and stopped again: the time stays');
});

test('a command the template answers by itself leaves the time as it was', () => {
  for (const prompt of ['info', 'to do köp mjölk', 'pause 90', 'uppdatera', '/compact', 'do list', '', '   ']) assert.strictEqual(startsTask(prompt), false, prompt);
  for (const prompt of ['bygg en sida', 'agent 2 bygg en sida', 'ja']) assert.strictEqual(startsTask(prompt), true, prompt);
  const dir = sandbox();
  hook(dir, 'prompt', { session_id: 'chat-1', prompt: 'bygg en sida' });
  hook(dir, 'stop', { session_id: 'chat-1' });
  const done = saved(dir);
  hook(dir, 'prompt', { session_id: 'chat-1', prompt: 'info' });
  assert.deepStrictEqual(saved(dir), done);
  hook(dir, 'prompt', { session_id: 'chat-1', prompt: 'nästa sak' }, { TODO_WORKER: '1' });
  assert.deepStrictEqual(saved(dir), done, 'a To Do worker is not the user writing');
  hook(dir, 'prompt', { session_id: '../../evil', prompt: 'x' });
  assert.deepStrictEqual(fs.readdirSync(dir), ['chat-1.json'], 'a strange chat id writes no file');
});

test('a chat broken off with Esc is read from the end of its transcript', () => {
  const dir = sandbox();
  const file = path.join(dir, 't.jsonl');
  const line = (type, content, timestamp) => JSON.stringify({ type, timestamp, message: { content } }) + '\n';
  fs.writeFileSync(file, line('user', 'bygg', '2026-11-12T10:00:00Z') + line('assistant', [{ type: 'text', text: 'Jobbar.' }], '2026-11-12T10:01:00Z'));
  assert.strictEqual(interruptedAt(file), null);
  fs.appendFileSync(file, line('user', [{ type: 'text', text: '[Request interrupted by user for tool use]' }], '2026-11-12T10:02:00Z') + JSON.stringify({ type: 'system' }) + '\n');
  assert.strictEqual(interruptedAt(file), Date.parse('2026-11-12T10:02:00Z'));
  assert.strictEqual(interruptedAt(path.join(dir, 'missing.jsonl')), null);
  assert.strictEqual(interruptedAt(undefined), null);
});
