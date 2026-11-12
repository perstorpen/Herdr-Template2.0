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
const { textAfterToDo, isDoList, parseTidied, wrap, inDisplayOrder, assignNumbers, restoreItems } = require('./todo.js');

test('finds the text after every way of writing "to do"', () => {
  for (const prompt of ['to do fixa knappen', 'To do: fixa knappen', 'TODO fixa knappen', 'To-do, fixa knappen', '  to do\nfixa knappen']) {
    assert.strictEqual(textAfterToDo(prompt), 'fixa knappen', prompt);
  }
});

test('leaves other messages alone', () => {
  for (const prompt of ['fixa knappen', 'vad är to do', 'to do', 'to do-listan funkar inte', 'to do list fliken syns inte', 'todolist', 'to dos']) {
    assert.strictEqual(textAfterToDo(prompt), null, prompt);
  }
});

test('reads the model reply, also with text around the array', () => {
  assert.deepStrictEqual(parseTidied('[{"text": " a ", "details": " Längre om a. "}]'), [{ text: 'a', details: 'Längre om a.' }]);
  assert.deepStrictEqual(parseTidied('Här:\n```json\n[{"text": "a", "details": "x"}]\n```'), [{ text: 'a', details: 'x' }]);
  assert.deepStrictEqual(parseTidied('["a", " b "]'), [{ text: 'a', details: '' }, { text: 'b', details: '' }]);
  for (const reply of ['[]', '["a", 1]', 'inget', '[""]', '[{"details": "x"}]', '[{"text": "a", "details": 3}]']) {
    assert.throws(() => parseTidied(reply), reply);
  }
});

test('knows "do list" and nothing else as the command', () => {
  for (const prompt of ['do list', 'Do list', 'DO LIST', ' do-list. ', 'do listan', 'dolist!']) assert.ok(isDoList(prompt), prompt);
  for (const prompt of ['to do list', 'do list och fixa knappen', 'gör do list', 'do lists', 'do']) assert.ok(!isDoList(prompt), prompt);
});

test('wraps at the width and cuts a word that is too long', () => {
  assert.deepStrictEqual(wrap('aa bb cc', 5), ['aa bb', 'cc']);
  assert.deepStrictEqual(wrap('abcdefg', 3), ['abc', 'def', 'g']);
});

test('puts what the user has to check between what needs doing and what is finished', () => {
  const items = [{ id: 'a', num: 1, done: true }, { id: 'b', num: 2, state: 'ready' }, { id: 'c', num: 3, state: 'working' }, { id: 'd', num: 4 }];
  assert.deepStrictEqual(inDisplayOrder(items).map(one => one.id), ['c', 'd', 'b', 'a']);
});

test('shows finished items last, the latest turned green first', () => {
  const items = [
    { id: 'a', done: true, changedAt: 100 }, { id: 'b', done: false }, { id: 'c', done: true, changedAt: 300 }, { id: 'd', done: false },
    { id: 'e', num: 5, done: true, changedAt: 200 }, { id: 'f', num: 6, done: true, changedAt: 200 },
  ];
  assert.deepStrictEqual(inDisplayOrder(items).map(one => one.id), ['b', 'd', 'c', 'f', 'e', 'a']);
});

test('hides cleared items', () => {
  assert.deepStrictEqual(inDisplayOrder([{ id: 'a', cleared: true, done: true }, { id: 'b' }]).map(one => one.id), ['b']);
});

const numbersOf = items => Object.fromEntries(items.map(one => [one.id[0], one.num]));

test('gives items numbers in the order they were added', () => {
  assert.deepStrictEqual(numbersOf(assignNumbers([{ id: 'b-x' }, { id: 'a-x' }])), { a: 1, b: 2 });
});

test('a number stays with its item when it is finished or cleared, and is never used again', () => {
  const items = [{ id: 'a-x', num: 1, done: true }, { id: 'b-x', num: 2, cleared: true }, { id: 'c-x' }];
  assert.deepStrictEqual(numbersOf(assignNumbers(items)), { a: 1, b: 2, c: 3 });
});

test('when two items have the same number, the one added first keeps it', () => {
  assert.deepStrictEqual(numbersOf(assignNumbers([{ id: 'b-x', num: 4 }, { id: 'a-x', num: 4 }])), { a: 4, b: 5 });
});

test('shows open items first in number order and finished ones last', () => {
  const items = [{ id: 'a', num: 3, done: true, changedAt: 1 }, { id: 'b', num: 4 }, { id: 'c', num: 1, done: true, changedAt: 2 }, { id: 'd', num: 2 }];
  assert.deepStrictEqual(inDisplayOrder(items).map(one => one.num), [2, 4, 1, 3]);
});

