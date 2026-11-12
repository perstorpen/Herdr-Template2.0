'use strict';
// Runs the real status line against a throwaway HOME, so the real data in ~/.claude is never touched.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const SRC = path.join(__dirname, 'statusline.js');
// Each test's home is removed at exit, or every run leaves its folders in /tmp.
const HOMES = [];
process.on('exit', () => HOMES.forEach(home => fs.rmSync(home, { recursive: true, force: true })));

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));
  HOMES.push(home);
  const data = path.join(home, '.claude/herdr-template');
  const dir = path.join(data, 'statusline');
  fs.mkdirSync(dir, { recursive: true });
  const proj = path.join(home, '.claude/projects/p');
  fs.mkdirSync(proj, { recursive: true });
  return { home, data, dir, proj, ledger: path.join(dir, 'usage-ledger.json') };
}
// The environment of a status line run in the sandbox: its HOME, and no data folder or Claude folder from outside.
function envOf(s, more = {}) {
  const env = { ...process.env, HOME: s.home, STATUSLINE_WINDOWS_USERS: path.join(s.home, 'no-windows'), ...more };
  delete env.CLAUDE_CONFIG_DIR;
  if (!('HERDR_TEMPLATE_DATA' in more)) delete env.HERDR_TEMPLATE_DATA;
  // Never the real template folder: a check for a new version would fetch from its GitHub remote.
  if (!('HERDR_TEMPLATE_REPO' in more)) env.HERDR_TEMPLATE_REPO = path.join(s.home, 'no-template');
  return env;
}
const line = (id, session, input, cc, cr, output) => JSON.stringify({ type: 'assistant', sessionId: session, message: { id, usage: { input_tokens: input, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: output } } }) + '\n';
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');
function run(s, input = { session_id: 's1' }, more = {}) {
  const r = spawnSync('node', [SRC], { input: typeof input === 'string' ? input : JSON.stringify(input), env: envOf(s, more), encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return strip(r.stdout);
}
const ledgerOf = s => JSON.parse(fs.readFileSync(s.ledger, 'utf8'));
const totals = s => ledgerOf(s).totals.slice(0, 4);
const usd = s => ledgerOf(s).totals[4];
const priced = (id, session, model, u) => JSON.stringify({ type: 'assistant', sessionId: session, message: { id, model, usage: u } }) + '\n';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test('counts one response once, even when written on several lines', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.proj, 'a.jsonl'), line('m1', 's1', 1, 2, 3, 4) + line('m1', 's1', 1, 2, 3, 4) + line('m2', 's1', 10, 20, 30, 40));
  run(s);
  assert.deepStrictEqual(totals(s), [11, 22, 33, 44]);
});

test('later runs only add new lines', () => {
  const s = sandbox();
  const f = path.join(s.proj, 'a.jsonl');
  fs.writeFileSync(f, line('m1', 's1', 1, 0, 0, 1));
  run(s); run(s);
  assert.deepStrictEqual(totals(s), [1, 0, 0, 1]);
  fs.appendFileSync(f, line('m2', 's1', 5, 0, 0, 5));
  run(s);
  assert.deepStrictEqual(totals(s), [6, 0, 0, 6]);
});

test('a half-written last line is counted once it is complete', () => {
  const s = sandbox();
  const f = path.join(s.proj, 'a.jsonl');
  const whole = line('m1', 's1', 7, 0, 0, 7);
  fs.writeFileSync(f, whole.slice(0, 20));
  run(s);
  assert.ok(!fs.existsSync(s.ledger) || totals(s)[0] === 0);
  fs.appendFileSync(f, whole.slice(20));
  run(s);
  assert.deepStrictEqual(totals(s), [7, 0, 0, 7]);
});

test('multi-byte text split around the read position does not lose lines', () => {
  const s = sandbox();
  const f = path.join(s.proj, 'a.jsonl');
  fs.writeFileSync(f, JSON.stringify({ type: 'user', text: 'åäö €' }) + '\n' + line('m1', 's1', 1, 0, 0, 0));
  run(s);
  fs.appendFileSync(f, JSON.stringify({ type: 'user', text: 'ÅÄÖ 🙂' }) + '\n' + line('m2', 's1', 2, 0, 0, 0));
  run(s);
  assert.strictEqual(totals(s)[0], 3);
});

