'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { addPoints, checkPoints, inGroups, countOf, withStatus, describeItem, numbersIn, restoreItems, foldedAtStart, projectOf, listFileFor, isWalkthrough } = require('./kontroll.js');

const SCRIPT = path.join(__dirname, 'kontroll.js');
const point = (group, title) => ({ group, sub: 'Sidan', title, check: 'Klicka och se.' });

function tempList() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kontroll-'));
  const file = path.join(dir, 'kontroll.jsonl');
  const run = (args, input, env = { KONTROLL_FILE: file }) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', input, env: { ...process.env, KONTROLL_FILE: '', HERDR_ENV: '', ...env } });
  const add = points => {
    const source = path.join(dir, 'points.json');
    fs.writeFileSync(source, JSON.stringify(points));
    return run(['add', source]);
  };
  const read = () => fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  return { dir, file, run, add, read };
}

test('points get numbers that go on from the highest and are never reused', () => {
  const first = addPoints([], [point('Start', 'A'), point('Robotar', 'B')]);
  assert.deepEqual(first.map(one => one.num), [1, 2]);
  const later = addPoints(first.filter(one => one.num === 2), [point('Start', 'C')]);
  assert.deepEqual(later.map(one => one.num), [2, 3]);
  assert.equal(later[1].status, 'open');
});

test('a point without a group, a title or what to check is refused', () => {
  assert.throws(() => checkPoints([{ group: 'Start', title: 'A' }]), /check/);
  assert.throws(() => checkPoints([]), /array/);
  checkPoints([point('Start', 'A')]);
});

test('groups keep the order they were first given, and a later point joins its group', () => {
  const items = addPoints(addPoints([], [point('Start', 'A'), point('Robotar', 'B')]), [point('Start', 'C')]);
  assert.deepEqual(inGroups(items).map(one => [one.name, one.points.map(p => p.num)]), [['Start', [1, 3]], ['Robotar', [2]]]);
});

test('every answer is kept in the log, and the count follows the latest', () => {
  let [item] = addPoints([], [point('Start', 'A')]);
  item = withStatus(item, 'bad', 'user', 'Knappen syns inte');
  item = withStatus(item, 'fixed', 'agent', 'Knappen flyttad upp');
  assert.deepEqual(item.log.map(one => one.status), ['bad', 'fixed']);
  assert.deepEqual(countOf([item]), { open: 0, ok: 0, bad: 0, fixed: 1 });
  assert.match(describeItem(item), /The user said: Knappen syns inte\n\s+Fixed: Knappen flyttad upp/);
});

test('numbers are read from "K3", "k 4" and not from other words', () => {
  assert.deepEqual(numbersIn('K3 bra, k 4 fel, OK12 och M3'), [3, 4]);
});

// A throwaway project folder, with or without git, and the hook run as a chat in it would run it.
function project({ git = false, list = false } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kontroll-project-')));
  if (git) spawnSync('git', ['init', '-q', dir]);
  const sub = path.join(dir, 'src', 'pages');
  fs.mkdirSync(sub, { recursive: true });
  if (list) fs.writeFileSync(path.join(dir, 'kontroll.jsonl'), JSON.stringify({ num: 1, group: 'Start', sub: '', title: 'A', done: '', check: 'Se.', update: 'x', status: 'open', log: [] }) + '\n');
  const hook = (prompt, cwd = dir) => {
    const out = spawnSync(process.execPath, [SCRIPT, 'hook'], { encoding: 'utf8', input: JSON.stringify({ prompt, cwd }), env: { ...process.env, KONTROLL_FILE: '', HERDR_ENV: '' } }).stdout;
    return out ? JSON.parse(out).hookSpecificOutput.additionalContext : '';
  };
  return { dir, sub, hook };
}

test('the list lives at the git top level, or in the folder itself outside git', () => {
  const inGit = project({ git: true });
  assert.equal(projectOf(inGit.sub), inGit.dir);
  assert.equal(listFileFor(inGit.sub), path.join(inGit.dir, 'kontroll.jsonl'));
  const plain = project();
  assert.equal(projectOf(plain.sub), plain.sub);
  assert.equal(listFileFor(plain.dir), path.join(plain.dir, 'kontroll.jsonl'));
});

test('a chat in a subfolder of a git project gets the project\'s list', () => {
  const { sub, hook } = project({ git: true, list: true });
  assert.match(hook('hej', sub), /1 points: 0 good, 0 wrong/);
});

test('the hook says nothing for a project without a list and an unrelated message', () => {
  const { hook, dir } = project({ git: true });
  assert.equal(hook('fixa knappen'), '');
  assert.ok(!fs.existsSync(path.join(dir, 'kontroll.jsonl')), 'nothing is written');
});