function runHook(prompt, env = {}) {
  const dir = tempDir('todo-');
  const file = path.join(dir, 'list.json');
  const run = spawnSync(process.execPath, [path.join(__dirname, 'todo.js'), 'hook'], {
    input: JSON.stringify({ prompt }),
    encoding: 'utf8',
    // PATH without claude and no herdr: the worker fails quietly and the typed text stays on the list.
    env: { PATH: '/nonexistent', TODO_FILE: file, ...env },
  });
  const items = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).items : [];
  return { run, items };
}

test('the hook stops a "to do" prompt and puts the text on the list', () => {
  const { run, items } = runHook('to do fixa knappen');
  assert.strictEqual(run.status, 0);
  assert.strictEqual(JSON.parse(run.stdout).continue, false);
  assert.deepStrictEqual(items.map(one => one.text), ['fixa knappen']);
});

test('the hook hands the list to a chat when an item is named by number', () => {
  const dir = tempDir('todo-');
  const file = path.join(dir, 'list.json');
  fs.writeFileSync(file, JSON.stringify({ items: [{ id: 'a-x', text: 'Fixa knappen', done: false }] }));
  for (const prompt of ['gör punkt 1', 'Punkterna 1 och 2', 'kolla to do listan']) {
    const run = spawnSync(process.execPath, [path.join(__dirname, 'todo.js'), 'hook'], {
      input: JSON.stringify({ prompt }),
      encoding: 'utf8',
      env: { TODO_FILE: file },
    });
    const context = JSON.parse(run.stdout).hookSpecificOutput.additionalContext;
    assert.match(context, /1\. \[ \] Fixa knappen/, prompt);
    for (const command of ['start', 'done', 'reopen', 'approve']) assert.match(context, new RegExp(`todo\\.js' ${command} <number>`), prompt);
  }
});

function listWithTwoItems() {
  const file = path.join(tempDir('todo-'), 'list.json');
  fs.writeFileSync(file, JSON.stringify({ items: [{ id: 'a-x', text: 'ett', done: false }, { id: 'b-x', text: 'två', done: false }] }));
  const mark = (command, ...numbers) => spawnSync(process.execPath, [path.join(__dirname, 'todo.js'), command, ...numbers], { encoding: 'utf8', env: { TODO_FILE: file } });
  const second = () => JSON.parse(fs.readFileSync(file, 'utf8')).items[1];
  const list = () => mark('list').stdout;
  return { mark, second, list };
}

test('an agent marks an item yellow, then blue, and that is not finished', () => {
  const { mark, second } = listWithTwoItems();
  assert.strictEqual(mark('start', '2').status, 0);
  assert.deepStrictEqual([second().state, second().done], ['working', false]);
  assert.strictEqual(mark('done', '2').status, 0);
  assert.deepStrictEqual([second().state, second().done], ['ready', false]);
  assert.strictEqual(mark('reopen', '2').status, 0);
  assert.deepStrictEqual([second().state, second().done], [undefined, false]);
});

test('only approve makes an item green, and an agent cannot change a green item', () => {
  const { mark, second } = listWithTwoItems();
  mark('approve', '2');
  assert.deepStrictEqual([second().state, second().done], [undefined, true]);
  for (const command of ['start', 'done', 'reopen']) {
    assert.match(mark(command, '2').stdout, /Redan grön/);
    assert.strictEqual(second().done, true, command);
  }
});

test('a green item is listed without its number, and gets it back if it stops being green', () => {
  const { mark, list } = listWithTwoItems();
  mark('approve', '2');
  assert.strictEqual(list(), '1. [ ] ett\n- [klar] två\n');
  mark('approve', '1');
  assert.strictEqual(list(), '- [klar] ett\n- [klar] två\n');
});

test('a number stays reserved while its item is green', () => {
  assert.deepStrictEqual(numbersOf(assignNumbers([{ id: 'a-x', num: 1, done: true }, { id: 'b-x' }])), { a: 1, b: 2 });
});

test('undo restores the items the action touched and nothing else', () => {
  const before = [{ id: 'a', state: 'ready', done: false, changedAt: 1 }];
  const now = [{ id: 'a', done: true, changedAt: 2 }, { id: 'b', state: 'working', done: false, changedAt: 3 }];
  const [restored, other] = restoreItems(now, before);
  assert.deepStrictEqual([restored.state, restored.done], ['ready', false]);
  assert.ok(restored.changedAt > 2, 'an undo is a new change');
  assert.strictEqual(other, now[1]);
});

test('marking refuses a number that is not on the list, and no number at all', () => {
  const { mark, second } = listWithTwoItems();
  assert.strictEqual(mark('done', '9').status, 1);
  assert.strictEqual(mark('done').status, 1);
  assert.strictEqual(second().state, undefined);
});

test('the hook lets other prompts through', () => {
  const { run, items } = runHook('fixa knappen');
  assert.strictEqual(run.status, 0);
  assert.strictEqual(run.stdout, '');
  assert.deepStrictEqual(items, []);
});