test('tokens stay counted after the transcript is deleted', () => {
  const s = sandbox();
  const f = path.join(s.proj, 'a.jsonl');
  fs.writeFileSync(f, line('m1', 's1', 9, 0, 0, 9));
  run(s);
  fs.unlinkSync(f);
  fs.writeFileSync(path.join(s.proj, 'b.jsonl'), line('m2', 's2', 1, 0, 0, 1));
  run(s);
  assert.deepStrictEqual(totals(s), [10, 0, 0, 10]);
});

test('a resumed session repeating old messages in a new file is not counted twice', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.proj, 'a.jsonl'), line('m1', 's1', 3, 0, 0, 3));
  fs.writeFileSync(path.join(s.proj, 'b.jsonl'), line('m1', 's1', 3, 0, 0, 3) + line('m2', 's1', 1, 0, 0, 1));
  run(s);
  assert.deepStrictEqual(totals(s), [4, 0, 0, 4]);
});

test('subfolders with subagent transcripts are counted', () => {
  const s = sandbox();
  const sub = path.join(s.proj, 's1/subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent.jsonl'), line('m9', 's1', 8, 0, 0, 2));
  assert.match(run(s), /Chatt 10 /);
});

test('a damaged ledger is kept aside and rebuilt', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.proj, 'a.jsonl'), line('m1', 's1', 2, 0, 0, 2));
  fs.writeFileSync(s.ledger, '{not json');
  run(s);
  assert.deepStrictEqual(totals(s), [2, 0, 0, 2]);
  assert.ok(fs.readdirSync(s.dir).some(n => n.includes('.damaged-')));
});

test('a lock left behind is cleared, a fresh one is respected', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.proj, 'a.jsonl'), line('m1', 's1', 2, 0, 0, 2));
  const lock = path.join(s.dir, '.ledger-lock');
  fs.mkdirSync(lock);
  run(s);
  assert.ok(!fs.existsSync(s.ledger), 'fresh lock: no update');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lock, old, old);
  run(s);
  assert.deepStrictEqual(totals(s), [2, 0, 0, 2]);
  assert.ok(!fs.existsSync(lock));
});

test('several sessions at once never count twice or leave a broken ledger', async () => {
  const s = sandbox();
  let text = '';
  for (let i = 0; i < 2000; i++) text += line(`m${i}`, 's1', 1, 0, 0, 1);
  fs.writeFileSync(path.join(s.proj, 'a.jsonl'), text);
  const env = envOf(s);
  await Promise.all(Array.from({ length: 8 }, () => new Promise((res, rej) => {
    const p = spawn('node', [SRC], { env, stdio: ['pipe', 'ignore', 'inherit'] });
    p.stdin.end('{}');
    p.on('exit', code => (code === 0 ? res() : rej(new Error(`exit ${code}`))));
  })));
  run(s);
  assert.deepStrictEqual(totals(s), [2000, 0, 0, 2000]);
});

test('bad or empty input still prints the lines', () => {
  const s = sandbox();
  for (const input of ['', 'not json', '{}', JSON.stringify({ context_window: { used_percentage: null, current_usage: null }, cost: {}, rate_limits: {} })]) {
    const out = run(s, input);
    assert.strictEqual(out.trim().split('\n').length, 4);
    assert.match(out, /\uf252 Session ░{10} väntar på data │ \uf073 Vecka ░{10} väntar på data/);
    assert.match(out, /Totalt 0 /);
  }
});

test('shows every stat from a full session JSON', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.proj, 'a.jsonl'), line('m1', 's1', 1000, 2000, 3000000, 500) + line('m2', 'other', 1, 0, 0, 1));
  const repo = path.join(s.home, 'myrepo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.git/HEAD'), 'ref: refs/heads/feature\n');
  const out = run(s, {
    session_id: 's1',
    model: { display_name: 'Opus 5.5' }, effort: { level: 'high' }, workspace: { project_dir: repo },
    cost: { total_cost_usd: 1.234, total_duration_ms: 3900000, total_lines_added: 12, total_lines_removed: 3 },
    context_window: { used_percentage: 34, context_window_size: 200000, current_usage: { input_tokens: 8000, cache_creation_input_tokens: 10000, cache_read_input_tokens: 50000, output_tokens: 900 } },
    rate_limits: { five_hour: { used_percentage: 12.4, resets_at: 4102444800 }, seven_day: { used_percentage: 92, resets_at: 4102444800 } },
  });
  for (const expected of ['Opus 5.5 · high', 'myrepo \ue725 feature', '\uf017 1h 5m', '+12 −3', '34% 68.0k/200k', 'Chatt 3.0M', '2 chattar']) {
    assert.ok(out.includes(expected), `missing "${expected}" in:\n${out}`);
  }
});

