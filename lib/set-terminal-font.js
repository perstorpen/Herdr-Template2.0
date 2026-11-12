#!/usr/bin/env node
'use strict';
// Prints a Windows Terminal settings file with the font set on its Ubuntu profiles, or prints nothing
// if the font is already set. Windows Terminal allows comments and trailing commas, which are dropped
// from a changed file (the installer keeps a backup of the old one).
// Usage: set-terminal-font.js <settings.json> <font face>
const fs = require('fs');

const [settingsPath, face] = process.argv.slice(2);

// Removes comments and trailing commas outside of strings.
function toPlainJson(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      out += text.slice(start, i + 1);
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i === -1) break;
      i++;
    } else if (ch === ',' && /^\s*(\/\/[^\n]*\s*|\/\*[\s\S]*?\*\/\s*)*[}\]]/.test(text.slice(i + 1))) {
      // A comma with only comments between it and the closing bracket is a trailing comma.
    } else {
      out += ch;
    }
  }
  return out;
}

const settings = JSON.parse(toPlainJson(fs.readFileSync(settingsPath, 'utf8')));
settings.profiles = settings.profiles || {};
const ubuntu = (settings.profiles.list || []).filter(profile => /^Ubuntu/.test(profile.name || ''));

// Windows Terminal adds a new distribution's profile on its next start. Until then only the defaults
// reach it, so they get the font instead.
if (ubuntu.length === 0) settings.profiles.defaults = settings.profiles.defaults || {};
const targets = ubuntu.length > 0 ? ubuntu : [settings.profiles.defaults];

let changed = false;
for (const target of targets) {
  if (target.font && target.font.face === face) continue;
  target.font = { ...target.font, face };
  changed = true;
}

if (changed) process.stdout.write(JSON.stringify(settings, null, 4) + '\n');