test('the hook stays out of the tidying model call', () => {
  const { run, items } = runHook('to do fixa knappen', { TODO_WORKER: '1' });
  assert.strictEqual(run.stdout, '');
  assert.deepStrictEqual(items, []);
});

function hookOn(items, prompt) {
  const file = path.join(tempDir('todo-'), 'list.json');
  fs.writeFileSync(file, JSON.stringify({ items }));
  const run = spawnSync(process.execPath, [path.join(__dirname, 'todo.js'), 'hook'], { input: JSON.stringify({ prompt }), encoding: 'utf8', env: { TODO_FILE: file } });
  return JSON.parse(run.stdout);
}

test('"do list" hands the chat every purple item with its explanation', () => {
  const items = [
    { id: 'a-x', text: 'Fixa knappen', details: 'Knappen på startsidan ska vara större.', state: 'queued', done: false },
    { id: 'b-x', text: 'Inte nu', done: false },
    { id: 'c-x', text: 'Lila två', state: 'queued', done: false },
  ];
  const context = hookOn(items, 'do list').hookSpecificOutput.additionalContext;
  const purple = context.split('\n\n')[0];
  assert.match(purple, /1\. \[lila: görs vid do list\] Fixa knappen\n {6}Knappen på startsidan ska vara större\./);
  assert.match(purple, /3\. \[lila: görs vid do list\] Lila två/);
  assert.doesNotMatch(purple, /Inte nu/);
  assert.match(context, /todo\.js' start <number>/);
});

test('"do list" with no purple item stops the prompt, so nothing is done', () => {
  const answer = hookOn([{ id: 'a-x', text: 'Fixa knappen', done: false }], 'do list');
  assert.strictEqual(answer.continue, false);
  assert.match(answer.stopReason, /Inga lila punkter/);
});

test('an agent marking a purple item takes it from purple to yellow, and the list says purple', () => {
  const file = path.join(tempDir('todo-'), 'list.json');
  fs.writeFileSync(file, JSON.stringify({ items: [{ id: 'a-x', text: 'ett', state: 'queued', done: false }] }));
  const run = (...args) => spawnSync(process.execPath, [path.join(__dirname, 'todo.js'), ...args], { encoding: 'utf8', env: { TODO_FILE: file } });
  assert.strictEqual(run('list').stdout, '1. [lila: görs vid do list] ett\n');
  assert.strictEqual(run('start', '1').status, 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).items[0].state, 'working');
});

test('show prints an item with its longer explanation', () => {
  const file = path.join(tempDir('todo-'), 'list.json');
  fs.writeFileSync(file, JSON.stringify({ items: [{ id: 'a-x', text: 'Fixa knappen', details: 'Längre.', done: false }, { id: 'b-x', text: 'Utan', done: false }] }));
  const show = num => spawnSync(process.execPath, [path.join(__dirname, 'todo.js'), 'show', num], { encoding: 'utf8', env: { TODO_FILE: file } });
  assert.strictEqual(show('1').stdout, '1. [ ] Fixa knappen\nLängre.\n');
  assert.strictEqual(show('2').stdout, '2. [ ] Utan\n(ingen längre förklaring)\n');
  assert.strictEqual(show('9').status, 1);
});

test('the list lives in the data folder, and the tab is called To Do List', () => {
  const data = tempDir('todo-data-');
  const run = spawnSync(process.execPath, ['-e', `const t = require(${JSON.stringify(path.join(__dirname, 'todo.js'))}); console.log(JSON.stringify([t.LIST_FILE, t.TAB_LABEL]))`], {
    encoding: 'utf8',
    env: { ...process.env, TODO_FILE: '', HERDR_TEMPLATE_DATA: data },
  });
  assert.deepStrictEqual(JSON.parse(run.stdout), [path.join(data, 'todo-list.json'), 'To Do List']);
});

test('a "to do" in an empty template starts the list with that item, and the chat is told how to mark it', () => {
  const data = tempDir('todo-data-');
  const env = { PATH: '/nonexistent', HERDR_TEMPLATE_DATA: data };
  const hook = prompt => spawnSync(process.execPath, [path.join(__dirname, 'todo.js'), 'hook'], { input: JSON.stringify({ prompt }), encoding: 'utf8', env });
  assert.strictEqual(fs.existsSync(path.join(data, 'todo-list.json')), false, 'the list starts empty');
  assert.strictEqual(JSON.parse(hook('to do skriv guiden').stdout).stopReason, 'Tillagt på to do-listan.');
  const context = JSON.parse(hook('gör punkt 1').stdout).hookSpecificOutput.additionalContext;
  assert.match(context, /1\. \[ \] skriv guiden/);
  assert.ok(context.includes(`'${process.execPath}' '${path.join(__dirname, 'todo.js')}' start <number>`), 'the path of this copy of the template');
  assert.doesNotMatch(context, /owner|\bhe\b|\bhis\b/i);
});
