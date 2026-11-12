'use strict';
// Runs the real hooks against a throwaway folder, so the user's own pause is untouched.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseCommand } = require('./pause.js');

const SCRIPT = path.join(__dirname, 'pause.js');
const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const PAST = Math.floor(Date.now() / 1000) - 60;
const DIRS = [];
process.on('exit', () => DIRS.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

function sandbox(used, resetsAt = FUTURE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pause-test-'));
  DIRS.push(dir);
  if (used !== undefined) fs.writeFileSync(path.join(dir, 'limit.json'), JSON.stringify({ used_percentage: used, resets_at: resetsAt }));
  return dir;
}

function hook(dir, mode, input) {
  const r = spawnSync(process.execPath, [SCRIPT, mode], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, PAUSE_DIR: dir } });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : null;
}

const tool = (dir, session = 'chat-1') => hook(dir, 'tool', { session_id: session, tool_name: 'Bash' });
const say = (dir, prompt, session = 'chat-1') => hook(dir, 'prompt', { session_id: session, prompt });

test('below the limit nothing is stopped', () => {
  assert.strictEqual(tool(sandbox(94.9)), null);
  assert.strictEqual(tool(sandbox()), null, 'no figure yet');
});

test('at 95 % a working chat is stopped, told why and how to go on', () => {
  const out = tool(sandbox(95.2));
  assert.strictEqual(out.continue, false);
  assert.match(out.stopReason, /Pausad: 95 % av sessionen/);
  assert.match(out.stopReason, /Skriv fortsätt/);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /Stop now/);
});

test('writing in the chat lets that chat go on, and only that chat', () => {
  const dir = sandbox(96);
  assert.ok(tool(dir));
  assert.strictEqual(say(dir, 'fortsätt'), null);
  assert.strictEqual(tool(dir), null);
  assert.ok(tool(dir, 'chat-2'), 'another chat is still paused');
});

test('a chat started during the pause works from its first message', () => {
  const dir = sandbox(97);
  say(dir, 'vad heter filen?', 'new-chat');
  assert.strictEqual(tool(dir, 'new-chat'), null);
});

test('a message sent before the limit does not let the chat through later', () => {
  const dir = sandbox(50);
  say(dir, 'bygg allt');
  fs.writeFileSync(path.join(dir, 'limit.json'), JSON.stringify({ used_percentage: 95, resets_at: FUTURE }));
  assert.ok(tool(dir));
});

test('a session that has ended pauses nothing, and its go-ahead is over too', () => {
  assert.strictEqual(tool(sandbox(99, PAST)), null);
  const dir = sandbox(96, FUTURE);
  say(dir, 'fortsätt');
  // The next session: the old go-ahead was for a session ending at FUTURE, which is now past.
  fs.writeFileSync(path.join(dir, 'allowed', 'chat-1'), JSON.stringify(PAST));
  fs.writeFileSync(path.join(dir, 'limit.json'), JSON.stringify({ used_percentage: 96, resets_at: FUTURE + 18000 }));
  assert.ok(tool(dir));
});

test('"pause 90" moves the limit, "pause off" removes it, "pause on" puts 95 back', () => {
  const dir = sandbox(92);
  assert.strictEqual(tool(dir), null);
  let out = say(dir, 'pause 90');
  assert.strictEqual(out.continue, false);
  assert.match(out.stopReason, /pausar när 90 %/);
  assert.match(out.stopReason, /Nu är 92 % använt/);
  assert.ok(tool(dir), 'the command itself is not a go-ahead');
  assert.match(say(dir, 'pause off').stopReason, /avstängd/);
  assert.strictEqual(tool(dir), null);
  assert.match(say(dir, 'Pause on').stopReason, /pausar när 95 %/);
  assert.match(say(dir, 'pause').stopReason, /pausar när 95 %/);
});

test('only the bare command is read as the command', () => {
  assert.deepStrictEqual(parseCommand('pause'), { show: true });
  assert.deepStrictEqual(parseCommand(' pause 80% '), { at: 80 });
  assert.deepStrictEqual(parseCommand('pause av'), { at: 0 });
  for (const prompt of ['pause 101', 'pause 90 nu', 'pausa agenterna', 'gör en pause', 'pause -5', '']) {
    assert.strictEqual(parseCommand(prompt), null, prompt);
  }
});

test('a damaged file never stops a chat', () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, 'limit.json'), '{broken');
  fs.writeFileSync(path.join(dir, 'setting.json'), '{"at":"many"}');
  assert.strictEqual(tool(dir), null);
  const r = spawnSync(process.execPath, [SCRIPT, 'tool'], { input: 'not json', encoding: 'utf8', env: { ...process.env, PAUSE_DIR: dir } });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

test('without PAUSE_DIR the pause lives in the template\'s data folder', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'pause-data-'));
  DIRS.push(data);
  const env = { ...process.env, HERDR_TEMPLATE_DATA: data };
  delete env.PAUSE_DIR;
  const r = spawnSync(process.execPath, ['-e', `console.log(require(${JSON.stringify(SCRIPT)}).DIR)`], { encoding: 'utf8', env });
  assert.strictEqual(r.stdout.trim(), path.join(data, 'pause'));
  fs.mkdirSync(path.join(data, 'pause'));
  fs.writeFileSync(path.join(data, 'pause', 'limit.json'), JSON.stringify({ used_percentage: 99, resets_at: FUTURE }));
  const out = spawnSync(process.execPath, [SCRIPT, 'tool'], { input: JSON.stringify({ session_id: 'x' }), encoding: 'utf8', env });
  assert.strictEqual(JSON.parse(out.stdout).hookSpecificOutput.permissionDecision, 'deny');
});
