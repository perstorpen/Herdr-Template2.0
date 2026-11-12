'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { INFO, isInfo } = require('./info.js');

const run = prompt => spawnSync(process.execPath, [path.join(__dirname, 'info.js')], { input: JSON.stringify({ prompt }), encoding: 'utf8' });

test('"info" answers at once with the text, without going to the chat', () => {
  const out = JSON.parse(run(' Info ').stdout);
  assert.strictEqual(out.continue, false);
  assert.strictEqual(out.stopReason, INFO);
});

test('only the bare word is the command', () => {
  for (const prompt of ['info om filen', 'ge mig info', 'information', '']) assert.strictEqual(isInfo(prompt), false, prompt);
  assert.strictEqual(run('vad är info?').stdout, '');
});

test('every command a hook answers to is described', () => {
  for (const word of ['info', 'to do', 'do list', 'gör punkt', 'agent 2', 'agent 0', 'agent rec', 'time', 'pause 90', 'pause off', 'pause on', 'fortsätt', '/compact', 'xhigh', 'månad', 'To Do List']) {
    assert.ok(INFO.includes(word), word);
  }
});

test('the settings run this hook', () => {
  const template = fs.readFileSync(path.join(__dirname, '..', 'config', 'settings.template.json'), 'utf8');
  assert.match(template, /hooks\/info\.js/);
});
