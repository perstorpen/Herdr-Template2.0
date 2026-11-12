#!/usr/bin/env node
'use strict';
// Claude Code status line for Herdr-Template2.0. Reads the session JSON on stdin and prints four lines:
//   model, project, time and lines changed;
//   context use, and the tokens and dollars of this month;
//   plan limits for the 5-hour session and the week, with a forecast for the week;
//   tokens for the running total and this chat, what they are worth at list price, and the cooling
//   water they used.
//
// The icons need a Nerd Font in the terminal. Elsewhere they show as empty boxes.
//
// Everything this file keeps is in <data>/statusline/, where <data> is $HERDR_TEMPLATE_DATA or
// ~/.claude/herdr-template. The running total is in usage-ledger.json there. It is built from the transcripts
// in ~/.claude/projects and is never reduced, so tokens stay counted after Claude Code cleans up old
// transcripts. There is no API for an account-wide total: this only knows about Claude Code on this
// computer, not claude.ai or the desktop chat.
//
// Each response is valued when it is first counted and the amount is stored, so a later price change
// doesn't alter old amounts. The value is an estimate at API list price, not what a subscription costs.
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const DATA = process.env.HERDR_TEMPLATE_DATA || path.join(HOME, '.claude', 'herdr-template');
const DIR = path.join(DATA, 'statusline');
const LEDGER = path.join(DIR, 'usage-ledger.json');
const LOCK = path.join(DIR, '.ledger-lock');
const REVALUE_LOCK = path.join(DIR, '.revalue-lock');
const MONTHS_FILE = path.join(DIR, 'months.json');
// What the pause near the session limit reads (hooks/pause.js).
const PAUSE_LIMIT = path.join(DATA, 'pause', 'limit.json');
// The effort picked with the buttons in a chat, one file per chat (written by the mod).
const EFFORT_DIR = path.join(DATA, 'chat-effort');
const LOCAL_ROOT = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude'), 'projects');
// Tests point it elsewhere, so the computer they run on doesn't count in them.
const WINDOWS_USERS = process.env.STATUSLINE_WINDOWS_USERS || '/mnt/c/Users';
const EXTRA_SCAN_MS = 10 * 60 * 1000;
const STALE_LOCK_MS = 30 * 1000;

// USD per million tokens: input, 5-minute cache write, 1-hour cache write, cache read, output.
// From https://platform.claude.com/docs/en/about-claude/pricing. A model that isn't listed here is counted in
// tokens but not valued, and the amount is then shown with a "+".
const PRICES = {
  'claude-fable-5-2': [8, 10, 16, 0.2, 40],
  'claude-mythos-5-2': [8, 10, 16, 0.2, 40],
  'claude-fable-5-1': [10, 12.5, 20, 0.25, 50],
  'claude-mythos-5-1': [10, 12.5, 20, 0.25, 50],
  'claude-fable-5': [10, 12.5, 20, 1, 50],
  'claude-mythos-5': [10, 12.5, 20, 1, 50],
  'claude-opus-5-5': [4, 5, 8, 0.2, 20],
  'claude-opus-5': [5, 6.25, 10, 0.5, 25],
  'claude-opus-4-8': [5, 6.25, 10, 0.5, 25],
  'claude-opus-4-7': [5, 6.25, 10, 0.5, 25],
  'claude-opus-4-6': [5, 6.25, 10, 0.5, 25],
  'claude-opus-4-5': [5, 6.25, 10, 0.5, 25],
  'claude-sonnet-5-5': [2, 2.5, 4, 0.1, 10],
  'claude-sonnet-5': [2, 2.5, 4, 0.2, 10],
  'claude-sonnet-4-6': [3, 3.75, 6, 0.3, 15],
  'claude-sonnet-4-5': [3, 3.75, 6, 0.3, 15],
  'claude-haiku-5-5': [0.1, 0.125, 0.2, 0.01, 0.5],
  'claude-haiku-4-5': [1, 1.25, 2, 0.1, 5],
};
const HAIKU_5_5_LONG = [0.5, 0.625, 1, 0.05, 2.5]; // prompts over 100,000 tokens, cache included
const HAIKU_5_5_LIMIT = 100000;
const FAST_MODE_MODELS = new Set(['claude-fable-5-2', 'claude-mythos-5-2', 'claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8']); // twice the price
// Raise this when PRICES gains a model. Responses that were counted while their model had no price are then
// given their value from the transcripts, once, and the tokens stay as they were counted.
const PRICED = 1;
const US_ONLY_MULTIPLIER = 1.1;
const WEB_SEARCH_USD = 0.01;

