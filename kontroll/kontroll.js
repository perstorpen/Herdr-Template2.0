#!/usr/bin/env node
'use strict';
// The "Kontroll" tab in herdr: points the user walks through to check the system being built, one per thing they can
// check. Every change a chat makes to what people see or do is tied to points, so the user sees what was done and what
// to check, answers each one in the tab, and the chats read the answers.
//
// The list belongs to the project: <project>/kontroll.jsonl, where the project is the git top level of the folder the
// chat or the tab runs in, or that folder itself outside git. KONTROLL_FILE overrides it.
//
//   kontroll.js ui                 the list itself, running in the tab (started in the project folder)
//   kontroll.js hook               UserPromptSubmit hook: hands the chat the list's state and its rules
//   kontroll.js tab <project>      makes sure the tab runs (started by the hook)
//   kontroll.js list [group]       prints the points, for an agent
//   kontroll.js show K3 K4         prints points with everything said about them
//   kontroll.js add points.json    adds points: [{ group, sub, title, done, check, update }]
//   kontroll.js retext texts.json rewrites the texts of points that exist: [{ num, group, sub, title, done, check }]
//   kontroll.js tried K3 works|broken|yours "text"   an agent has clicked through the point before the user does:
//                                  it works as written, it does not, or only the user can judge it. Never an answer.
//   kontroll.js fixed K3 "text"    blue: a point the user marked wrong has been fixed, with what was changed
//   kontroll.js ok K3              green, and
//   kontroll.js bad K3 "text"      red: only when the user's own message says so. Otherwise they click in the tab.
//
// A point is white until the user has checked it. The user decides what is good, so an agent can only add points and
// say that a red one is fixed:
//   (white)  not checked          (green)  the user: good
//   (red)    the user: wrong, with their words        (blue)  an agent: fixed, check again
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const FILE_NAME = 'kontroll.jsonl';
const TAB_LABEL = 'Kontroll';
const LOCK_STALE_MS = 3000;

