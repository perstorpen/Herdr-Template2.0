#!/usr/bin/env node
'use strict';
// The "To Do List" tab in herdr.
//
//   todo.js hook      UserPromptSubmit hook: a prompt starting with "to do" goes on the list, not to the chat
//   todo.js worker    started by the hook: makes sure the tab runs, then tidies the new text into separate items
//   todo.js ui        the list itself, running in the tab
//   todo.js list      prints the list, for an agent
//   todo.js show 3    prints item 3 with its longer explanation, for an agent
//
// Each item has a short text and, when the model has tidied it, a longer explanation (`details`) that the tab shows
// when the item is clicked. The user can mark items purple; the prompt "do list" then makes the chat it is written to
// work on every purple item, and does nothing when there is none.
//
// An item is white until someone acts on it. In the tab the user can give an item any colour, and Ctrl+Z undoes what they
// did there. They decide what is finished, so an agent can only go as far as blue:
//   (purple)            only the user sets it in the tab: do this at the next "do list"
//   todo.js start 3     yellow: an agent is working on item 3
//   todo.js done 3      blue: the agent is finished, and the user has yet to check it
//   todo.js reopen 3    white again: the agent stopped without finishing
//   todo.js approve 3   green: finished. Only when the user says so, and otherwise they click the item in the tab
//
// The list is kept in the template's data folder: $HERDR_TEMPLATE_DATA, or ~/.claude/herdr-template.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const DATA_DIR = process.env.HERDR_TEMPLATE_DATA || path.join(os.homedir(), '.claude', 'herdr-template');
const LIST_FILE = process.env.TODO_FILE || path.join(DATA_DIR, 'todo-list.json');
const LOCK_FILE = `${LIST_FILE}.lock`;
const LOG_FILE = `${LIST_FILE}.log`;
const TAB_LABEL = 'To Do List';
const LOCK_STALE_MS = 3000;
const TIDY_TIMEOUT_MS = 90000;

// ---- The list file ----

const createdAt = item => parseInt(item.id.split('-')[0], 36);

// An item keeps its number for good, so "punkt 3" means the same thing tomorrow, and a number is never used
// again. If two items ever have the same number, the one that was added first keeps it.
function assignNumbers(items) {
  const oldestFirst = [...items].sort((a, b) => createdAt(a) - createdAt(b));
  const taken = new Set();
  const numbers = new Map();
  for (const item of oldestFirst) {
    if (item.num && !taken.has(item.num)) {
      taken.add(item.num);
      numbers.set(item.id, item.num);
    }
  }
  let highest = Math.max(0, ...taken);
  for (const item of oldestFirst) {
    if (!numbers.has(item.id) && !item.cleared) numbers.set(item.id, ++highest);
  }
  return items.map(item => (numbers.has(item.id) ? { ...item, num: numbers.get(item.id) } : item));
}

function readItems() {
  try {
    return assignNumbers(JSON.parse(fs.readFileSync(LIST_FILE, 'utf8')).items);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function waitBriefly() {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
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
      else waitBriefly();
    }
  }
}

// Hook, worker and tab are separate processes, so each change reads and writes under the lock.
function changeItems(change) {
  fs.mkdirSync(path.dirname(LIST_FILE), { recursive: true });
  takeLock();
  try {
    const items = assignNumbers(change(readItems()));
    const temporary = `${LIST_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ items }, null, 2) + '\n');
    fs.renameSync(temporary, LIST_FILE);
    return items;
  } finally {
    fs.rmSync(LOCK_FILE, { force: true });
  }
}

// `done` is the user's green. `state` is what an agent has said about an item that isn't green.
function statusOf(item) {
  return item.done ? 'green' : item.state ?? 'open';
}

function withStatus(item, status) {
  const { state, ...rest } = item;
  const agentState = ['working', 'ready', 'queued'].includes(status) ? { state: status } : {};
  return { ...rest, ...agentState, done: status === 'green', changedAt: Date.now() };
}

function newItem(text, details) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, text, ...(details ? { details } : {}), done: false, changedAt: Date.now() };
}

function log(message) {
  fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}\n`);
}