// Cooling water, an estimate. Applied to the same token totals that are shown.
const LITRES_PER_MILLION_TOKENS = 7;

// Model ids may carry a date, such as claude-haiku-4-5-20251001.
const priceKey = model => {
  const id = String(model || '').replace(/-\d{8}$/, '').replace(/\[[^\]]*\]$/, '');
  return Object.prototype.hasOwnProperty.call(PRICES, id) ? id : null;
};

// Returns the value of one response in USD, or null when the model has no known price.
function responseValue(model, usage) {
  const key = priceKey(model);
  if (!key) return null;
  const input = usage.input_tokens || 0;
  const cacheNew = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const split = usage.cache_creation || {};
  const cache1h = split.ephemeral_1h_input_tokens || 0;
  const cache5m = split.ephemeral_5m_input_tokens !== undefined ? split.ephemeral_5m_input_tokens : cacheNew - cache1h;
  const long = key === 'claude-haiku-5-5' && input + cacheNew + cacheRead > HAIKU_5_5_LIMIT;
  const [pIn, p5m, p1h, pRead, pOut] = long ? HAIKU_5_5_LONG : PRICES[key];
  let usd = (input * pIn + cache5m * p5m + cache1h * p1h + cacheRead * pRead + (usage.output_tokens || 0) * pOut) / 1e6;
  if (usage.speed === 'fast' && FAST_MODE_MODELS.has(key)) usd *= 2;
  if (usage.inference_geo === 'us') usd *= US_ONLY_MULTIPLIER;
  const searches = usage.server_tool_use && usage.server_tool_use.web_search_requests;
  return usd + (searches || 0) * WEB_SEARCH_USD;
}

// `seen` keeps each response's amounts by its message id:
// [input, new cache, cache read, output, USD or null, when it was made in seconds or 0].
const VERSION = 1;
const emptyParts = () => [0, 0, 0, 0, 0]; // input, new cache, cache read, output, USD
const emptyLedger = () => ({ version: VERSION, startedAt: new Date().toISOString(), lastExtraScan: 0, totals: emptyParts(), unvalued: 0, sessions: {}, files: {}, seen: {} });
const tokenSum = parts => parts[0] + parts[1] + parts[2] + parts[3];

function loadLedger() {
  let raw;
  try { raw = fs.readFileSync(LEDGER, 'utf8'); } catch { return emptyLedger(); }
  try {
    const ledger = JSON.parse(raw);
    if (ledger && ledger.version === VERSION && Array.isArray(ledger.totals) && ledger.seen) return ledger;
  } catch { /* handled below */ }
  // Keep a damaged file for inspection and rebuild from the transcripts that still exist.
  try { fs.renameSync(LEDGER, `${LEDGER}.damaged-${Date.now()}`); } catch { /* start over anyway */ }
  return emptyLedger();
}