test('the hook speaks when the project has a list, and when the list is named', () => {
  const withList = project({ list: true });
  const context = withList.hook('hej');
  assert.match(context, /1 points: 0 good, 0 wrong/);
  assert.match(context, /same language as the system's own interface/);
  assert.doesNotMatch(context, /owner|NX|English/);
  assert.match(withList.hook('K1 är bra'), /Named in the user's message:\nK1 /);
  assert.match(project().hook('vad står på kontrollistan?'), /The list is empty so far/);
});

test('"kontroll genomgång" asks the chat to go through the whole system and fill the list', () => {
  assert.equal(isWalkthrough(' Kontroll genomgång '), true);
  assert.equal(isWalkthrough('kontroll genomgang.'), true);
  assert.equal(isWalkthrough('gör en kontroll genomgång av knappen'), false);
  const { hook } = project({ git: true });
  const context = hook('kontroll genomgång');
  assert.match(context, /go through the whole system/);
  assert.match(context, /one checkable thing each, in plain words/);
  assert.match(context, /\d{4}-\d{2}-\d{2} Första genomgången/);
  assert.match(context, /Skip what is already on the list/);
  assert.match(context, /never by editing the file by hand/);
  assert.match(context, /how many points each group got/);
  assert.match(context, /add <file\.json>/);
});

test('the commands a chat is given point at this project\'s list, wherever the chat is', () => {
  const { dir, hook } = project({ list: true });
  assert.ok(hook('hej').includes(`KONTROLL_FILE='${path.join(dir, 'kontroll.jsonl')}'`));
});

test('an agent can only say fixed about a point the user marked wrong', () => {
  const { run, add, read } = tempList();
  assert.match(add([point('Start', 'A'), point('Start', 'B')]).stdout, /^K1 \[not checked\] Start › Sidan: A\nK2 /);
  assert.equal(run(['fixed', 'K1', 'Ändrat']).status, 1);
  assert.equal(run(['bad', 'K1']).status, 1, 'wrong needs the words');
  assert.equal(run(['bad', 'K1', 'Syns', 'inte']).status, 0);
  assert.equal(run(['fixed', 'K1']).status, 1, 'fixed needs what was changed');
  assert.equal(run(['fixed', 'K1', 'Flyttad upp']).status, 0);
  assert.equal(run(['ok', 'K1']).status, 0);
  assert.equal(run(['fixed', 'K1', 'Igen']).status, 1);
  assert.deepEqual(read().map(one => one.status), ['ok', 'open']);
  assert.deepEqual(read()[0].log.map(one => [one.who, one.status]), [['user', 'bad'], ['agent', 'fixed'], ['user', 'ok']]);
  assert.match(run(['show', 'K1']).stdout, /user: WRONG – Syns inte/);
  assert.match(run(['list', 'start']).stdout, /^## Start\nK1 \[good\]/);
});

test('retext gives a point new words and keeps its answer', () => {
  const { run, add, read } = tempList();
  add([point('Robotar', 'Listan')]);
  run(['bad', 'K1', 'Syns inte']);
  const file = path.join(os.tmpdir(), `retext-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify([{ num: 1, group: 'Robots', sub: 'The list', title: 'The list', done: '', check: 'Click and look.' }, { num: 9, group: 'X', title: 'Y', check: 'Z' }]));
  assert.match(run(['retext', file]).stdout, /1 points rewritten, 1 numbers not on the list/);
  const [item] = read();
  assert.deepEqual([item.group, item.sub, item.title, item.check, item.status, item.log.length], ['Robots', 'The list', 'The list', 'Click and look.', 'bad', 1]);
});

test('tried is a note beside the point and never an answer', () => {
  const { run, add, read } = tempList();
  add([point('Robots', 'The list')]);
  assert.equal(run(['tried', 'K1', 'maybe']).status, 1);
  assert.equal(run(['tried', 'K1', 'broken']).status, 1, 'broken needs what was seen');
  assert.match(run(['tried', 'K1', 'broken', 'The button is missing']).stdout, /Tried by an agent \(.+\): DOES NOT WORK – The button is missing/);
  assert.equal(read()[0].status, 'open');
  const hook = JSON.parse(run(['hook'], JSON.stringify({ prompt: 'hej', cwd: '/tmp' })).stdout).hookSpecificOutput.additionalContext;
  assert.match(hook, /NOT working, not yet answered by the user[^\n]*\nK1 /);
  assert.equal(run(['tried', 'K1', 'works']).status, 0);
  assert.equal(read()[0].tried.verdict, 'works');
});

test('undo restores only the points it touched', () => {
  const items = addPoints([], [point('Start', 'A'), point('Start', 'B')]);
  const now = [withStatus(items[0], 'ok', 'user'), withStatus(items[1], 'bad', 'user', 'x')];
  assert.deepEqual(restoreItems(now, [items[0]]).map(one => one.status), ['open', 'bad']);
});

test('the tab opens on the first group with something left to check', () => {
  const items = addPoints([], [point('Start', 'A'), point('Robotar', 'B'), point('Bygg', 'C')]);
  items[0] = withStatus(items[0], 'ok', 'user');
  assert.deepEqual([...foldedAtStart(items)], ['Start', 'Bygg']);
});

test('a list run in its own project folder, without KONTROLL_FILE, is that folder\'s kontroll.jsonl', () => {
  const { dir } = project();
  const source = path.join(dir, 'points.json');
  fs.writeFileSync(source, JSON.stringify([point('Start', 'A')]));
  const run = spawnSync(process.execPath, [SCRIPT, 'add', source], { cwd: dir, encoding: 'utf8', env: { ...process.env, KONTROLL_FILE: '', HERDR_ENV: '' } });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'kontroll.jsonl')));
});