test('shows the time worked on what the user last wrote, standing still once the chat has stopped', () => {
  const s = sandbox();
  const dir = path.join(s.data, 'clock');
  fs.mkdirSync(dir, { recursive: true });
  const clock = one => fs.writeFileSync(path.join(dir, 's1.json'), JSON.stringify(one));
  const input = { session_id: 's1', cost: { total_duration_ms: 3900000 } };
  assert.match(run(s, input), / 1h 5m/, 'no clock yet: the session time');
  clock({ workedMs: 0, runningSince: Date.now() - 54 * 60000 });
  assert.match(run(s, input), /Uppdrag 54m/, 'running');
  clock({ workedMs: 63 * 60000, runningSince: null });
  assert.match(run(s, input), /Uppdrag 1h 3m/, 'stopped: the time stays');
  assert.match(run(s, { ...input, session_id: 'other' }), / 1h 5m/);
  // Broken off with Esc three minutes in, a long time ago.
  const started = Date.now() - 500 * 60000;
  const transcript = path.join(s.home, 't.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({ type: 'user', timestamp: new Date(started + 3 * 60000).toISOString(), message: { content: '[Request interrupted by user]' } }) + '\n');
  clock({ workedMs: 0, runningSince: started });
  assert.match(run(s, { ...input, transcript_path: transcript }), /Uppdrag 3m/);
});

test('values each token type at the model price', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.proj, 'a.jsonl'), priced('m1', 's1', 'claude-opus-5-5', {
    input_tokens: 1e6, cache_creation_input_tokens: 3e6, cache_read_input_tokens: 1e6, output_tokens: 1e6,
    cache_creation: { ephemeral_5m_input_tokens: 1e6, ephemeral_1h_input_tokens: 2e6 },
  }));
  run(s);
  near(usd(s), 4 + 5 + 2 * 8 + 0.2 + 20);
});

test('cache writes without a split count as 5-minute writes', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.proj, 'a.jsonl'), priced('m1', 's1', 'claude-sonnet-5-5', { cache_creation_input_tokens: 1e6 }));
  run(s);
  near(usd(s), 2.5);
});

test('Haiku 5.5 changes price above 100,000 prompt tokens, cache included', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.proj, 'a.jsonl'),
    priced('m1', 's1', 'claude-haiku-5-5', { input_tokens: 100000, output_tokens: 1e6 }) +
    priced('m2', 's1', 'claude-haiku-5-5', { input_tokens: 1, cache_read_input_tokens: 100000, output_tokens: 1e6 }));
  run(s);
  near(usd(s), 0.01 + 0.5 + (0.5 + 100000 * 0.05) / 1e6 + 2.5);
});

test('fast mode, US-only inference and web searches change the value', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.proj, 'a.jsonl'),
    priced('m1', 's1', 'claude-opus-5-5', { input_tokens: 1e6, speed: 'fast' }) +
    priced('m2', 's1', 'claude-opus-5-5', { input_tokens: 1e6, inference_geo: 'us' }) +
    priced('m3', 's1', 'claude-opus-5-5', { server_tool_use: { web_search_requests: 3 } }));
  run(s);
  near(usd(s), 8 + 4.4 + 0.03);
});

test('a dated model id finds its price', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.proj, 'a.jsonl'), priced('m1', 's1', 'claude-haiku-4-5-20251001', { input_tokens: 1e6 }));
  run(s);
  near(usd(s), 1);
});

test('a model without a price still counts tokens and marks the amount with +', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.proj, 'a.jsonl'),
    priced('m1', 's1', 'claude-opus-5-5', { input_tokens: 1e6 }) +
    priced('m2', 's1', 'claude-future-9', { input_tokens: 500 }));
  const out = run(s);
  assert.strictEqual(totals(s)[0], 1000500);
  near(usd(s), 4);
  assert.match(out, /Totalt 1\.0M ≈ \$4\.00\+/);
});