function saveLedger(ledger) {
  const tmp = `${LEDGER}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ledger));
  fs.renameSync(tmp, LEDGER);
}

// Claude Code on the Windows side of a WSL PC. Scanned rarely, because /mnt/c is slow. The Windows
// user differs between PCs, so every user folder this account can read is looked in.
function windowsRoots() {
  try {
    return fs.readdirSync(WINDOWS_USERS).map(user => path.join(WINDOWS_USERS, user, '.claude', 'projects'));
  } catch {
    return [];
  }
}

function transcripts(root) {
  const found = [];
  const walk = dir => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jsonl')) found.push(full);
    }
  };
  walk(root);
  return found;
}

function countLine(ledger, line, file) {
  // Most lines have no usage, so skip them without parsing.
  if (!line.includes('"usage"')) return false;
  let entry;
  try { entry = JSON.parse(line); } catch { return false; }
  const message = entry && entry.message;
  const usage = message && message.usage;
  if (!usage || !message.id) return false;
  // One API response is written as several lines, and a resumed session can repeat them in a new file.
  if (ledger.seen[message.id]) return false;
  const usd = responseValue(message.model, usage);
  const parts = [
    usage.input_tokens || 0,
    usage.cache_creation_input_tokens || 0,
    usage.cache_read_input_tokens || 0,
    usage.output_tokens || 0,
    usd || 0,
  ];
  const madeAt = Date.parse(entry.timestamp);
  ledger.seen[message.id] = [...parts.slice(0, 4), usd === null ? null : usd, Number.isFinite(madeAt) ? Math.round(madeAt / 1000) : 0];
  if (usd === null) ledger.unvalued += tokenSum(parts);
  const session = entry.sessionId || path.basename(file, '.jsonl');
  const sessionTotals = ledger.sessions[session] || (ledger.sessions[session] = emptyParts());
  parts.forEach((n, i) => { ledger.totals[i] += n; sessionTotals[i] += n; });
  return true;
}

// Reads only the bytes added since the last run, and only whole lines.
function readNewLines(ledger, file) {
  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  const known = ledger.files[file];
  const offset = known && stat.size >= known ? known : 0;
  if (stat.size === offset) return false;
  const buffer = Buffer.alloc(stat.size - offset);
  const fd = fs.openSync(file, 'r');
  let read;
  try { read = fs.readSync(fd, buffer, 0, buffer.length, offset); } finally { fs.closeSync(fd); }
  const end = buffer.subarray(0, read).lastIndexOf(0x0a);
  if (end < 0) return false;
  for (const line of buffer.subarray(0, end).toString('utf8').split('\n')) countLine(ledger, line, file);
  ledger.files[file] = offset + end + 1;
  return true;
}

function takeLock() {
  try { fs.mkdirSync(LOCK); return true; } catch { /* held, or left behind */ }
  try {
    if (Date.now() - fs.statSync(LOCK).mtimeMs > STALE_LOCK_MS) {
      fs.rmdirSync(LOCK);
      fs.mkdirSync(LOCK);
      return true;
    }
  } catch { /* another session got there first */ }
  return false;
}

// Another session may be updating at the same moment. Then this run shows the last saved numbers.
function updatedLedger() {
  fs.mkdirSync(DIR, { recursive: true });
  if (!takeLock()) return loadLedger();
  try {
    const ledger = loadLedger();
    const files = transcripts(LOCAL_ROOT);
    const extraDue = Date.now() - (ledger.lastExtraScan || 0) > EXTRA_SCAN_MS;
    if (extraDue) {
      for (const root of windowsRoots()) files.push(...transcripts(root));
      ledger.lastExtraScan = Date.now();
    }
    let changed = extraDue;
    for (const file of files) if (readNewLines(ledger, file)) changed = true;
    if (changed) saveLedger(ledger);
    return ledger;
  } finally {
    try { fs.rmdirSync(LOCK); } catch { /* the next run clears it as stale */ }
  }
}

// ---- Responses counted before their model had a price ----

const hasUnvalued = ledger => Object.values(ledger.seen || {}).some(parts => Array.isArray(parts) && parts[4] === null);

// Calls back with every whole line of a file, read in pieces so that a very large transcript fits.
function eachLine(file, onLine) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return; }
  const buffer = Buffer.alloc(8 * 1024 * 1024);
  let rest = Buffer.alloc(0);
  try {
    for (let read = fs.readSync(fd, buffer, 0, buffer.length, null); read > 0; read = fs.readSync(fd, buffer, 0, buffer.length, null)) {
      const data = Buffer.concat([rest, buffer.subarray(0, read)]);
      const end = data.lastIndexOf(0x0a);
      if (end < 0) { rest = data; continue; }
      for (const line of data.subarray(0, end).toString('utf8').split('\n')) onLine(line);
      rest = Buffer.from(data.subarray(end + 1));
    }
  } finally { fs.closeSync(fd); }
}

// Gives a value to the responses that have none, where the transcript is still here and the model now has a price.
// The reading is done without the lock, because it takes a while; only writing the result holds it.
function revalue() {
  const open = new Set(Object.entries(loadLedger().seen).filter(([, parts]) => Array.isArray(parts) && parts[4] === null).map(([id]) => id));
  const found = new Map();
  if (open.size) {
    const files = transcripts(LOCAL_ROOT);
    for (const root of windowsRoots()) files.push(...transcripts(root));
    for (const file of files) {
      eachLine(file, line => {
        if (!line.includes('"usage"')) return;
        let entry;
        try { entry = JSON.parse(line); } catch { return; }
        const message = entry && entry.message;
        if (!message || !message.usage || !open.has(message.id) || found.has(message.id)) return;
        const usd = responseValue(message.model, message.usage);
        if (usd !== null) found.set(message.id, { usd, session: entry.sessionId || path.basename(file, '.jsonl') });
      });
    }
  }
  for (let tries = 0; !takeLock(); tries += 1) {
    if (tries > 300) throw new Error('the ledger is busy, try again');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  try {
    const ledger = loadLedger();
    let valued = 0;
    for (const [id, { usd, session }] of found) {
      const parts = ledger.seen[id];
      if (!Array.isArray(parts) || parts[4] !== null) continue;
      parts[4] = usd;
      ledger.totals[4] += usd;
      ledger.unvalued = Math.max(0, (ledger.unvalued || 0) - tokenSum(parts));
      if (ledger.sessions[session]) ledger.sessions[session][4] += usd;
      valued += 1;
    }
    ledger.priced = PRICED;
    saveLedger(ledger);
    return { valued, left: open.size - valued };
  } finally {
    try { fs.rmdirSync(LOCK); } catch { /* the next run clears it as stale */ }
  }
}

// Started from a status line run, which Claude Code may cut short: the work goes on in a process of its own.
function revalueInBackground() {
  try { fs.mkdirSync(REVALUE_LOCK); } catch {
    try { if (Date.now() - fs.statSync(REVALUE_LOCK).mtimeMs < 15 * 60 * 1000) return; } catch { return; }
  }
  require('child_process').spawn(process.execPath, [__filename, 'revalue'], { detached: true, stdio: 'ignore' }).unref();
}

// ---- A new version of the template ----

// The template's own folder, whose remote the check fetches. Tests point it at a repo of their own.
const TEMPLATE_REPO = process.env.HERDR_TEMPLATE_REPO || path.join(__dirname, '..');
const UPDATE_FILE = path.join(DATA, 'update.json');
const UPDATE_LOCK = path.join(DATA, '.update-check-lock');
const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;

// -1, 0 or 1, comparing versions such as 2.0.0 and 2.1.0 number by number.
function compareVersions(a, b) {
  const pa = String(a).trim().split('.').map(Number);
  const pb = String(b).trim().split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
const isVersion = text => /^\d+(\.\d+){0,3}$/.test(String(text || '').trim());

function localVersion() {
  try { return fs.readFileSync(path.join(TEMPLATE_REPO, 'version.txt'), 'utf8').trim(); } catch { return null; }
}

function readUpdate() {
  try { return JSON.parse(fs.readFileSync(UPDATE_FILE, 'utf8')); } catch { return null; }
}

// The newer version on GitHub, or null: compared with the version in the folder now, so the notice goes the moment
// the template is updated.
function newerVersion() {
  const known = readUpdate();
  const local = localVersion();
  if (!known || !isVersion(known.remote) || !isVersion(local)) return null;
  return compareVersions(known.remote, local) > 0 ? known.remote.trim() : null;
}

// Fetches and reads the version on GitHub. Run in a process of its own, never by the status line itself.
function checkForUpdate() {
  const git = (...args) => require('child_process').spawnSync('git', ['-C', TEMPLATE_REPO, ...args], { encoding: 'utf8', timeout: 60000 });
  let remote = null;
  if (git('fetch', '--quiet', 'origin').status === 0) {
    const shown = git('show', 'origin/main:version.txt');
    if (shown.status === 0 && isVersion(shown.stdout)) remote = shown.stdout.trim();
  }
  const result = { checkedAt: new Date().toISOString(), local: localVersion(), remote };
  fs.mkdirSync(DATA, { recursive: true });
  const tmp = `${UPDATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(result));
  fs.renameSync(tmp, UPDATE_FILE);
  return result;
}

