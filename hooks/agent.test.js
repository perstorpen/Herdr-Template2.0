'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseCommand, commandContext, contextFor, DEFAULT_CONTEXT } = require('./agent.js');

const runHook = (prompt, env = {}) =>
  spawnSync(process.execPath, [path.join(__dirname, 'agent.js')], {
    input: JSON.stringify({ prompt }),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

test('reads the number of extra agents and the task', () => {
  assert.deepStrictEqual(parseCommand('agent 2'), { count: 2, mission: '' });
  assert.deepStrictEqual(parseCommand('agent 0 fixa detta'), { count: 0, mission: 'fixa detta' });
  assert.deepStrictEqual(parseCommand('Agent 12 fixa bilderna'), { count: 12, mission: 'fixa bilderna' });
  assert.deepStrictEqual(parseCommand(' agent 3: granska koden\noch testa\n'), { count: 3, mission: 'granska koden\noch testa' });
});

test('reads "rec" as the chat choosing the number', () => {
  assert.deepStrictEqual(parseCommand('agent rec'), { count: null, mission: '' });
  assert.deepStrictEqual(parseCommand('AGENT REC, gör en stor granskning'), { count: null, mission: 'gör en stor granskning' });
});

test('other prompts are not the command', () => {
  for (const prompt of ['agent', 'agent 2x', 'agent 2.5 fixa', 'agent recept', 'agentur 2', 'hej agent 2', 'agenter 2', '']) {
    assert.strictEqual(parseCommand(prompt), null, prompt);
  }
});

test('asks for exactly the number the user gave', () => {
  assert.match(commandContext({ count: 2, mission: 'x' }), /Start exactly 2 extra agents/);
  assert.match(commandContext({ count: 1, mission: 'x' }), /Start exactly 1 extra agent:/);
  assert.match(commandContext({ count: 0, mission: 'x' }), /start none/);
});

test('"rec" leaves the number to the chat', () => {
  const context = commandContext({ count: null, mission: 'x' });
  assert.match(context, /Choose how many/);
  assert.doesNotMatch(context, /Start exactly/);
});

test('without a task it uses the chat\'s task, or asks', () => {
  assert.match(commandContext({ count: 2, mission: '' }), /has no task.*If there is none, ask/s);
  assert.match(commandContext({ count: 2, mission: 'x' }), /text after the command/);
});

test('a normal message gets the standing rule, and questions are left out by it', () => {
  assert.strictEqual(contextFor('fixa knappen på startsidan'), DEFAULT_CONTEXT);
  assert.strictEqual(contextFor('vad gör den här knappen?'), DEFAULT_CONTEXT);
  assert.match(DEFAULT_CONTEXT, /only a question, an answer to your question, or a comment/);
  assert.match(DEFAULT_CONTEXT, /Choose how many/);
});

test('every way of starting agents asks for the visible first line and the same way of running them', () => {
  for (const context of [DEFAULT_CONTEXT, commandContext({ count: 2, mission: 'x' }), commandContext({ count: null, mission: '' })]) {
    assert.match(context, /very first output, before any tool call/);
    assert.match(context, /`Agenter: \+N – short reason`/);
    assert.match(context, /subagent_type "fork"/);
    assert.match(context, /isolation "worktree"/);
    assert.match(context, /git -C <this chat's folder> diff HEAD \| git apply/);
  }
});

test('stays out of prompts that are handled elsewhere', () => {
  for (const prompt of ['info', 'Info.', 'time', ' TIME\n', 'pause', 'pause 90', 'pause 90%', 'Pause off', 'pause av', 'pause on', 'do list', 'Do-list.',
    'gör punkt 3', 'Gör punkterna 2 och 4', '/compact', '!ls', 'to do köp lödtenn', 'todo köp lödtenn', '', '  ']) {
    assert.strictEqual(contextFor(prompt), null, prompt);
  }
  for (const prompt of ['time the upload and report it', 'info om knappen behövs', 'pausa agenterna', 'save', 'deploy']) {
    assert.strictEqual(contextFor(prompt), DEFAULT_CONTEXT, prompt);
  }
});

test('the hook adds the instructions and keeps the prompt going', () => {
  for (const prompt of ['agent 2 fixa bilderna', 'fixa bilderna']) {
    const run = runHook(prompt);
    assert.strictEqual(run.status, 0);
    const answer = JSON.parse(run.stdout);
    assert.strictEqual(answer.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(answer.hookSpecificOutput.additionalContext, /Agenter: \+N/);
    assert.strictEqual(answer.continue, undefined);
  }
});

test('the hook prints nothing for info, or inside the to do list\'s own model call', () => {
  assert.strictEqual(runHook('info').stdout, '');
  assert.strictEqual(runHook('fixa bilderna', { TODO_WORKER: '1' }).stdout, '');
});
