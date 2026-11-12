#!/usr/bin/env node
'use strict';
// Prints Claude Code's settings file with the template laid over it, so nothing the person already has is lost.
//   merge-settings.js <template> <existing settings or a missing file> <repo folder> <node binary>
// - __REPO__ and __NODE__ in the template become the repo folder and the node binary.
// - The hooks for one event are a list: the template's entries are added, ones already there are not doubled.
// - CLAUDE_CODE_PLUGIN_DIRS is a list of folders separated by ':', so the template's folder is added to it.
// - Anything else the template names replaces what was there (the status line, for one).
// A broken settings file makes JSON.parse throw, which stops the install before anything is replaced.
const fs = require('fs');

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function joinHooks(base, over) {
  const known = new Set(base.map(entry => JSON.stringify(entry)));
  return [...base, ...over.filter(entry => !known.has(JSON.stringify(entry)))];
}

function joinPluginDirs(base, over) {
  const dirs = String(base || '').split(':').filter(Boolean);
  for (const dir of String(over).split(':').filter(Boolean)) if (!dirs.includes(dir)) dirs.push(dir);
  return dirs.join(':');
}

function merge(base, over, where = '') {
  const merged = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const at = where ? `${where}.${key}` : key;
    if (where === 'hooks' && Array.isArray(value) && Array.isArray(base[key])) merged[key] = joinHooks(base[key], value);
    else if (at === 'env.CLAUDE_CODE_PLUGIN_DIRS') merged[key] = joinPluginDirs(base[key], value);
    else if (isObject(value) && isObject(base[key])) merged[key] = merge(base[key], value, at);
    else merged[key] = value;
  }
  return merged;
}

function fill(value, repo, node) {
  if (typeof value === 'string') return value.replaceAll('__REPO__', repo).replaceAll('__NODE__', node);
  if (Array.isArray(value)) return value.map(item => fill(item, repo, node));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, repo, node)]));
  return value;
}

function mergeSettings(templateText, existingText, repo, node) {
  const existing = existingText.trim() ? JSON.parse(existingText) : {};
  return merge(existing, fill(JSON.parse(templateText), repo, node));
}

if (require.main === module) {
  const [templatePath, settingsPath, repo, node] = process.argv.slice(2);
  const existingText = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : '';
  process.stdout.write(JSON.stringify(mergeSettings(fs.readFileSync(templatePath, 'utf8'), existingText, repo, node), null, 2) + '\n');
}

module.exports = { mergeSettings };