// At most once every six hours, and only one check at a time; a failed check waits the same six hours.
function checkForUpdateInBackground(now = Date.now()) {
  const known = readUpdate();
  if (known && now - Date.parse(known.checkedAt) < UPDATE_EVERY_MS) return false;
  fs.mkdirSync(DATA, { recursive: true });
  try { fs.mkdirSync(UPDATE_LOCK); } catch {
    try { if (now - fs.statSync(UPDATE_LOCK).mtimeMs < 5 * 60 * 1000) return false; } catch { return false; }
  }
  require('child_process').spawn(process.execPath, [__filename, 'check-update'], { detached: true, stdio: 'ignore' }).unref();
  return true;
}

// ---- Month by month ----

// A month is a calendar month, in this computer's time. The total rolls on for ever; a month starts again from
// nothing. The list begins with the month counting started, or with an older month when the first run found
// older transcripts.
const monthKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const nextMonth = key => {
  const [year, month] = key.split('-').map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
};

// Every month from the first to this one, oldest first: { key, tokens, usd, current }.
// A response belongs to the month it was made in; one without a time belongs to the first month.
function months(ledger, now = Date.now()) {
  const started = Date.parse(ledger.startedAt);
  let first = monthKey(Number.isFinite(started) ? Math.min(started, now) : now);
  const sums = {};
  const untimed = { tokens: 0, usd: 0 };
  for (const parts of Object.values(ledger.seen || {})) {
    if (!Array.isArray(parts)) continue;
    let month = untimed;
    if (parts[5]) {
      const key = monthKey(parts[5] * 1000);
      if (key < first) first = key;
      month = sums[key] || (sums[key] = { tokens: 0, usd: 0 });
    }
    month.tokens += tokenSum(parts);
    month.usd += parts[4] || 0;
  }
  const thisMonth = monthKey(now) > first ? monthKey(now) : first;
  const list = [];
  for (let key = first; key <= thisMonth; key = nextMonth(key)) {
    const sum = sums[key] || { tokens: 0, usd: 0 };
    const tokens = sum.tokens + (key === first ? untimed.tokens : 0);
    const usd = sum.usd + (key === first ? untimed.usd : 0);
    list.push({ key, tokens: Math.round(tokens), usd: Math.round(usd * 100) / 100, current: key === thisMonth });
  }
  return list;
}