test('shows the total with its value, then the session with its value', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.proj, 'a.jsonl'),
    priced('m1', 's1', 'claude-opus-5-5', { input_tokens: 1e6 }) +
    priced('m2', 's2', 'claude-opus-5-5', { output_tokens: 1e6 }));
  const out = run(s, { session_id: 's1' });
  assert.match(out, /Totalt 2\.0M ≈ \$24\.00  14\.0 L \(↑1\.0M ↓1\.0M cache 0\) │ . Chatt 1\.0M ≈ \$4\.00  7\.0 L │   2 chattar/);
});

test('shows cooling water at seven litres per million tokens, cache included', () => {
  const water = (input, cacheRead) => {
    const s = sandbox();
    fs.writeFileSync(path.join(s.proj, 'a.jsonl'), line('m1', 's1', input, 0, cacheRead, 0));
    return run(s).match(/Totalt \S+ ≈ \S+  ([^(]+) \(/)[1];
  };
  assert.strictEqual(water(0, 0), '0 ml');
  assert.strictEqual(water(100000, 0), '700 ml');
  assert.strictEqual(water(1000, 2500000), '17.5 L');
  assert.strictEqual(water(0, 1234000000), '8638 L');
});

test('an amount already counted stays when the transcript is gone', () => {
  const s = sandbox();
  const f = path.join(s.proj, 'a.jsonl');
  fs.writeFileSync(f, priced('m1', 's1', 'claude-opus-5-5', { input_tokens: 1e6 }));
  run(s);
  fs.unlinkSync(f);
  run(s);
  near(usd(s), 4);
});

const FUTURE = 4102444800; // year 2100
const barsLine = out => out.trim().split('\n')[2];

test('shows one bar for the session and one for the week', () => {
  const s = sandbox();
  const line = barsLine(run(s, { rate_limits: { five_hour: { used_percentage: 12.4, resets_at: FUTURE }, seven_day: { used_percentage: 70, resets_at: FUTURE } } }));
  assert.match(line, /^\uf252 Session █░{9} 12% \uf021 \d\d:\d\d │ \uf073 Vecka █{7}░{3} 70% \uf021 \S+ \d\d:\d\d$/);
});

test('a limit window that has ended shows as empty', () => {
  const s = sandbox();
  const line = barsLine(run(s, { rate_limits: { five_hour: { used_percentage: 95, resets_at: 1000 }, seven_day: { used_percentage: 40, resets_at: FUTURE } } }));
  assert.match(line, /^\uf252 Session ░{10} 0% │ \uf073 Vecka █{4}░{6} 40%/);
});

test('one missing window does not hide the other, and values stay within 0 to 100', () => {
  const s = sandbox();
  const line = barsLine(run(s, { rate_limits: { seven_day: { used_percentage: 120, resets_at: FUTURE } } }));
  assert.match(line, /^\uf252 Session ░{10} väntar på data │ \uf073 Vecka █{10} 100%/);
});

test('the week shows what it will have used at its reset, at its pace so far', () => {
  const s = sandbox();
  // Half the week has passed and 40 % is used.
  const half = Math.round(Date.now() / 1000 + 3.5 * 24 * 3600);
  let line = barsLine(run(s, { rate_limits: { seven_day: { used_percentage: 40, resets_at: half } } }));
  assert.match(line, /Vecka █{4}░{6} 40% \uf021 \S+ \d\d:\d\d · prognos 80%$/);
  // 60 % at the halfway mark runs out after 5 5/6 days, a day and 20 hours from now.
  line = barsLine(run(s, { rate_limits: { seven_day: { used_percentage: 60, resets_at: half } } }));
  assert.match(line, /· prognos 120%, slut \S+ \d\d:\d\d$/);
  // The first hours of a week say too little.
  const early = Math.round(Date.now() / 1000 + 6.9 * 24 * 3600);
  line = barsLine(run(s, { rate_limits: { seven_day: { used_percentage: 5, resets_at: early } } }));
  assert.doesNotMatch(line, /prognos/);
  assert.doesNotMatch(barsLine(run(s, { rate_limits: { five_hour: { used_percentage: 50, resets_at: half } } })), /prognos/);
});

test('null usage values wait for data instead of showing 0%', () => {
  const s = sandbox();
  const line = barsLine(run(s, { rate_limits: { five_hour: { used_percentage: null }, seven_day: null } }));
  assert.match(line, /^\uf252 Session ░{10} väntar på data │ \uf073 Vecka ░{10} väntar på data$/);
});

test('shows the effort picked in this chat, and the chat without a pick keeps the one it was given', () => {
  const s = sandbox();
  const dir = path.join(s.data, 'chat-effort');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'picked'), 'low');
  const opus = { id: 'claude-opus-5-5', display_name: 'Opus 5.5' };
  const effort = { level: 'high' };
  assert.match(run(s, { session_id: 'picked', model: opus, effort }), /Opus 5\.5 · low/);
  assert.match(run(s, { session_id: 'other', model: opus, effort }), /Opus 5\.5 · high/);
  const sonnet = { id: 'claude-sonnet-5-5', display_name: 'Sonnet 5.5' };
  assert.match(run(s, { session_id: 'picked', model: sonnet, effort }), /Sonnet 5\.5 · high/);
});

