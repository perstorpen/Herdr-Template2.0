#!/usr/bin/env node
'use strict';
// The "agent" command. A UserPromptSubmit hook that decides how a chat uses extra agents:
//   agent <number>   start exactly that many extra agents (0 means none)
//   agent rec        the chat chooses the number
//   anything else    the chat chooses too, unless the message is only a question, an answer or a comment
// The chat shows its choice in a first line ("Agenter: +2 – ...") before it starts working.
// The instructions are added to every message in every chat, so keep them short.
const fs = require('fs');

const RUNNING = `How to run extra agents:
- Agent tool, subagent_type "fork", all calls in one message. A fork inherits this conversation, tools, skills and model. Give each a clearly separate part.
- One that changes files gets isolation "worktree". A worktree starts from origin's main branch, so if the task builds on this chat's unsaved or unpushed work, tell it to first run \`git reset --hard <this chat's HEAD commit>\` there, then \`git -C <this chat's folder> diff HEAD | git apply\`, and copy new untracked files it needs.
- This chat leads: wait for every agent, bring the changes into its own working tree, check the combined result itself, and report in Swedish what each did. The user's other rules apply to every agent.`;

const FIRST_LINE = `Your very first output, before any tool call, is one line in Swedish: \`Agenter: +N – short reason\`, where N is the number of extra agents.`;

const CHOOSING = `Choose how many extra agents suit the task, counting what really runs in parallel and what the extra cost buys. Often that is 0: a small fix, one connected change, or changes to the same files. If you must ask the user something first, write \`Agenter: väljs efter dina svar\` instead, and choose after the answer.`;

// Prompts the template's other commands, or Claude Code itself, handle: info, uppdatera, pause (and its forms), time, to do ...,
// do list, gör punkt N, slash commands and ! commands.
const HANDLED_ELSEWHERE = [
  /^\s*(?:info|time|do[\s-]?list(?:an)?|uppdatera(?:\s+mallen)?|update)\s*[.!?]?\s*$/i,
  /^\s*pause(?:\s+(?:off|av|on|på|\d{1,3})\s*%?)?\s*[.!]?\s*$/i,
  /^\s*to[\s-]?do\b/i,
  /^\s*gör\s+punkt(?:en|erna)?\s+\d/i,
  /^\s*[/!]/,
];
const isHandledElsewhere = prompt => HANDLED_ELSEWHERE.some(pattern => pattern.test(prompt));

function parseCommand(prompt) {
  const match = /^\s*agent\s+(rec|\d+)[:,.;]?(?:\s+[–-]?\s*([\s\S]*))?$/i.exec(prompt);
  if (!match) return null;
  const amount = match[1].toLowerCase();
  return { count: amount === 'rec' ? null : Number(amount), mission: (match[2] ?? '').trim() };
}

function amountRule(count) {
  if (count === null) return CHOOSING;
  if (count === 0) return 'The user chose no extra agents for this, so start none.';
  const noun = count === 1 ? '1 extra agent' : `${count} extra agents`;
  return `Start exactly ${noun}: the user chose this number, so don't change it. If the task doesn't split into that many separate parts, give the extra ones other useful angles on it, such as testing or review.`;
}

function commandContext({ count, mission }) {
  const missionRule = mission
    ? 'The task is the text after the command.'
    : 'The message has no task, so it is the task this chat is working on or was last given. If there is none, ask what it is and start no agents.';
  return `The user used the "agent" command, an explicit request about parallel agents. If the words after "agent" only talk about an existing agent (such as "agent 2 verkar ha fastnat"), treat the message as a normal one instead.
${missionRule}
${amountRule(count)}
${FIRST_LINE}
${RUNNING}`;
}

const DEFAULT_CONTEXT = `The user's standing rule, which is an explicit request for parallel agents when they help. If this message is only a question, an answer to your question, or a comment, reply as usual, with no extra agents and without the line below. If it asks for work, it is a task:
${CHOOSING}
${FIRST_LINE}
${RUNNING}`;

function contextFor(prompt) {
  if (process.env.TODO_WORKER || !prompt.trim() || isHandledElsewhere(prompt)) return null;
  const command = parseCommand(prompt);
  return command ? commandContext(command) : DEFAULT_CONTEXT;
}

function runHook() {
  const context = contextFor(JSON.parse(fs.readFileSync(0, 'utf8')).prompt ?? '');
  if (!context) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } }));
}

if (require.main === module) runHook();

module.exports = { parseCommand, commandContext, contextFor, isHandledElsewhere, DEFAULT_CONTEXT };