// ---- Recognising "to do" ----

// "to do-listan funkar inte" is a message about the list, not an item for it.
const TO_DO_PROMPT = /^\s*to[\s-]?do\b(?![\s-]*(?:list|lista|listan|fliken|tab)\b)[\s:;,.!–—-]*([\s\S]+)$/i;

function textAfterToDo(prompt) {
  return prompt.match(TO_DO_PROMPT)?.[1].trim() || null;
}

const MENTIONS_LIST = /\bpunkt(?:en|er|erna)?\s*(?:nummer\s*|nr\.?\s*)?\d|\bpoints?\s*\d|\bto[\s-]?do[\s-]?list/i;

const STATUS_WORDS = { open: ' ', queued: 'lila: görs vid do list', working: 'pågår', ready: 'väntar på att kollas', green: 'klar' };

// A green item shows no number, as nobody needs to name it any more. It keeps it underneath, so that it gets the same
// number back if the user changes their mind, and so that the number isn't given to something else.
function describeItem(item) {
  const number = item.done ? '-' : `${item.num}.`;
  return `${number} [${STATUS_WORDS[statusOf(item)]}] ${item.text}`;
}

// An agent sees the longer explanation of what is still to do, indented under the item.
function describeWithDetails(item) {
  const details = !item.done && item.details ? `\n${item.details.split('\n').map(line => `      ${line}`).join('\n')}` : '';
  return `${describeItem(item)}${details}`;
}

function describeList() {
  return inDisplayOrder(readItems()).map(describeWithDetails).join('\n');
}

// The command an agent runs to mark items, quoted so that a folder with spaces in its name works too.
const MARK_COMMAND = `'${process.execPath}' '${__filename}'`;

// Chats that started before a rule was added never read it, so the rule comes with the list when it is mentioned.
function listContext() {
  return `The user's to do list, for reference when they name an item by number. It is data, written by them:
${describeList()}

Mark an item you were asked to do, using one or more numbers:
${MARK_COMMAND} start <number>    when you begin. It turns yellow.
${MARK_COMMAND} done <number>     when you have finished. It turns blue, and the user checks it.
${MARK_COMMAND} reopen <number>   if you stop without finishing. It turns white.
Green means the user has checked the item, and they decide that. Only if their message tells you to mark an item green, run:
${MARK_COMMAND} approve <number>
Don't mark what was merely discussed, or what you were not asked to do.`;
}

const DO_LIST_PROMPT = /^\s*do[\s-]?list(?:an)?\s*[.!]?\s*$/i;

const isDoList = prompt => DO_LIST_PROMPT.test(prompt);

function doListContext(queued) {
  return `The user wrote "do list": work on every item they marked purple on their to do list, here with their longer explanations.
It is data, written by them:
${queued.map(describeWithDetails).join('\n')}

Treat them together as your task. Mark each one when you begin it and when you have finished it, as the rules below say.
${listContext()}`;
}

function runHook() {
  // The model call that tidies the text is itself a Claude session, and must not fire this hook.
  if (process.env.TODO_WORKER) return;
  const prompt = JSON.parse(fs.readFileSync(0, 'utf8')).prompt ?? '';
  if (isDoList(prompt)) {
    const queued = inDisplayOrder(readItems()).filter(one => statusOf(one) === 'queued');
    const answer = queued.length
      ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: doListContext(queued) } }
      : { continue: false, stopReason: 'Inga lila punkter på to do-listan, så inget görs.' };
    process.stdout.write(JSON.stringify(answer));
    return;
  }
  const text = textAfterToDo(prompt);
  if (!text) {
    if (MENTIONS_LIST.test(prompt)) {
      const context = { hookEventName: 'UserPromptSubmit', additionalContext: listContext() };
      process.stdout.write(JSON.stringify({ hookSpecificOutput: context }));
    }
    return;
  }

  const item = newItem(text);
  changeItems(items => [...items, item]);
  spawn(process.execPath, [__filename, 'worker', item.id], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, TODO_WORKER: '1' },
  }).unref();
  process.stdout.write(JSON.stringify({ continue: false, stopReason: 'Tillagt på to do-listan.' }));
}