test('the session figure is written for the pause, and within one session the highest one stands', () => {
  const s = sandbox();
  const file = path.join(s.data, 'pause/limit.json');
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const five = (used, resets = FUTURE) => ({ rate_limits: { five_hour: { used_percentage: used, resets_at: resets } } });
  run(s, {});
  assert.ok(!fs.existsSync(file), 'nothing known, nothing written');
  run(s, five(96.5));
  assert.deepStrictEqual(read(), { used_percentage: 96.5, resets_at: FUTURE });
  run(s, five(40));
  assert.strictEqual(read().used_percentage, 96.5, 'a chat that has been still knows an older figure');
  run(s, five(3, FUTURE + 18000));
  assert.deepStrictEqual(read(), { used_percentage: 3, resets_at: FUTURE + 18000 }, 'a new session starts over');
  run(s, five(99, 1000));
  assert.strictEqual(read().used_percentage, 3, 'a session that has ended is not written');
});

test('Fable 5.2 has its price, and fast mode doubles it', () => {
  const s = sandbox();
  const u = { input_tokens: 1e6, cache_creation_input_tokens: 2e6, cache_creation: { ephemeral_5m_input_tokens: 1e6, ephemeral_1h_input_tokens: 1e6 }, cache_read_input_tokens: 1e6, output_tokens: 1e6 };
  fs.writeFileSync(path.join(s.proj, 'a.jsonl'), priced('m1', 's1', 'claude-fable-5-2', u));
  run(s);
  near(usd(s), 8 + 10 + 16 + 0.2 + 40);
  fs.appendFileSync(path.join(s.proj, 'a.jsonl'), priced('m2', 's1', 'claude-fable-5-2', { ...u, speed: 'fast' }));
  run(s);
  near(usd(s), 3 * 74.2);
  assert.strictEqual(ledgerOf(s).unvalued, 0);
});

