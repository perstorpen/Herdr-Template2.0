#!/usr/bin/env node
'use strict';
// The pause near the session limit. When 95 % of the 5-hour session is used, every working chat and its
// agents stop at their next step, so the rest is left for small things until the session fills up again.
// A chat goes on when the user writes in it: a message sent while the pause is on lets that chat work
// for the rest of that session. A chat started during the pause works from its first message.
//   pause          shows the setting and how much is used
//   pause 90       pauses at 90 % instead
//   pause off      no pause; pause on puts it back at 95 %
// The status line writes how much is used to <data folder>/pause/limit.json (it is the only thing told). The data
// folder is $HERDR_TEMPLATE_DATA, or ~/.claude/herdr-template.
// Two hooks run this file: "tool" before every tool call, "prompt" at every message.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = process.env.HERDR_TEMPLATE_DATA || path.join(os.homedir(), '.claude', 'herdr-template');
const DIR = process.env.PAUSE_DIR || path.join(DATA_DIR, 'pause');
const LIMIT = path.join(DIR, 'limit.json');
const SETTING = path.join(DIR, 'setting.json');
const ALLOWED = path.join(DIR, 'allowed');
const DEFAULT_AT = 95;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

// The percentage the pause starts at; 0 means the pause is off.
function pauseAt() {
  const at = (readJson(SETTING) || {}).at;
  return Number.isFinite(at) && at >= 0 && at <= 100 ? at : DEFAULT_AT;
}

// The session as the status line last saw it, or null when that session has already ended.
function currentLimit(now = Date.now()) {
  const limit = readJson(LIMIT);
  if (!limit || typeof limit.used_percentage !== 'number' || typeof limit.resets_at !== 'number') return null;
  return limit.resets_at * 1000 > now ? limit : null;
}

const safeName = sessionId => String(sessionId || 'unknown').replace(/[^\w.-]/g, '_');

// A chat is let through until the session it was let through in has ended.
function isAllowed(sessionId, now = Date.now()) {
  const until = readJson(path.join(ALLOWED, safeName(sessionId)));
  return typeof until === 'number' && until * 1000 > now;
}

function allow(sessionId, limit) {
  writeJson(path.join(ALLOWED, safeName(sessionId)), limit.resets_at);
  // Notes from sessions that have ended are of no use.
  for (const name of fs.readdirSync(ALLOWED)) {
    if (!isAllowed(name)) fs.rmSync(path.join(ALLOWED, name), { force: true });
  }
}

// The limit that pauses this chat now, or null.
function pausedBy(sessionId, now = Date.now()) {
  const at = pauseAt();
  const limit = currentLimit(now);
  if (!at || !limit || limit.used_percentage < at || isAllowed(sessionId, now)) return null;
  return { at, used: Math.floor(limit.used_percentage), resetsAt: limit.resets_at };
}

const clock = seconds => new Date(seconds * 1000).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

function parseCommand(prompt) {
  const match = /^\s*pause(?:\s+(off|av|on|på|\d{1,3})\s*%?)?\s*[.!]?\s*$/i.exec(prompt);
  if (!match) return null;
  const word = (match[1] || '').toLowerCase();
  if (!word) return { show: true };
  if (word === 'off' || word === 'av') return { at: 0 };
  if (word === 'on' || word === 'på') return { at: DEFAULT_AT };
  const at = Number(word);
  return at <= 100 ? { at } : null;
}

function describe(now = Date.now()) {
  const at = pauseAt();
  const limit = currentLimit(now);
  const used = limit
    ? `Nu är ${Math.floor(limit.used_percentage)} % använt, och sessionen fylls på ${clock(limit.resets_at)}.`
    : 'Hur mycket som är använt vet jag först när en chatt har fått ett svar i den här sessionen.';
  if (!at) return `Pausen är avstängd: chattarna jobbar tills sessionen tar slut. ${used} Skriv pause on för att slå på den.`;
  return `Chattarna pausar när ${at} % av sessionen är använd. ${used} Ändra med pause 90, stäng av med pause off.`;
}

function runCommand(command) {
  if (!command.show) writeJson(SETTING, { at: command.at });
  return describe();
}

function promptHook(input) {
  const command = parseCommand(input.prompt ?? '');
  if (command) {
    process.stdout.write(JSON.stringify({ continue: false, stopReason: runCommand(command) }));
    return;
  }
  // Writing in a chat while the pause is on is the user saying this chat may go on.
  const at = pauseAt();
  const limit = currentLimit();
  if (at && limit && limit.used_percentage >= at) allow(input.session_id, limit);
}

function toolHook(input) {
  const pause = pausedBy(input.session_id);
  if (!pause) return;
  const toUser = `Pausad: ${pause.used} % av sessionen är använd (pausen ligger på ${pause.at} %), och den fylls på ${clock(pause.resetsAt)}. `
    + 'Skriv fortsätt här för att låta den här chatten jobba vidare ändå.';
  const toAgent = `The user's pause at ${pause.at} % of the session limit is on, so no tool may run. Stop now: make no more tool calls, `
    + 'and say in one or two lines what is done and what is left. The user decides when the work goes on.';
  process.stdout.write(JSON.stringify({
    continue: false,
    stopReason: toUser,
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: toAgent },
  }));
}

function main() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return; }
  if (process.argv[2] === 'tool') toolHook(input);
  else if (process.argv[2] === 'prompt') promptHook(input);
}

// A fault here must never stop a chat from working.
if (require.main === module) {
  try { main(); } catch { /* let the chat go on */ }
}

module.exports = { parseCommand, pauseAt, currentLimit, pausedBy, allow, isAllowed, describe, runCommand, DEFAULT_AT, DIR };