// For the "månad" button in the hint line (mod/), which shows the list.
function writeMonths(list) {
  const text = JSON.stringify(list);
  let old = '';
  try { old = fs.readFileSync(MONTHS_FILE, 'utf8'); } catch { /* not written yet */ }
  if (old === text) return;
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${MONTHS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, MONTHS_FILE);
}

// ---- Drawing the lines ----

const c = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
};
const SEP = c.dim(' │ ');

// Nerd Fonts 3 code points. Each icon is followed by a space, because it can be wider than one cell.
// The ones that fill two cells carry a second space, or they touch the text after them.
const ICON = {
  model: ' ', // fa-robot
  folder: ' ', // fa-folder_open
  branch: '', // dev-git_branch
  time: '', // fa-clock
  context: '', // fa-brain
  session: '', // fa-hourglass_half
  week: '', // fa-calendar
  reset: '', // fa-refresh
  total: '', // fa-database
  chat: '', // fa-comment
  chats: ' ', // fa-comments
  water: '', // fa-tint
};

function tokens(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`;
  return String(n);
}

function duration(ms) {
  const minutes = Math.floor((ms || 0) / 60000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// How full a tracker is, as a colour that fades green → yellow → red. `heat` is 0 (green) to
// 1 (red). The ends are the terminal's own green, yellow and red (Windows Terminal's Campbell).
const GREEN = [19, 161, 14];
const YELLOW = [193, 156, 0];
const RED = [197, 15, 31];
const clamp01 = n => Math.min(1, Math.max(0, n));

function heatColour(heat) {
  const t = clamp01(heat);
  const [from, to, f] = t < 0.5 ? [GREEN, YELLOW, t * 2] : [YELLOW, RED, (t - 0.5) * 2];
  return from.map((v, i) => Math.round(v + (to[i] - v) * f));
}

const byHeat = (heat, text) => `\x1b[38;2;${heatColour(heat).join(';')}m${text}\x1b[0m`;

// Session and week: green up to 50 %, yellow at about 63 %, nearly red at 80 %, fully red from 85 %.
const limitHeat = pct => clamp01((pct - 50) / 35);
// The context, by the tokens in it: green up to 250k, then towards yellow, fully red from 400k.
const contextHeat = inContext => clamp01((inContext - 250e3) / 150e3);

function bar(pct, heat) {
  const filled = Math.min(10, Math.round(pct / 10));
  return byHeat(heat, '█'.repeat(filled)) + c.dim('░'.repeat(10 - filled));
}

function resetTime(epochSeconds, withDay) {
  if (!epochSeconds) return '';
  const date = new Date(epochSeconds * 1000);
  const time = date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  const day = withDay ? `${date.toLocaleDateString('sv-SE', { weekday: 'short' })} ` : '';
  return c.dim(` ${ICON.reset} ${day}${time}`);
}

const WEEK_MS = 7 * 24 * 3600 * 1000;
// Before this much of the week has passed, one busy morning would make the forecast far too high.
const FORECAST_AFTER_MS = 6 * 3600 * 1000;

// What the week will have used when it resets, if it goes on at its pace so far. Over 100 %, when it runs out.
function weekForecast(window, now = Date.now()) {
  if (!window.resets_at) return '';
  const end = window.resets_at * 1000;
  const elapsed = now - (end - WEEK_MS);
  if (elapsed < FORECAST_AFTER_MS || elapsed >= WEEK_MS) return '';
  const used = Math.max(0, window.used_percentage);
  const forecast = Math.round(used * WEEK_MS / elapsed);
  const text = `prognos ${forecast}%`;
  if (forecast <= 100) return ` ${c.dim('·')} ${byHeat(limitHeat(forecast), text)}`;
  const runsOut = new Date(end - WEEK_MS + elapsed * 100 / used);
  const at = `${runsOut.toLocaleDateString('sv-SE', { weekday: 'short' })} ${runsOut.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;
  return ` ${c.dim('·')} ${c.red(`${text}, slut ${at}`)}`;
}

// A bar for a plan limit. Claude Code only sends the limits on some plans, and after the first response.
function limitBar(label, window, withDay, forecast = false) {
  if (!window || typeof window.used_percentage !== 'number') return `${c.dim(label)} ${bar(0, 0)} ${c.dim('väntar på data')}`;
  // The numbers only change with a response, so a window that has ended is shown as empty.
  const ended = window.resets_at && window.resets_at * 1000 <= Date.now();
  const pct = ended ? 0 : Math.min(100, Math.max(0, Math.round(window.used_percentage)));
  const ahead = forecast && !ended ? weekForecast(window) : '';
  return `${c.dim(label)} ${bar(pct, limitHeat(pct))} ${byHeat(limitHeat(pct), `${pct}%`)}${ended ? '' : resetTime(window.resets_at, withDay)}${ahead}`;
}

function gitBranch(dir) {
  try {
    const head = fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8').trim();
    return head.startsWith('ref: refs/heads/') ? head.slice(16) : head.slice(0, 7);
  } catch { return null; }
}

const dollars = usd => `$${usd.toFixed(2)}`;

function waterAmount(tokenCount) {
  const litres = tokenCount / 1e6 * LITRES_PER_MILLION_TOKENS;
  if (litres < 1) return `${Math.round(litres * 1000)} ml`;
  return `${litres.toFixed(litres >= 100 ? 0 : 1)} L`;
}

const water = tokenCount => c.cyan(`${ICON.water} ${waterAmount(tokenCount)}`);

// ↑ is what was sent (input and new cache), ↓ is what came back, cache is what was reused from the cache.
function totalSummary(ledger) {
  const [input, cacheNew, cacheRead, output, usd] = ledger.totals;
  const worth = `${dollars(usd)}${ledger.unvalued ? '+' : ''}`;
  const count = tokenSum(ledger.totals);
  return `${c.dim(`${ICON.total} Totalt`)} ${c.bold(tokens(count))} ${c.dim('≈')} ${c.bold(worth)} ${water(count)} ${c.dim(`(↑${tokens(input + cacheNew)} ↓${tokens(output)} cache ${tokens(cacheRead)})`)}`;
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

function monthSummary(list) {
  const month = list[list.length - 1];
  const name = MONTH_NAMES[Number(month.key.slice(5)) - 1];
  return `${c.dim(`${ICON.week} Månad ${name}`)} ${c.bold(tokens(month.tokens))} ${c.dim('≈')} ${c.bold(dollars(month.usd))}`;
}

function chatSummary(parts) {
  const count = tokenSum(parts);
  return `${c.dim(`${ICON.chat} Chatt`)} ${tokens(count)} ${c.dim('≈')} ${dollars(parts[4] || 0)} ${water(count)}`;
}

// The level picked with the effort buttons in this chat. Claude Code only knows the one from the settings.
function chatEffort(input) {
  if (!/opus/i.test((input.model && input.model.id) || '')) return null;
  try {
    return fs.readFileSync(path.join(EFFORT_DIR, String(input.session_id)), 'utf8').trim();
  } catch {
    return null;
  }
}

function render(input, ledger) {
  const dir = (input.workspace && (input.workspace.project_dir || input.workspace.current_dir)) || input.cwd || process.cwd();
  const branch = gitBranch(dir);
  const cost = input.cost || {};

  const model = (input.model && input.model.display_name) || 'Claude';
  const effort = chatEffort(input) || (input.effort && input.effort.level);
  const first = [
    c.cyan(c.bold(`${ICON.model} ${model}`)) + (effort ? c.dim(` · ${effort}`) : ''),
    `${c.dim(ICON.folder)} ${path.basename(dir)}` + (branch ? c.dim(` ${ICON.branch} ${branch}`) : ''),
    `${c.dim(ICON.time)} ${duration(cost.total_duration_ms)}`,
    `${c.green(`+${cost.total_lines_added || 0}`)} ${c.red(`−${cost.total_lines_removed || 0}`)}`,
  ];
  let newer = null;
  try { newer = newerVersion(); } catch { /* no notice */ }
  if (newer) first.push(c.yellow(c.bold(`⬆ Ny version ${newer}: skriv uppdatera`)));

  const ctx = input.context_window || {};
  const pct = typeof ctx.used_percentage === 'number' ? Math.round(ctx.used_percentage) : 0;
  const now = ctx.current_usage || {};
  const inContext = (now.input_tokens || 0) + (now.cache_creation_input_tokens || 0) + (now.cache_read_input_tokens || 0);
  // The month sits beside the context, where the line has room.
  const monthList = months(ledger);
  try { writeMonths(monthList); } catch { /* the line still shows */ }
  const second = [
    `${c.dim(`${ICON.context} Kontext`)} ${bar(pct, contextHeat(inContext))} ${byHeat(contextHeat(inContext), `${pct}%`)} ${c.dim(`${tokens(inContext)}/${tokens(ctx.context_window_size || 0)}`)}`,
    monthSummary(monthList),
  ];

  const limits = input.rate_limits || {};
  const usage = [
    limitBar(`${ICON.session} Session`, limits.five_hour, false),
    limitBar(`${ICON.week} Vecka`, limits.seven_day, true, true),
  ];

  const tokenLine = [
    totalSummary(ledger),
    chatSummary(ledger.sessions[input.session_id] || emptyParts()),
    c.dim(`${ICON.chats} ${Object.keys(ledger.sessions).length} chattar`),
  ];

  return [first, second, usage, tokenLine].map(parts => parts.join(SEP)).join('\n');
}

// Every chat's status line writes the session figure here, and a chat that has been still for a while knows an
// older figure, so within one session the highest one stands.
function recordSessionLimit(window) {
  if (!window || typeof window.used_percentage !== 'number' || typeof window.resets_at !== 'number') return;
  if (window.resets_at * 1000 <= Date.now()) return;
  let known = null;
  try { known = JSON.parse(fs.readFileSync(PAUSE_LIMIT, 'utf8')); } catch { /* none yet */ }
  const sameSession = known && typeof known.resets_at === 'number' && Math.abs(known.resets_at - window.resets_at) < 600;
  const used = sameSession && known.used_percentage > window.used_percentage ? known.used_percentage : window.used_percentage;
  if (sameSession && known.used_percentage === used) return;
  fs.mkdirSync(path.dirname(PAUSE_LIMIT), { recursive: true });
  const tmp = `${PAUSE_LIMIT}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ used_percentage: used, resets_at: window.resets_at }));
  fs.renameSync(tmp, PAUSE_LIMIT);
}

function main() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { /* still show what is known */ }
  try { recordSessionLimit((input.rate_limits || {}).five_hour); } catch { /* the status line still shows */ }
  let ledger;
  try { ledger = updatedLedger(); } catch { ledger = emptyLedger(); }
  process.stdout.write(`${render(input, ledger)}\n`);
  try { if (ledger.priced !== PRICED && hasUnvalued(ledger)) revalueInBackground(); } catch { /* the next run tries again */ }
  try { checkForUpdateInBackground(); } catch { /* the next run tries again */ }
}

if (require.main === module && process.argv[2] === 'revalue') {
  try {
    const { valued, left } = revalue();
    process.stdout.write(`${valued} svar fick ett värde${left ? `, ${left} saknar fortfarande pris eller chattfil` : ''}\n`);
  } finally {
    try { fs.rmdirSync(REVALUE_LOCK); } catch { /* not held */ }
  }
} else if (require.main === module && process.argv[2] === 'check-update') {
  try { checkForUpdate(); } finally {
    try { fs.rmdirSync(UPDATE_LOCK); } catch { /* not held */ }
  }
} else if (require.main === module) {
  try { main(); } catch (err) { process.stdout.write(`statusline: ${err.message}\n`); }
}

module.exports = { months, monthKey, responseValue, compareVersions, heatColour, limitHeat, contextHeat };