test('a response counted before its model had a price gets its value afterwards, and the tokens stay', async () => {
  const s = sandbox();
  const f = path.join(s.proj, 'a.jsonl');
  const u = { input_tokens: 1e6, cache_read_input_tokens: 1e6, output_tokens: 1e6 };
  // Counted while the model was unknown: a name of the same length, so the file is not read again as new.
  fs.writeFileSync(f, priced('m1', 's1', 'claude-fable-9-9', u) + priced('m2', 's1', 'claude-opus-5-5', u));
  run(s);
  assert.strictEqual(ledgerOf(s).unvalued, 3e6);
  assert.match(run(s), /\$24\.20\+/);
  fs.writeFileSync(f, priced('m1', 's1', 'claude-fable-5-2', u) + priced('m2', 's1', 'claude-opus-5-5', u));
  const env = envOf(s);
  const r = spawnSync('node', [SRC, 'revalue'], { env, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /^1 svar fick ett värde\n$/);
  const after = ledgerOf(s);
  near(after.totals[4], 24.2 + 48.2);
  near(after.sessions.s1[4], 24.2 + 48.2);
  assert.deepStrictEqual([after.unvalued, after.seen.m1[4], after.totals.slice(0, 4)], [0, 48.2, [2e6, 0, 2e6, 2e6]]);
  assert.doesNotMatch(run(s), /\$72\.40\+/);
  assert.match(run(s), /\$72\.40/);
  // A second time changes nothing.
  spawnSync('node', [SRC, 'revalue'], { env, encoding: 'utf8' });
  near(ledgerOf(s).totals[4], 72.4);
});

test('a status line run starts that revaluing by itself, once', async () => {
  const s = sandbox();
  const f = path.join(s.proj, 'a.jsonl');
  const u = { input_tokens: 1e6, output_tokens: 0 };
  fs.writeFileSync(f, priced('m1', 's1', 'claude-fable-9-9', u));
  run(s);
  const settled = async () => { for (let i = 0; i < 100 && ledgerOf(s).priced === undefined; i += 1) await new Promise(done => setTimeout(done, 100)); };
  // The first run already looked, found no price, and does not look again by itself.
  await settled();
  assert.strictEqual(ledgerOf(s).totals[4], 0);
  // As on a computer whose ledger was written before the price was added.
  const old = ledgerOf(s);
  delete old.priced;
  fs.writeFileSync(s.ledger, JSON.stringify(old));
  fs.writeFileSync(f, priced('m1', 's1', 'claude-fable-5-2', u));
  run(s);
  await settled();
  near(ledgerOf(s).totals[4], 8);
  const lock = path.join(s.dir, '.revalue-lock');
  for (let i = 0; i < 50 && fs.existsSync(lock); i += 1) await new Promise(done => setTimeout(done, 100));
  assert.ok(!fs.existsSync(lock));
});

const { months } = require('./statusline.js');
const timedLine = (id, iso, input) => JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: iso, message: { id, model: 'claude-opus-5-5', usage: { input_tokens: input } } }) + '\n';
const thisMonthKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

test('a new installation starts empty, with this month and nothing else', () => {
  const s = sandbox();
  const out = run(s);
  assert.match(out, /Kontext .* │ . Månad [a-z]{3} 0 ≈ \$0\.00\n/);
  assert.match(out, /Totalt 0 ≈ \$0\.00/);
  const list = JSON.parse(fs.readFileSync(path.join(s.dir, 'months.json'), 'utf8'));
  assert.deepStrictEqual(list, [{ key: thisMonthKey(), tokens: 0, usd: 0, current: true }]);
});

test('the line shows this month beside the context, and the list for the button is written', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.proj, 'a.jsonl'), timedLine('m1', new Date().toISOString(), 2e6));
  const out = run(s);
  assert.match(out, /Totalt 2\.0M ≈ \$8\.00/);
  assert.match(out, /Kontext .* │ . Månad [a-z]{3} 2\.0M ≈ \$8\.00\n/, 'to the right of the context, where there is room');
  const list = JSON.parse(fs.readFileSync(path.join(s.dir, 'months.json'), 'utf8'));
  assert.deepStrictEqual(list[list.length - 1], { key: thisMonthKey(), tokens: 2e6, usd: 8, current: true });
});

test('a new month starts from nothing while the total rolls on, and each month keeps its own', () => {
  const ledger = { startedAt: '2026-11-10T09:00:00', seen: {
    m1: [1e6, 0, 0, 0, 4, Date.parse('2026-11-20T12:00:00') / 1000],
    m2: [2e6, 0, 0, 0, 8, Date.parse('2026-12-05T12:00:00') / 1000],
    m3: [1e6, 0, 0, 0, 4, Date.parse('2026-12-06T12:00:00') / 1000],
    m4: [5e6, 0, 0, 0, 20, Date.parse('2027-02-01T12:00:00') / 1000],
  } };
  assert.deepStrictEqual(months(ledger, Date.parse('2027-02-10T12:00:00')), [
    { key: '2026-11', tokens: 1e6, usd: 4, current: false },
    { key: '2026-12', tokens: 3e6, usd: 12, current: false },
    { key: '2027-01', tokens: 0, usd: 0, current: false },
    { key: '2027-02', tokens: 5e6, usd: 20, current: true },
  ]);
});

test('the months begin when counting started, or earlier when older chats were found on the first run', () => {
  const at = iso => Date.parse(iso) / 1000;
  assert.deepStrictEqual(months({ startedAt: '2027-03-15T09:00:00', seen: {} }, Date.parse('2027-05-01T12:00:00')).map(m => m.key), ['2027-03', '2027-04', '2027-05']);
  const older = { startedAt: '2027-03-15T09:00:00', seen: { m1: [1e6, 0, 0, 0, 4, at('2027-01-20T12:00:00')], m2: [3, 0, 0, 0, null, 0] } };
  const list = months(older, Date.parse('2027-03-20T12:00:00'));
  assert.deepStrictEqual(list.map(m => [m.key, m.tokens, m.usd]), [['2027-01', 1e6 + 3, 4], ['2027-02', 0, 0], ['2027-03', 0, 0]], 'a response without a time goes to the first month');
});