// The project a folder belongs to: the git top level when the folder is inside a repo, else the folder itself, so a
// chat working in a subfolder finds the same list.
function projectOf(dir) {
  const folder = path.resolve(dir || process.cwd());
  const git = spawnSync('git', ['-C', folder, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return git.status === 0 && git.stdout.trim() ? git.stdout.trim() : folder;
}

// The list lives in the project's own folder, so it goes with the project in git and every computer and colleague
// on it sees the same points. One point per line, so that two people's changes merge line by line.
const listFileFor = dir => process.env.KONTROLL_FILE || path.join(projectOf(dir), FILE_NAME);

// Set once per run: the hook sets it from the chat's folder, every other command uses the folder it runs in.
let LIST_FILE = listFileFor(process.cwd());
let LOCK_FILE = `${LIST_FILE}.lock`;
function useListOf(dir) {
  LIST_FILE = listFileFor(dir);
  LOCK_FILE = `${LIST_FILE}.lock`;
}

// ---- The list file ----

function readItems() {
  try {
    return fs.readFileSync(LIST_FILE, 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function takeLock() {
  for (;;) {
    try {
      fs.closeSync(fs.openSync(LOCK_FILE, 'wx'));
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const isStale = Date.now() - fs.statSync(LOCK_FILE, { throwIfNoEntry: false })?.mtimeMs > LOCK_STALE_MS;
      if (isStale) fs.rmSync(LOCK_FILE, { force: true });
      else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}

// Tab, hook and agents' commands are separate processes, so each change reads and writes under the lock.
function changeItems(change) {
  fs.mkdirSync(path.dirname(LIST_FILE), { recursive: true });
  takeLock();
  try {
    const items = change(readItems());
    const temporary = `${LIST_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, items.map(one => JSON.stringify(one)).join('\n') + '\n');
    fs.renameSync(temporary, LIST_FILE);
    return items;
  } finally {
    fs.rmSync(LOCK_FILE, { force: true });
  }
}

const statusOf = item => item.status ?? 'open';

// Every answer is kept in the point's log, so a point that was wrong, fixed and wrong again shows all of it.
function withStatus(item, status, who, text = '') {
  const entry = { at: Date.now(), who, status, ...(text ? { text } : {}) };
  return { ...item, status, log: [...(item.log ?? []), entry], changedAt: entry.at };
}

const lastText = (item, status) => (item.log ?? []).findLast(one => one.status === status && one.text)?.text ?? '';

// A point keeps its number for good, and a number is never used again.
function addPoints(items, points, now = new Date()) {
  let highest = Math.max(0, ...items.map(one => one.num));
  const today = now.toISOString().slice(0, 10);
  const added = points.map(point => ({
    num: ++highest,
    group: point.group.trim(),
    sub: (point.sub ?? '').trim(),
    title: point.title.trim(),
    done: (point.done ?? '').trim(),
    check: point.check.trim(),
    update: (point.update ?? today).trim(),
    status: 'open',
    log: [],
    changedAt: now.getTime(),
  }));
  return [...items, ...added];
}

function checkPoints(points) {
  const isText = value => typeof value === 'string' && value.trim();
  if (!Array.isArray(points) || !points.length) throw new Error('The file must hold a JSON array of points.');
  points.forEach((point, index) => {
    for (const field of ['group', 'title', 'check']) {
      if (!isText(point?.[field])) throw new Error(`Point ${index + 1} has no "${field}".`);
    }
  });
}

// The groups are the system's own top-level areas, in the order they were first given, each with its points in number order.
function inGroups(items) {
  const groups = new Map();
  for (const item of [...items].sort((a, b) => a.num - b.num)) {
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push(item);
  }
  return [...groups].map(([name, points]) => ({ name, points }));
}

const countOf = items => {
  const count = { open: 0, ok: 0, bad: 0, fixed: 0 };
  for (const item of items) count[statusOf(item)] += 1;
  return count;
};

// ---- What an agent reads ----

// What an agent found when it went through a point (a browser test or by hand), before the user looks. It is a note
// beside the point, not an answer: the colour is still the user's.
const TRIED_WORDS = { works: 'works as written', broken: 'DOES NOT WORK', yours: 'only you can judge' };
const TRIED_WORDS_SV = { works: 'fungerar som det står', broken: 'FUNGERAR INTE', yours: 'bara du kan avgöra' };
const triedLineSv = item => (item.tried ? `Provad av en agent (${new Date(item.tried.at).toLocaleString('sv-SE').slice(0, 16)}): ${TRIED_WORDS_SV[item.tried.verdict]}${item.tried.text ? ` – ${item.tried.text}` : ''}` : '');
const triedLine = item => (item.tried ? `Tried by an agent (${new Date(item.tried.at).toLocaleString('sv-SE').slice(0, 16)}): ${TRIED_WORDS[item.tried.verdict]}${item.tried.text ? ` – ${item.tried.text}` : ''}` : '');

const STATUS_WORDS = { open: 'not checked', ok: 'good', bad: 'WRONG', fixed: 'fixed, waiting for the user' };

function describeItem(item, isFull = true) {
  const where = item.sub ? `${item.group} › ${item.sub}` : item.group;
  const lines = [`K${item.num} [${STATUS_WORDS[statusOf(item)]}] ${where}: ${item.title}`];
  if (!isFull) return lines[0];
  if (item.done) lines.push(`      Done (${item.update}): ${item.done}`);
  lines.push(`      Check: ${item.check}`);
  if (item.tried) lines.push(`      ${triedLine(item)}`);
  if (statusOf(item) === 'bad') lines.push(`      The user: ${lastText(item, 'bad') || '(no words, ask them what was wrong)'}`);
  if (statusOf(item) === 'fixed') {
    if (lastText(item, 'bad')) lines.push(`      The user said: ${lastText(item, 'bad')}`);
    lines.push(`      Fixed: ${lastText(item, 'fixed')}`);
  }
  return lines.join('\n');
}

function describeList(group) {
  const items = readItems().filter(one => !group || one.group.toLowerCase() === group.toLowerCase());
  return inGroups(items).map(one => `## ${one.name}\n${one.points.map(point => describeItem(point)).join('\n')}`).join('\n\n');
}

const numbersIn = text => [...text.matchAll(/\bK\s?(\d+)\b/gi)].map(match => Number(match[1]));

const RULES = me => `The rules for the check list:
- After a change to what people see or do in this project, add one point per thing the user can check, and end your report with the same points:
  ${me} add <file.json>     the file: [{ "group": "<the system's top-level area, as in the list>", "sub": "<page or part>", "title": "<short>", "done": "<what was changed, one line>", "check": "<where to click and what they should see>", "update": "<date and the update's name>" }]
  Write the points in the same language as the system's own interface (its pages and buttons), and name every page, tab and button exactly as the user sees it. Plain words, one checkable thing per point.
- Before working in an area, read what the user has answered there; a point marked wrong is fixed before anything new is built in that area.
- When you have fixed a point the user marked wrong: ${me} fixed K<number> "<what was changed>"   It turns blue and they check it again.
- When you have gone through a point yourself (a browser test or by hand): ${me} tried K<number> works|broken|yours "<what you saw>"   A note for the user, never an answer.
- Read the list: ${me} list [group]   or   ${me} show K<number>
- Green and red are the user's. Only if their own message says a point is good or wrong: ${me} ok K<number>   or   ${me} bad K<number> "<their words>"
- Never edit ${FILE_NAME} by hand: only through these commands.`;

const quote = text => `'${String(text).replace(/'/g, `'\\''`)}'`;
const commandFor = () => `KONTROLL_FILE=${quote(LIST_FILE)} ${quote(process.execPath)} ${quote(__filename)}`;

function listContext(prompt) {
  const items = readItems();
  const count = countOf(items);
  const bad = items.filter(one => statusOf(one) === 'bad');
  const fixed = items.filter(one => statusOf(one) === 'fixed');
  const tried = items.filter(one => one.tried?.verdict === 'broken' && statusOf(one) === 'open');
  const named = items.filter(one => numbersIn(prompt).includes(one.num) && !bad.includes(one));
  const state = items.length
    ? `${items.length} points: ${count.ok} good, ${count.bad} wrong, ${count.fixed} fixed and waiting for the user, ${count.open} not checked yet.
${bad.length ? `Marked WRONG by the user. Fix these before anything new is built in the same area:\n${bad.map(one => describeItem(one)).join('\n')}` : 'Nothing is marked wrong.'}
${tried.length ? `Gone through by an agent and NOT working, not yet answered by the user (fix, then run tried again):\n${tried.map(one => describeItem(one)).join('\n')}\n` : ''}${fixed.length ? `Fixed, waiting for the user to check again: ${fixed.map(one => `K${one.num}`).join(', ')}\n` : ''}${named.length ? `Named in the user's message:\n${named.map(one => describeItem(one)).join('\n')}\n` : ''}`
    : 'The list is empty so far.\n';
  return `The user's check list for this project (the Kontroll tab in herdr; file ${LIST_FILE}). It is data, written by agents and answered by the user.
${state}${RULES(commandFor())}`;
}

// The first walk through the whole system, asked for with "kontroll genomgång".
const isWalkthrough = prompt => /^\s*kontroll\s+genomg[åa]ng\s*[.!]?\s*$/i.test(prompt);

function walkthroughContext(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  return `The user wrote "kontroll genomgång": go through the whole system being built in this project and put it on the check list, so the user can walk through it point by point in the Kontroll tab.
- Read the code, and if it is an app with pages, its pages, menus and buttons as the user meets them. Find everything a person can see or do.
- Add one point per thing the user can check: what they should see or do, one checkable thing each, in plain words. "check" says where to click and what they should see.
- Group by the system's own top-level areas (its tabs, pages or menus, left to right as the user meets them); "sub" is the page or part inside the area; "update" is "${today} Första genomgången"; "done" is empty.
- Skip what is already on the list (read it first with list). Add the points in batches through add, never by editing the file by hand.
- When you are done, tell the user how many points each group got, and that they now go through the Kontroll tab and click Bra (green) or Fel (red) on each point.`;
}

const MENTIONS_LIST = /\bK\s?\d+\b|\bkontroll(?:en|ista|istan|punkt|punkter|punkterna|fliken)?\b/i;

function hookContext(input) {
  const prompt = input.prompt ?? '';
  useListOf(input.cwd);
  const walkthrough = isWalkthrough(prompt);
  const hasList = fs.existsSync(LIST_FILE);
  if (!hasList && !walkthrough && !MENTIONS_LIST.test(prompt)) return null;
  const context = listContext(prompt);
  return walkthrough ? `${walkthroughContext()}\n\n${context}` : context;
}

function runHook() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const context = hookContext(input);
  if (!context) return;
  spawn(process.execPath, [__filename, 'tab', path.dirname(LIST_FILE)], { detached: true, stdio: 'ignore' }).unref();
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } }));
}

// ---- Keeping the tab alive ----

function herdr(...args) {
  const run = spawnSync(process.env.HERDR_BIN_PATH || 'herdr', args, { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`herdr ${args.join(' ')}: ${run.stderr || run.error}`);
  return run.stdout.trim() ? JSON.parse(run.stdout).result : null;
}

// The tab goes last in the chat's own space, and runs the list in the project's folder.
function ensureTab(project) {
  if (process.env.HERDR_ENV !== '1') return;
  const start = `cd '${String(project).replace(/'/g, `'\\''`)}' && exec '${process.execPath}' '${__filename}' ui`;
  const space = process.env.HERDR_WORKSPACE_ID;
  const tab = herdr('tab', 'list').tabs.find(one => one.label === TAB_LABEL && (!space || one.workspace_id === space));
  if (!tab) {
    const created = herdr('tab', 'create', ...(space ? ['--workspace', space] : []), '--cwd', project, '--label', TAB_LABEL, '--no-focus');
    herdr('pane', 'run', created.root_pane.pane_id, start);
    return;
  }
  // After a herdr restart the tab can be back with a bare shell in it. The list sets this title while it runs.
  const pane = herdr('pane', 'list', '--workspace', tab.workspace_id).panes.find(one => one.tab_id === tab.tab_id);
  if (pane && pane.terminal_title !== TAB_LABEL) herdr('pane', 'run', pane.pane_id, start);
}

// ---- The list in the tab ----

function wrap(text, width) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (line && line.length + 1 + word.length > width) {
        lines.push(line);
        line = '';
      }
      let rest = line ? `${line} ${word}` : word;
      while (rest.length > width) {
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

const STYLE = {
  reset: '\x1b[0m',
  title: '\x1b[1m',
  group: '\x1b[1;96m',
  open: '\x1b[97m',
  ok: '\x1b[92m',
  bad: '\x1b[91m',
  fixed: '\x1b[94m',
  dim: '\x1b[2m',
};
const BOXES = { open: '[ ]', ok: '[✓]', bad: '[✗]', fixed: '[?]' };
const ANSWER_BUTTONS = [
  { status: 'ok', label: 'Bra', style: '\x1b[30;102m' },
  { status: 'bad', label: 'Fel', style: '\x1b[97;101m' },
  { status: 'open', label: 'Inte kollad', style: '\x1b[30;107m' },
];
const FIRST_LIST_ROW = 4;

// Undo restores only the points the action touched, so it doesn't take back what agents have added or fixed since.
function restoreItems(items, before) {
  const earlier = new Map(before.map(one => [one.num, one]));
  return items.map(one => (earlier.has(one.num) ? { ...earlier.get(one.num), changedAt: Date.now() } : one));
}

// At the start every group is folded but the first one with something left to check, so the walk begins where the user is.
function foldedAtStart(items) {
  const groups = inGroups(items);
  const current = groups.find(one => one.points.some(point => statusOf(point) !== 'ok')) ?? groups[0];
  return new Set(groups.filter(one => one !== current).map(one => one.name));
}

function runUi() {
  let items = readItems();
  const folded = foldedAtStart(items);
  let selected = null;
  let scroll = 0;
  let rowToTarget = new Map();
  let pickerOpen = false;
  let pickerChoice = 0;
  let pickerRow = null;
  let pickerHits = [];
  let typing = null; // the words of a "Fel" being typed: { num, text }
  let notice = '';
  const undoSteps = [];

  const visible = () => inGroups(items).flatMap(group => (folded.has(group.name) ? [] : group.points));

  function moveSelection(step) {
    const points = visible();
    if (!points.length) return;
    const at = points.findIndex(one => one.num === selected);
    selected = points[at === -1 ? 0 : Math.max(0, Math.min(points.length - 1, at + step))].num;
  }

  function draw() {
    const columns = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    const count = countOf(items);
    const numberWidth = String(Math.max(0, ...items.map(one => one.num))).length + 1;
    const leadWidth = numberWidth + 8; // "› [ ] K12  "
    const textWidth = Math.max(10, columns - leadWidth - 2);

    const body = [];
    for (const group of inGroups(items)) {
      const own = countOf(group.points);
      const summary = `${own.ok}/${group.points.length} bra${own.bad ? `, ${own.bad} fel` : ''}${own.fixed ? `, ${own.fixed} att kolla igen` : ''}`;
      const arrow = folded.has(group.name) ? '▸' : '▾';
      body.push({ group: group.name, text: `${STYLE.group} ${arrow} ${group.name}${STYLE.reset}${STYLE.dim}   ${summary}${STYLE.reset}` });
      if (folded.has(group.name)) continue;
      let sub = null;
      for (const item of group.points) {
        if (item.sub && item.sub !== sub) body.push({ text: `${STYLE.dim}${' '.repeat(leadWidth)}${item.sub}${STYLE.reset}` });
        sub = item.sub;
        const style = STYLE[statusOf(item)];
        const mark = item.tried ? { works: '  · provad: fungerar', broken: '  · provad: FUNGERAR INTE', yours: '  · provad: du får avgöra' }[item.tried.verdict] : '';
        wrap(item.title + mark, textWidth).forEach((line, index) => {
          const marker = item.num === selected ? '›' : ' ';
          const lead = index === 0 ? `${marker} ${BOXES[statusOf(item)]} ${`K${item.num}`.padEnd(numberWidth)}  ` : ' '.repeat(leadWidth);
          body.push({ num: item.num, text: `${style}${lead}${line}${STYLE.reset}` });
        });
        if (!(pickerOpen && item.num === selected)) continue;
        const detail = (text, style = STYLE.dim) => {
          for (const line of wrap(text, textWidth)) body.push({ num: item.num, text: `${style}${' '.repeat(leadWidth)}${line}${STYLE.reset}` });
        };
        if (item.done) detail(`Gjort (${item.update}): ${item.done}`);
        detail(`Kolla: ${item.check}`, STYLE.open);
        if (item.tried) detail(triedLineSv(item), item.tried.verdict === 'broken' ? STYLE.bad : STYLE.dim);
        if (lastText(item, 'bad') && statusOf(item) !== 'ok') detail(`Du sa: ${lastText(item, 'bad')}`, STYLE.bad);
        if (statusOf(item) === 'fixed') detail(`Rättad: ${lastText(item, 'fixed')}`, STYLE.fixed);
        body.push({ picker: true, text: drawPicker(leadWidth) });
      }
    }

    const room = Math.max(1, rows - FIRST_LIST_ROW - 1);
    const pickerAt = body.findIndex(row => row.picker);
    if (pickerAt !== -1 && pickerAt >= scroll + room) scroll = pickerAt - room + 1;
    if (pickerAt !== -1 && pickerAt < scroll) scroll = pickerAt;
    scroll = Math.max(0, Math.min(scroll, body.length - room));

    rowToTarget = new Map();
    pickerRow = null;
    let out = '\x1b[?25l\x1b[H\x1b[2J';
    out += ` ${STYLE.title}Kontroll${STYLE.reset}${STYLE.dim}  ${count.open} inte kollade, ${count.fixed} att kolla igen, ${count.bad} fel, ${count.ok} bra${notice ? `  ·  ${notice}` : ''}${STYLE.reset}\r\n`;
    out += ` ${STYLE.open}Vit: inte kollad${STYLE.reset}  ${STYLE.ok}Grön: bra${STYLE.reset}  ${STYLE.bad}Röd: fel${STYLE.reset}  ${STYLE.fixed}Blå: rättad, kolla igen${STYLE.reset}\r\n\r\n`;
    if (!items.length) out += `${STYLE.dim}  Inga punkter än. Skriv kontroll genomgång i en chatt, så går Claude igenom systemet och lägger upp dem.${STYLE.reset}\r\n`;
    body.slice(scroll, scroll + room).forEach((row, index) => {
      if (row.picker) pickerRow = index + FIRST_LIST_ROW;
      else if (row.group || row.num) rowToTarget.set(index + FIRST_LIST_ROW, row);
      out += `${row.text}\r\n`;
    });

    if (typing) {
      const label = ` Vad var fel med K${typing.num}? (Enter sparar, Esc avbryter) › `;
      const shown = typing.text.slice(-Math.max(5, columns - label.length - 2));
      out += `\x1b[${rows};1H${STYLE.bad}${label}${STYLE.reset}${shown}\x1b[?25h`;
    } else {
      const hint = 'Klicka på en grupp för att öppna den, på en punkt för att svara. Ctrl+Z ångrar.';
      out += `\x1b[${rows};1H ${STYLE.dim}${hint.slice(0, columns - 2)}${STYLE.reset}`;
    }
    process.stdout.write(out);
  }

  function drawPicker(leadWidth) {
    pickerHits = [];
    let column = leadWidth + 1;
    let text = ' '.repeat(leadWidth);
    ANSWER_BUTTONS.forEach((button, index) => {
      const label = index === pickerChoice ? `›${button.label}‹` : ` ${button.label} `;
      pickerHits.push({ from: column, to: column + label.length - 1, status: button.status });
      text += `${button.style}${label}${STYLE.reset} `;
      column += label.length + 1;
    });
    return text;
  }

  function openPicker(num) {
    selected = num;
    pickerOpen = true;
    const at = ANSWER_BUTTONS.findIndex(button => button.status === statusOf(items.find(one => one.num === num)));
    pickerChoice = Math.max(0, at);
  }

  // Every answer the user gives in the tab goes through here, so that Ctrl+Z can take it back.
  function answer(num, status, text) {
    const before = [];
    items = changeItems(all =>
      all.map(one => {
        if (one.num !== num || (statusOf(one) === status && !text)) return one;
        before.push(one);
        return withStatus(one, status, 'user', text);
      }),
    );
    if (before.length) undoSteps.push(before);
    pickerOpen = false;
  }

  function choose(status) {
    if (status === 'bad') typing = { num: selected, text: '' };
    else answer(selected, status);
    draw();
  }

  function undo() {
    const before = undoSteps.pop();
    notice = before ? 'Ångrat' : 'Inget att ångra';
    if (before) items = changeItems(all => restoreItems(all, before));
    pickerOpen = false;
    draw();
  }

  function press(column, row) {
    if (row === pickerRow) {
      const hit = pickerHits.find(one => column >= one.from && column <= one.to);
      if (hit) choose(hit.status);
      return;
    }
    const target = rowToTarget.get(row);
    if (target?.group) {
      if (!folded.delete(target.group)) folded.add(target.group);
      pickerOpen = false;
    } else if (target && !(pickerOpen && target.num === selected)) openPicker(target.num);
    else pickerOpen = false;
  }

  function quit() {
    process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l');
    process.exit(0);
  }

  // While the user types what was wrong, the keys are their words. Dictated text arrives the same way.
  function onTyping(keys) {
    if (keys === '\x1b') typing = null;
    else if (keys.startsWith('\x1b')) return;
    else {
      for (const char of keys) {
        if (char === '\r' || char === '\n') {
          answer(typing.num, 'bad', typing.text.trim());
          typing = null;
          break;
        }
        if (char === '\x7f' || char === '\b') typing.text = typing.text.slice(0, -1);
        else if (char >= ' ') typing.text += char;
      }
    }
    draw();
  }

  function onInput(chunk) {
    const text = chunk.toString('utf8');
    notice = '';
    const keys = text.replace(/\x1b\[<\d+;\d+;\d+[Mm]/g, '');
    if (keys === '\x03') return quit();
    if (typing) return keys ? onTyping(keys) : undefined;
    for (const [, button, column, row, kind] of text.matchAll(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g)) {
      if (button === '64') scroll -= 3;
      else if (button === '65') scroll += 3;
      else if (button === '0' && kind === 'M') press(Number(column), Number(row));
    }
    if (typing) return draw();
    if (keys === '\x1a') return undo();
    if (keys === '\x1b') pickerOpen = false;
    if (keys === '\x1b[A' || keys === '\x1b[B') {
      pickerOpen = false;
      moveSelection(keys === '\x1b[A' ? -1 : 1);
    }
    if (pickerOpen && keys === '\x1b[D') pickerChoice = Math.max(0, pickerChoice - 1);
    if (pickerOpen && keys === '\x1b[C') pickerChoice = Math.min(ANSWER_BUTTONS.length - 1, pickerChoice + 1);
    if ((keys === ' ' || keys === '\r') && selected) {
      if (pickerOpen) return choose(ANSWER_BUTTONS[pickerChoice].status);
      openPicker(selected);
    }
    draw();
  }

  function reload() {
    try {
      items = readItems();
    } catch {
      // Written with a rename, so a read shouldn't see half a file. Keep what is on screen if one does.
    }
    draw();
  }

  process.stdout.write(`\x1b]2;${TAB_LABEL}\x07\x1b[?1049h\x1b[?1000h\x1b[?1006h`);
  process.stdin.setRawMode(true);
  process.stdin.on('data', onInput);
  process.stdout.on('resize', draw);
  process.on('SIGTERM', quit);
  process.on('SIGHUP', quit);
  // The file is replaced on every change, so watch its folder and not the file.
  fs.mkdirSync(path.dirname(LIST_FILE), { recursive: true });
  fs.watch(path.dirname(LIST_FILE), (_event, name) => {
    if (name === path.basename(LIST_FILE)) reload();
  });
  draw();
}

// ---- Agents' commands ----

function fail(message) {
  console.error(message);
  process.exit(1);
}

function runAdd(file) {
  if (!file) fail('Usage: kontroll.js add <file.json>');
  const points = JSON.parse(fs.readFileSync(file, 'utf8'));
  try {
    checkPoints(points);
  } catch (error) {
    fail(error.message);
  }
  const before = readItems().length;
  const items = changeItems(all => addPoints(all, points));
  console.log(items.slice(before).map(one => describeItem(one, false)).join('\n'));
}

// New words for points that exist (a translation, a page that was renamed). The user's answers and the log stay.
function runRetext(file) {
  if (!file) fail('Usage: kontroll.js retext <file.json>');
  const texts = new Map(JSON.parse(fs.readFileSync(file, 'utf8')).map(one => [one.num, one]));
  let changed = 0;
  changeItems(all =>
    all.map(one => {
      const text = texts.get(one.num);
      if (!text) return one;
      changed += 1;
      const next = { ...one };
      for (const field of ['group', 'sub', 'title', 'done', 'check']) {
        if (typeof text[field] === 'string' && (text[field].trim() || field === 'sub' || field === 'done')) next[field] = text[field].trim();
      }
      return next;
    }),
  );
  console.log(`${changed} points rewritten, ${texts.size - changed} numbers not on the list.`);
}

function runTried([name, verdict, ...words]) {
  const num = numbersIn(name ?? '')[0] ?? Number(name);
  const text = words.join(' ').trim();
  if (!(verdict in TRIED_WORDS)) fail('Usage: kontroll.js tried K<n> works|broken|yours "<what you saw>"');
  if (verdict !== 'works' && !text) fail('Say what you saw.');
  if (!readItems().some(one => one.num === num)) fail(`Not on the list: ${name}`);
  changeItems(all => all.map(one => (one.num === num ? { ...one, tried: { at: Date.now(), verdict, ...(text ? { text } : {}) }, changedAt: Date.now() } : one)));
  console.log(describeItem(readItems().find(one => one.num === num)));
}

// An agent may turn a red point blue. Green and red are the user's, set by their click or their own words.
const MARKS = { fixed: { from: ['bad'], who: 'agent' }, ok: { from: ['open', 'bad', 'fixed'], who: 'user' }, bad: { from: ['open', 'ok', 'fixed', 'bad'], who: 'user' } };

function runMark(status, [name, ...words]) {
  const num = numbersIn(name ?? '')[0] ?? Number(name);
  const text = words.join(' ').trim();
  const item = readItems().find(one => one.num === num);
  if (!item) fail(`Not on the list: ${name ?? '(no number)'}`);
  if (status !== 'ok' && !text) fail(`Say what ${status === 'fixed' ? 'was changed' : 'was wrong'}: kontroll.js ${status} K${num} "<text>"`);
  if (!MARKS[status].from.includes(statusOf(item))) {
    fail(`K${num} is "${STATUS_WORDS[statusOf(item)]}". ${status === 'fixed' ? 'Only a point the user marked wrong can be fixed.' : 'It is not changed.'}`);
  }
  changeItems(all => all.map(one => (one.num === num ? withStatus(one, status, MARKS[status].who, text) : one)));
  console.log(describeItem(readItems().find(one => one.num === num)));
}

function runShow(names) {
  const wanted = names.flatMap(name => numbersIn(name).concat(Number(name) || []));
  const items = readItems().filter(one => wanted.includes(one.num));
  if (!items.length) fail('Not on the list.');
  const logOf = item => (item.log ?? []).map(one => `      ${new Date(one.at).toLocaleString('sv-SE').slice(0, 16)} ${one.who}: ${STATUS_WORDS[one.status]}${one.text ? ` – ${one.text}` : ''}`).join('\n');
  console.log(items.map(one => `${describeItem(one)}${logOf(one) ? `\n${logOf(one)}` : ''}`).join('\n\n'));
}

module.exports = { addPoints, checkPoints, inGroups, countOf, withStatus, describeItem, numbersIn, restoreItems, foldedAtStart, wrap, projectOf, listFileFor, isWalkthrough, hookContext };

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'hook') runHook();
  else if (command === 'tab') ensureTab(args[0] || path.dirname(LIST_FILE));
  else if (command === 'ui') runUi();
  else if (command === 'list') console.log(describeList(args[0]));
  else if (command === 'show') runShow(args);
  else if (command === 'add') runAdd(args[0]);
  else if (command === 'retext') runRetext(args[0]);
  else if (command === 'tried') runTried(args);
  else if (command in MARKS) runMark(command, args);
  else fail('Usage: kontroll.js ui | hook | tab | list [group] | show K<n> … | add <file.json> | retext <file.json> | tried K<n> works|broken|yours "<text>" | fixed K<n> "<text>" | ok K<n> | bad K<n> "<text>"');
}