// ---- Keeping the tab alive ----

function herdr(...args) {
  const run = spawnSync(process.env.HERDR_BIN_PATH || 'herdr', args, { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`herdr ${args.join(' ')}: ${run.stderr || run.error}`);
  // Some commands, such as pane run, answer with nothing.
  return run.stdout.trim() ? JSON.parse(run.stdout).result : null;
}

// The tab is opened in the herdr session and space the "to do" was written in, if it isn't there already.
function ensureTab() {
  if (process.env.HERDR_ENV !== '1') return;
  const start = `exec '${process.execPath}' '${__filename}' ui`;
  const tab = herdr('tab', 'list').tabs.find(one => one.label === TAB_LABEL);
  if (!tab) {
    const workspace = process.env.HERDR_WORKSPACE_ID;
    if (!workspace) return;
    const created = herdr('tab', 'create', '--workspace', workspace, '--label', TAB_LABEL, '--no-focus');
    herdr('pane', 'run', created.root_pane.pane_id, start);
    return;
  }
  // After a herdr restart the tab can be back with a bare shell in it. The list sets this title while it runs.
  const pane = herdr('pane', 'list', '--workspace', tab.workspace_id).panes.find(one => one.tab_id === tab.tab_id);
  if (pane && pane.terminal_title !== TAB_LABEL) herdr('pane', 'run', pane.pane_id, start);
}

// ---- Tidying voice-typed text into items ----

const TIDY_PROMPT = `Texten mellan <text>-taggarna är skriven eller dikterad och ska bli punkter på en att göra-lista för
AI-agenter som arbetar i ett projekt.
Dela upp den i en punkt per sak som ska göras. För varje punkt:
- "text": en kort summering, rakt på sak, som "Fixa scrollen på telefonen".
- "details": en längre förklaring i hela meningar av vad som ska göras, med allt texten säger om just den punkten: var, varför,
  hur det ska bete sig och vad som ska undvikas. Den ska ge en agent så mycket att gå på som möjligt, men lägg inte till något
  som inte står i texten och gissa inte. Säger texten inget mer än summeringen, skriv det som står med andra ord.
Rätta stavfel, ta bort fyllnadsord och behåll språket.
Svara bara med en JSON-array av objekt med "text" och "details", inget annat.

<text>
`;

// Each tidied item is { text, details }. A plain string, as the model used to answer, is an item without details.
function parseTidied(reply) {
  const items = JSON.parse(reply.slice(reply.indexOf('['), reply.lastIndexOf(']') + 1));
  const asItem = one => (typeof one === 'string' ? { text: one } : one);
  const isUsable = Array.isArray(items) && items.length > 0 &&
    items.map(asItem).every(one => one && typeof one.text === 'string' && one.text.trim() &&
      (one.details === undefined || typeof one.details === 'string'));
  if (!isUsable) throw new Error(`unusable reply: ${reply}`);
  return items.map(asItem).map(one => ({ text: one.text.trim(), details: one.details?.trim() || '' }));
}

function tidyItem(id) {
  const item = readItems().find(one => one.id === id);
  if (!item) return;
  const run = spawnSync(
    'claude',
    ['-p', '--model', 'haiku', '--no-session-persistence', '--strict-mcp-config', '--tools', '', '--setting-sources', ''],
    { input: `${TIDY_PROMPT}${item.text}\n</text>`, encoding: 'utf8', timeout: TIDY_TIMEOUT_MS, cwd: os.tmpdir() },
  );
  if (run.status !== 0) throw new Error(`claude -p failed: ${run.stderr || run.error}`);
  const tidied = parseTidied(run.stdout);
  // The item may have been marked while the model was working. Then it stays as it is.
  // The first tidied item takes over the number the user has already seen.
  changeItems(items =>
    items.flatMap(one => {
      if (one.id !== id || statusOf(one) !== 'open') return [one];
      const { num, ...original } = one;
      const [first, ...rest] = tidied.map(one => newItem(one.text, one.details));
      return [{ ...original, cleared: true, changedAt: Date.now() }, { ...first, num }, ...rest];
    }),
  );
}

function runWorker(id) {
  // If tidying fails the item stays on the list as it was typed, so nothing is lost.
  for (const step of [ensureTab, () => tidyItem(id)]) {
    try {
      step();
    } catch (error) {
      log(error.stack);
    }
  }
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

// What still needs doing on top, then what the user has to check, each in number order, then what is finished,
// the latest turned green first. A green item's changedAt is when it turned green.
const DISPLAY_RANK = { open: 0, queued: 0, working: 0, ready: 1, green: 2 };
const greenAt = item => item.changedAt ?? createdAt(item);

function inDisplayOrder(items) {
  return items
    .filter(one => !one.cleared)
    .sort((a, b) =>
      DISPLAY_RANK[statusOf(a)] - DISPLAY_RANK[statusOf(b)] ||
      (a.done && b.done ? greenAt(b) - greenAt(a) || (b.num ?? 0) - (a.num ?? 0) : (a.num ?? 0) - (b.num ?? 0)));
}

const STYLE = {
  reset: '\x1b[0m',
  title: '\x1b[1m',
  open: '\x1b[97m',
  working: '\x1b[93m',
  ready: '\x1b[94m',
  queued: '\x1b[95m',
  green: '\x1b[92m',
  dim: '\x1b[2m',
  button: '\x1b[7m',
};
const BOXES = { open: '[ ]', queued: '[▸]', working: '[…]', ready: '[?]', green: '[✓]' };
const COLOUR_BUTTONS = [
  { status: 'open', label: 'Vit', style: '\x1b[30;107m' },
  { status: 'queued', label: 'Lila', style: '\x1b[97;105m' },
  { status: 'working', label: 'Gul', style: '\x1b[30;103m' },
  { status: 'ready', label: 'Blå', style: '\x1b[97;104m' },
  { status: 'green', label: 'Grön', style: '\x1b[30;102m' },
];
const CLEAR_LABEL = ' Rensa klara ';
const FIRST_LIST_ROW = 4;

// Undo restores only the items the action touched, so it doesn't take back what agents have marked since.
function restoreItems(items, before) {
  const earlier = new Map(before.map(one => [one.id, one]));
  return items.map(one => (earlier.has(one.id) ? { ...earlier.get(one.id), changedAt: Date.now() } : one));
}

function runUi() {
  let items = readItems();
  let selectedId = null;
  let scroll = 0;
  let rowToId = new Map();
  let clearButton = null;
  let pickerOpen = false;
  let pickerChoice = 0;
  let pickerRow = null;
  let pickerHits = [];
  let notice = '';
  const undoSteps = [];

  function moveSelection(step) {
    const ordered = inDisplayOrder(items);
    if (!ordered.length) return;
    const at = ordered.findIndex(one => one.id === selectedId);
    const next = at === -1 ? 0 : Math.max(0, Math.min(ordered.length - 1, at + step));
    selectedId = ordered[next].id;
  }

  function draw() {
    const columns = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    const ordered = inDisplayOrder(items);
    const count = (...statuses) => ordered.filter(one => statuses.includes(statusOf(one))).length;
    const left = count('open', 'queued', 'working');
    const toCheck = count('ready');
    const finished = count('green');

    const numbered = ordered.filter(one => !one.done);
    const numberWidth = String(Math.max(0, ...numbered.map(one => one.num ?? 0))).length;
    const leadWidth = numberWidth + 9; // "› [ ]  3. "

    const body = [];
    for (const item of ordered) {
      const style = STYLE[statusOf(item)];
      const box = BOXES[statusOf(item)];
      const number = item.done ? ' '.repeat(numberWidth + 1) : `${String(item.num ?? '').padStart(numberWidth)}.`;
      wrap(item.text, Math.max(10, columns - leadWidth - 2)).forEach((line, index) => {
        const marker = item.id === selectedId ? '›' : ' ';
        const lead = index === 0 ? `${marker} ${box}  ${number} ` : ' '.repeat(leadWidth);
        body.push({ id: item.id, text: `${style}${lead}${line}${STYLE.reset}` });
      });
      if (pickerOpen && item.id === selectedId) {
        const details = item.details || 'Ingen längre förklaring.';
        for (const line of wrap(details, Math.max(10, columns - leadWidth - 2))) {
          body.push({ id: item.id, text: `${STYLE.dim}${' '.repeat(leadWidth)}${line}${STYLE.reset}` });
        }
        body.push({ picker: true, text: drawPicker(leadWidth) });
      }
    }

    const room = Math.max(1, rows - FIRST_LIST_ROW - 1);
    const pickerAt = body.findIndex(row => row.picker);
    if (pickerAt !== -1 && pickerAt >= scroll + room) scroll = pickerAt - room + 1;
    if (pickerAt !== -1 && pickerAt < scroll) scroll = pickerAt;
    scroll = Math.max(0, Math.min(scroll, body.length - room));
    const shown = body.slice(scroll, scroll + room);

    rowToId = new Map();
    pickerRow = null;
    let out = '\x1b[?25l\x1b[H\x1b[2J';
    out += ` ${STYLE.title}${TAB_LABEL}${STYLE.reset}${STYLE.dim}  ${left} kvar, ${toCheck} att kolla${notice ? `  ·  ${notice}` : ''}${STYLE.reset}\r\n`;
    out += ` ${STYLE.queued}Lila: do list${STYLE.reset}  ${STYLE.working}Gul: pågår${STYLE.reset}  ${STYLE.ready}Blå: agenten klar${STYLE.reset}  ${STYLE.green}Grön: godkänd${STYLE.reset}\r\n\r\n`;
    if (!ordered.length) out += `${STYLE.dim}  Inget att göra. Skriv "to do" och vad som ska göras i en chatt.${STYLE.reset}\r\n`;
    shown.forEach((row, index) => {
      if (row.picker) pickerRow = index + FIRST_LIST_ROW;
      else rowToId.set(index + FIRST_LIST_ROW, row.id);
      out += `${row.text}\r\n`;
    });

    const hint = 'Klicka på en punkt för förklaring och färg. Ctrl+Z ångrar.';
    out += `\x1b[${rows};1H ${STYLE.dim}${hint.slice(0, columns - 2)}${STYLE.reset}`;
    clearButton = null;
    if (finished && columns >= hint.length + CLEAR_LABEL.length + 4) {
      const column = columns - CLEAR_LABEL.length;
      clearButton = { row: rows, from: column, to: column + CLEAR_LABEL.length - 1 };
      out += `\x1b[${rows};${column}H${STYLE.button}${CLEAR_LABEL}${STYLE.reset}`;
    }
    process.stdout.write(out);
  }

  function drawPicker(leadWidth) {
    pickerHits = [];
    let column = leadWidth + 1;
    let text = ' '.repeat(leadWidth);
    COLOUR_BUTTONS.forEach((button, index) => {
      const label = index === pickerChoice ? `›${button.label}‹` : ` ${button.label} `;
      pickerHits.push({ from: column, to: column + label.length - 1, status: button.status });
      text += `${button.style}${label}${STYLE.reset} `;
      column += label.length + 1;
    });
    return text;
  }

  function openPicker(id) {
    selectedId = id;
    pickerOpen = true;
    const item = items.find(one => one.id === id);
    pickerChoice = COLOUR_BUTTONS.findIndex(button => button.status === statusOf(item));
  }

  // Every change the user makes in the tab goes through here, so that Ctrl+Z can take it back.
  function changeAndRemember(change) {
    const before = [];
    items = changeItems(all =>
      all.map(one => {
        const changed = change(one);
        if (changed !== one) before.push(one);
        return changed;
      }),
    );
    if (before.length) undoSteps.push(before);
  }

  function setColour(id, status) {
    changeAndRemember(one => (one.id === id && statusOf(one) !== status ? withStatus(one, status) : one));
    pickerOpen = false;
    draw();
  }

  function clearFinished() {
    changeAndRemember(one => (one.done && !one.cleared ? { ...one, cleared: true, changedAt: Date.now() } : one));
    if (!inDisplayOrder(items).some(one => one.id === selectedId)) selectedId = null;
    pickerOpen = false;
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
    const isClear = clearButton && row === clearButton.row && column >= clearButton.from && column <= clearButton.to;
    if (isClear) return clearFinished();
    if (row === pickerRow) {
      const hit = pickerHits.find(one => column >= one.from && column <= one.to);
      if (hit) setColour(selectedId, hit.status);
      return;
    }
    const id = rowToId.get(row);
    if (id && !(pickerOpen && id === selectedId)) openPicker(id);
    else pickerOpen = false;
  }

  function quit() {
    process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l');
    process.exit(0);
  }

  function onInput(chunk) {
    const text = chunk.toString('utf8');
    notice = '';
    for (const [, button, column, row, kind] of text.matchAll(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g)) {
      if (button === '64') scroll -= 3;
      else if (button === '65') scroll += 3;
      else if (button === '0' && kind === 'M') press(Number(column), Number(row));
    }
    const keys = text.replace(/\x1b\[<\d+;\d+;\d+[Mm]/g, '');
    if (keys === '\x03') return quit();
    if (keys === '\x1a') return undo();
    if (keys === '\x1b') pickerOpen = false;
    if (keys === '\x1b[A' || keys === '\x1b[B') {
      pickerOpen = false;
      moveSelection(keys === '\x1b[A' ? -1 : 1);
    }
    if (pickerOpen && keys === '\x1b[D') pickerChoice = Math.max(0, pickerChoice - 1);
    if (pickerOpen && keys === '\x1b[C') pickerChoice = Math.min(COLOUR_BUTTONS.length - 1, pickerChoice + 1);
    if ((keys === ' ' || keys === '\r') && selectedId) {
      if (pickerOpen) return setColour(selectedId, COLOUR_BUTTONS[pickerChoice].status);
      openPicker(selectedId);
    }
    draw();
  }

  function reload() {
    try {
      items = readItems();
    } catch (error) {
      // Written with a rename, so a read shouldn't see half a file. Keep what is on screen if one does.
      log(error.stack);
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

function runShow(numbers) {
  const items = readItems().filter(one => !one.cleared && numbers.map(Number).includes(one.num));
  if (!items.length) {
    console.error('Finns inte på listan.');
    process.exit(1);
  }
  console.log(items.map(one => `${describeItem(one)}\n${one.details || '(ingen längre förklaring)'}`).join('\n\n'));
}

const MARKS = { start: 'working', done: 'ready', reopen: 'open', approve: 'green' };

function runMark(command, numbers) {
  const status = MARKS[command];
  const wanted = numbers.map(Number);
  const items = readItems();
  const unknown = wanted.filter(num => !items.some(one => one.num === num && !one.cleared));
  if (!wanted.length || unknown.length) {
    console.error(wanted.length ? `Finns inte på listan: ${unknown.join(', ')}` : 'Ange vilka nummer det gäller.');
    process.exit(1);
  }
  // Green is the user's mark, so only their word can set it and no agent can take it away.
  const isKept = one => one.done && status !== 'green';
  const kept = items.filter(one => wanted.includes(one.num) && !one.cleared && isKept(one)).map(one => one.num);
  if (kept.length) console.log(`Redan grön, så den ändras inte: ${kept.join(', ')}`);
  changeItems(all =>
    all.map(one => (wanted.includes(one.num) && !one.cleared && !isKept(one) ? withStatus(one, status) : one)),
  );
  console.log(describeList());
}

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'hook') runHook();
  else if (command === 'worker') runWorker(args[0]);
  else if (command === 'ui') runUi();
  else if (command === 'list') console.log(describeList());
  else if (command === 'show') runShow(args);
  else if (command in MARKS) runMark(command, args);
  else {
    console.error('Usage: todo.js hook | worker <id> | ui | list | show <number> | start|done|reopen|approve <number> ...');
    process.exit(1);
  }
}

module.exports = { textAfterToDo, isDoList, parseTidied, wrap, inDisplayOrder, assignNumbers, readItems, changeItems, restoreItems, LIST_FILE, TAB_LABEL };