test('HERDR_TEMPLATE_DATA moves everything the status line keeps', () => {
  const s = sandbox();
  const elsewhere = path.join(s.home, 'elsewhere');
  fs.writeFileSync(path.join(s.proj, 'a.jsonl'), timedLine('m1', new Date().toISOString(), 1e6));
  run(s, { session_id: 's1', rate_limits: { five_hour: { used_percentage: 50, resets_at: FUTURE } } }, { HERDR_TEMPLATE_DATA: elsewhere });
  for (const file of ['statusline/usage-ledger.json', 'statusline/months.json', 'pause/limit.json']) {
    assert.ok(fs.existsSync(path.join(elsewhere, file)), file);
  }
  assert.ok(!fs.existsSync(s.ledger), 'nothing in the default place');
});

// ---- A new version of the template ----

// A bare "GitHub" with the template's version file, and a clone of it as the installed template.
function templateRepos(s, version) {
  const git = (cwd, ...args) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
  };
  const origin = path.join(s.home, 'origin.git');
  const work = path.join(s.home, 'work');
  const repo = path.join(s.home, 'template');
  git(s.home, 'init', '-q', '--bare', '-b', 'main', origin);
  git(s.home, 'clone', '-q', origin, work);
  fs.writeFileSync(path.join(work, 'version.txt'), `${version}\n`);
  git(work, 'add', '.');
  git(work, 'commit', '-qm', version);
  git(work, 'push', '-q', 'origin', 'HEAD:main');
  git(s.home, 'clone', '-q', origin, repo);
  const release = next => {
    fs.writeFileSync(path.join(work, 'version.txt'), `${next}\n`);
    git(work, 'commit', '-qam', next);
    git(work, 'push', '-q', 'origin', 'HEAD:main');
  };
  return { repo, release };
}
const seedUpdate = (s, update) => fs.writeFileSync(path.join(s.data, 'update.json'), JSON.stringify(update));
const firstLine = out => out.split('\n')[0];
const recently = () => new Date().toISOString();

test('a newer version on GitHub shows a notice at the end of the first line', () => {
  const s = sandbox();
  const { repo } = templateRepos(s, '2.0.0');
  seedUpdate(s, { checkedAt: recently(), local: '2.0.0', remote: '2.1.0' });
  assert.match(firstLine(run(s, {}, { HERDR_TEMPLATE_REPO: repo })), /│ ⬆ Ny version 2\.1\.0: skriv uppdatera$/);
});

test('no notice when the template is up to date, newer than GitHub, or nothing is known', () => {
  const s = sandbox();
  const { repo } = templateRepos(s, '2.1.0');
  for (const remote of ['2.1.0', '2.0.9', null, 'garbage']) {
    seedUpdate(s, { checkedAt: recently(), local: '2.1.0', remote });
    assert.doesNotMatch(run(s, {}, { HERDR_TEMPLATE_REPO: repo }), /Ny version/, String(remote));
  }
  fs.rmSync(path.join(s.data, 'update.json'));
  fs.writeFileSync(path.join(s.data, 'update.json'), '{broken');
  assert.doesNotMatch(run(s, {}, { HERDR_TEMPLATE_DATA: s.data, HERDR_TEMPLATE_REPO: path.join(s.home, 'none') }), /Ny version/);
});

test('versions compare number by number', () => {
  const { compareVersions } = require(SRC);
  assert.strictEqual(compareVersions('2.10.0', '2.9.3'), 1);
  assert.strictEqual(compareVersions('2.0', '2.0.0'), 0);
  assert.strictEqual(compareVersions('1.9.9', '2.0.0'), -1);
});

