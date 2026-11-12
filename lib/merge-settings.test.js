'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { mergeSettings } = require('./merge-settings.js');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'config', 'settings.template.json'), 'utf8');
const merged = existing => mergeSettings(TEMPLATE, existing, '/repo', '/bin/node');
const commands = (settings, event) => (settings.hooks[event] || []).flatMap(entry => entry.hooks.map(hook => hook.command));

test('a computer without settings gets the whole template, with the paths filled in', () => {
  const s = merged('');
  assert.match(s.statusLine.command, /^\/bin\/node \/repo\/statusline\/statusline\.js$/);
  assert.strictEqual(s.env.CLAUDE_CODE_PLUGIN_DIRS, '/repo/mod');
  assert.ok(commands(s, 'PreToolUse').some(c => c.includes('/repo/hooks/pause.js tool')));
  assert.ok(commands(s, 'UserPromptSubmit').some(c => c.includes('/repo/hooks/info.js')));
  assert.ok(commands(s, 'UserPromptSubmit').some(c => c.includes('/repo/hooks/clock.js prompt')));
  assert.ok(commands(s, 'Stop').some(c => c.includes('/repo/hooks/clock.js stop')));
  assert.doesNotMatch(JSON.stringify(s), /__REPO__|__NODE__/);
});

test('what the person already has stays, and the template adds to it', () => {
  const own = { model: 'opus', env: { MY_VAR: '1', CLAUDE_CODE_PLUGIN_DIRS: '/my/mod' },
    hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'my-hook' }] }], Stop: [{ hooks: [{ type: 'command', command: 'stop-hook' }] }] } };
  const s = merged(JSON.stringify(own));
  assert.strictEqual(s.model, 'opus');
  assert.strictEqual(s.env.MY_VAR, '1');
  assert.strictEqual(s.env.CLAUDE_CODE_PLUGIN_DIRS, '/my/mod:/repo/mod');
  assert.strictEqual(commands(s, 'UserPromptSubmit')[0], 'my-hook');
  assert.deepStrictEqual(commands(s, 'Stop'), ['stop-hook', '/bin/node /repo/hooks/clock.js stop']);
});

test('installing twice changes nothing the second time', () => {
  const once = merged('');
  assert.deepStrictEqual(merged(JSON.stringify(once)), once);
});

test('a broken settings file stops the install instead of being replaced', () => {
  assert.throws(() => merged('{ not json'));
});
