#!/usr/bin/env node
'use strict';
// The task clock behind "Uppdrag" in the status line: how long a chat has worked on what the user last wrote.
//   clock.js prompt   UserPromptSubmit: the user wrote something new, so the clock starts again from nothing.
//   clock.js stop     Stop: the chat ended its turn, so the clock stops and stands there until the next prompt.
// One small file per chat. The status line reads it with shownMs.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isHandledElsewhere } = require('./agent.js');

const DATA = process.env.HERDR_TEMPLATE_DATA || path.join(os.homedir(), '.claude', 'herdr-template');
const DIR = process.env.CLOCK_DIR || path.join(DATA, 'clock');
const KEPT_MS = 30 * 24 * 60 * 60 * 1000;
const TAIL_BYTES = 16 * 1024;

const fileOf = sessionId => (/^[\w-]+$/.test(String(sessionId ?? '')) ? path.join(DIR, `${sessionId}.json`) : null);

function readClock(sessionId) {
  try {
    const clock = JSON.parse(fs.readFileSync(fileOf(sessionId), 'utf8'));
    return Number.isFinite(clock.workedMs) ? clock : null;
  } catch { return null; }
}

function writeClock(sessionId, clock) {
  const file = fileOf(sessionId);
  if (!file) return;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(clock));
  fs.renameSync(`${file}.${process.pid}.tmp`, file);
}

// A prompt one of the template's commands answers by itself (info, to do ..., pause, a slash command) is no task: the
// chat never works on it and never ends a turn, so the time before it stays.
const startsTask = prompt => Boolean(prompt.trim()) && !isHandledElsewhere(prompt);

const started = now => ({ workedMs: 0, runningSince: now });

// A stop with no start before it: the chat was woken by something other than the user. Nothing is added.
function stopped(clock, now) {
  if (!clock || !clock.runningSince) return clock;
  return { workedMs: clock.workedMs + Math.max(0, now - clock.runningSince), runningSince: null };
}

// When the user broke the chat off with Esc, if that is the last thing in its transcript. No hook runs then.
function interruptedAt(transcriptPath) {
  let tail;
  try {
    const fd = fs.openSync(transcriptPath, 'r');
    try {
      const { size } = fs.fstatSync(fd);
      const buffer = Buffer.alloc(Math.min(size, TAIL_BYTES));
      fs.readSync(fd, buffer, 0, buffer.length, size - buffer.length);
      tail = buffer.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return null; }
  for (const line of tail.split('\n').reverse()) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type !== 'user' && entry.type !== 'assistant') continue;
    const content = entry.message?.content;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part.text ?? '').join('') : '';
    const at = Date.parse(entry.timestamp);
    return entry.type === 'user' && /^\[Request interrupted by user/.test(text.trim()) && Number.isFinite(at) ? at : null;
  }
  return null;
}

// The time to show: what was worked before the last stop, and the stretch still running.
function shownMs(clock, now, brokenOffAt = null) {
  if (!clock.runningSince) return clock.workedMs;
  const end = brokenOffAt && brokenOffAt >= clock.runningSince ? brokenOffAt : now;
  return clock.workedMs + Math.max(0, end - clock.runningSince);
}

function prune(now) {
  try {
    for (const name of fs.readdirSync(DIR)) {
      const file = path.join(DIR, name);
      if (now - fs.statSync(file).mtimeMs > KEPT_MS) fs.rmSync(file, { force: true });
    }
  } catch { /* nothing kept yet */ }
}

function runHook(mode) {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const now = Date.now();
  if (process.env.TODO_WORKER) return;
  if (mode === 'prompt' && startsTask(input.prompt ?? '')) {
    writeClock(input.session_id, started(now));
    prune(now);
  }
  if (mode === 'stop') {
    const clock = readClock(input.session_id);
    if (clock && clock.runningSince) writeClock(input.session_id, stopped(clock, now));
  }
}

if (require.main === module) {
  // A clock must never stop a prompt or a turn.
  try { runHook(process.argv[2]); } catch { /* the status line shows the session's time */ }
}

module.exports = { readClock, startsTask, started, stopped, shownMs, interruptedAt };