test('the check fetches the version from GitHub, and the notice goes once the template is updated', () => {
  const s = sandbox();
  const { repo, release } = templateRepos(s, '2.0.0');
  release('2.1.0');
  const env = envOf(s, { HERDR_TEMPLATE_REPO: repo });
  const r = spawnSync('node', [SRC, 'check-update'], { env, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const update = JSON.parse(fs.readFileSync(path.join(s.data, 'update.json'), 'utf8'));
  assert.deepStrictEqual([update.local, update.remote], ['2.0.0', '2.1.0']);
  assert.match(run(s, {}, { HERDR_TEMPLATE_REPO: repo }), /Ny version 2\.1\.0/);
  spawnSync('git', ['-C', repo, 'pull', '-q', '--ff-only'], { encoding: 'utf8' });
  assert.doesNotMatch(run(s, {}, { HERDR_TEMPLATE_REPO: repo }), /Ny version/, 'gone as soon as version.txt is new');
});

test('offline, the check writes that nothing is known and shows no notice', () => {
  const s = sandbox();
  const env = envOf(s, { HERDR_TEMPLATE_REPO: path.join(s.home, 'not-a-repo') });
  assert.strictEqual(spawnSync('node', [SRC, 'check-update'], { env, encoding: 'utf8' }).status, 0);
  const update = JSON.parse(fs.readFileSync(path.join(s.data, 'update.json'), 'utf8'));
  assert.strictEqual(update.remote, null);
  assert.ok(Date.parse(update.checkedAt) > Date.now() - 60000);
});

test('the status line starts a check only when the last one is over six hours old', async () => {
  const s = sandbox();
  const { repo, release } = templateRepos(s, '2.0.0');
  release('2.2.0');
  const file = path.join(s.data, 'update.json');
  const settle = async () => {
    for (let i = 0; i < 100 && fs.existsSync(path.join(s.data, '.update-check-lock')); i += 1) await new Promise(done => setTimeout(done, 100));
  };
  // Checked an hour ago: nothing is started, the file stays as it was.
  const hourAgo = new Date(Date.now() - 3600e3).toISOString();
  seedUpdate(s, { checkedAt: hourAgo, local: '2.0.0', remote: '2.0.0' });
  run(s, {}, { HERDR_TEMPLATE_REPO: repo });
  await new Promise(done => setTimeout(done, 1500));
  await settle();
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).checkedAt, hourAgo);
  // Seven hours ago: a check runs in the background and finds the new version.
  seedUpdate(s, { checkedAt: new Date(Date.now() - 7 * 3600e3).toISOString(), local: '2.0.0', remote: '2.0.0' });
  run(s, {}, { HERDR_TEMPLATE_REPO: repo });
  for (let i = 0; i < 100 && JSON.parse(fs.readFileSync(file, 'utf8')).remote !== '2.2.0'; i += 1) await new Promise(done => setTimeout(done, 100));
  await settle();
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).remote, '2.2.0');
  assert.ok(!fs.existsSync(path.join(s.data, '.update-check-lock')));
});

test('the trackers fade from green through yellow to red', () => {
  const { heatColour, limitHeat, contextHeat } = require('./statusline.js');
  assert.deepStrictEqual(heatColour(0), [19, 161, 14]);
  assert.deepStrictEqual(heatColour(0.5), [193, 156, 0]);
  assert.deepStrictEqual(heatColour(1), [197, 15, 31]);
  assert.strictEqual(limitHeat(50), 0);
  assert.ok(limitHeat(80) > 0.8 && limitHeat(80) < 1, 'nearly red at 80 %');
  assert.strictEqual(limitHeat(90), 1);
  assert.strictEqual(contextHeat(250e3), 0);
  assert.strictEqual(contextHeat(325e3), 0.5);
  assert.strictEqual(contextHeat(400e3), 1);
  assert.strictEqual(contextHeat(1e6), 1);
});

test('the bars carry the fade colour', () => {
  const s = sandbox();
  const input = {
    session_id: 's1',
    context_window: { used_percentage: 40, context_window_size: 1e6, current_usage: { input_tokens: 400e3 } },
    rate_limits: { five_hour: { used_percentage: 20, resets_at: Date.now() / 1000 + 3600 } },
  };
  const r = spawnSync('node', [SRC], { input: JSON.stringify(input), env: envOf(s), encoding: 'utf8' });
  assert.ok(r.stdout.includes('\x1b[38;2;197;15;31m40%'), 'the context at 400k is red');
  assert.ok(r.stdout.includes('\x1b[38;2;19;161;14m20%'), 'the session at 20 % is green');
});
