import { expect, test } from 'claude-code/testing'

const HINT = {
  plugin: 'herdr-template-buttons',
  component: 'PromptHint',
  requestId: 'hint',
  surface: 'terminal',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

const HOME = '/home/test'
const FILE = `${HOME}/.claude/herdr-template/chat-effort/chat-1`
const sent: unknown[] = []
const envSet: Record<string, string | undefined> = {}
// Variables the chat's environment has besides HOME.
const env: Record<string, string | undefined> = {}

// Stands for the engine: a chat on `model`, with `files` as the disk.
function chat(on, { model = 'claude-opus-5-5', files = {} as Record<string, string>, level = 'high' } = {}) {
  on('session.model', () => ({ value: model }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? HOME : env[e.name] }))
  on('env.set', (_, e) => {
    envSet[e.name] = e.value
    return { value: {} }
  })
  on('settings.read', () => ({ value: { modelSettings: { [model]: { effortLevel: level } } } }))
  on('fs.read', (_, e) => {
    if (!(e.path in files)) throw new Error('missing')
    return { value: files[e.path] }
  })
  on('fs.write', (_, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.step', async function* (_, e) {
    sent.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return files
}

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const

test('every chat repaints whole frames, also one that started before the setting', async ($, on) => {
  delete envSet.CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT
  chat(on)
  await $.session.start(START)
  expect(envSet.CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT).toBe('1')
})

test('the button runs /compact', async ($, on) => {
  const ran: string[] = []
  chat(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('command.run', (_, e) => {
    ran.push(e.command)
    return { value: { text: '' } }
  })

  const ui = await $.ui.mount(HINT)
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  const button = await ui.find({ type: 'Button', key: 'compact' })
  expect(button).toBeDefined()
  await ui.press({ key: 'compact' })
  expect(ran).toEqual(['compact'])
  await ui.unmount()
})

const LINE = {
  plugin: 'herdr-template-buttons',
  component: 'TurnDuration',
  requestId: 'line',
  surface: 'terminal',
  props: { word: 'Baked', durationMs: 3000 },
} as const

test('a finished turn says KLAR in green with the engine\'s line', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ui = await $.ui.mount(LINE)
  expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()
  const done = await ui.find({ type: 'Text', text: /KLAR/ })
  expect(done?.props.color).toBe('#00c853')
  await ui.unmount()
})

test('a line still waiting on background agents does not say KLAR', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({
    ...LINE,
    props: { ...LINE.props, waitingFor: { agents: [], workflows: 1 } },
  })
  expect(await ui.find({ type: 'Text', text: /KLAR/ })).toBeUndefined()
  await ui.unmount()
})

const ROW = {
  plugin: 'herdr-template-buttons',
  component: 'UserMessage',
  requestId: 'row',
  surface: 'terminal',
  props: { text: 'fixa knappen', origin: { kind: 'composer' }, isExpanded: true },
} as const

const engine = ($, e) => {
  const { Text } = $.ui.resolve(e)
  return <Text>engine</Text>
}

test('the user\'s own message is on a green background', async ($, on) => {
  on('ui.render', engine)

  const ui = await $.ui.mount(ROW)
  const text = await ui.find({ type: 'Text', text: /fixa knappen/ })
  expect(text?.props.backgroundColor).toBe('#14632d')
  expect(await ui.find({ type: 'Text', text: /engine/ })).toBeUndefined()
  await ui.unmount()
})

test('a message from an old chat without a stamp is green too', async ($, on) => {
  on('ui.render', engine)

  const ui = await $.ui.mount({ ...ROW, props: { ...ROW.props, origin: { kind: 'unclassified' } } })
  expect(await ui.find({ type: 'Text', text: /fixa knappen/ })).toBeDefined()
  await ui.unmount()
})

test('rows from others keep the engine\'s look', async ($, on) => {
  on('ui.render', engine)

  const rows = [
    { origin: { kind: 'task-notification' } },
    { origin: { kind: 'unclassified' }, from: { name: 'Questions' } },
    { origin: { kind: 'composer' }, task: { id: 'x' } },
  ]
  for (const row of rows) {
    const ui = await $.ui.mount({ ...ROW, props: { ...ROW.props, ...row } })
    expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()
    await ui.unmount()
  }
})

const effortButton = (ui, level: string) => ui.find({ type: 'Button', key: `effort-${level}` })

// The level the model is sent, for one request of the main loop or of an agent.
async function stepEffort($, step = {}) {
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1, ...step })) {
    // The stream's pieces don't matter here.
  }
  return sent.at(-1)
}

test('the effort buttons show what the settings give, and a press replaces it in this chat', async ($, on) => {
  on('ui.render', engine)
  const files = chat(on)

  const ui = await $.ui.mount(HINT)
  expect((await effortButton(ui, 'high'))?.props.variant).toBe('primary')
  expect((await effortButton(ui, 'low'))?.props.dimColor).toBe(true)

  await ui.press({ key: 'effort-low' })
  expect(files[FILE]).toBe('low')
  expect((await effortButton(ui, 'low'))?.props.variant).toBe('primary')
  expect((await effortButton(ui, 'high'))?.props.variant).toBeUndefined()
  await ui.unmount()
})

test('a request uses this chat\'s choice, and with none it is left alone', async ($, on) => {
  on('ui.render', engine)
  chat(on)
  expect(await stepEffort($)).toBe('high')

  const ui = await $.ui.mount(HINT)
  await ui.press({ key: 'effort-max' })
  await ui.unmount()
  expect(await stepEffort($)).toBe('max')
  expect(await stepEffort($, { agentId: 'fork-1' })).toBe('max')
})

test('another model keeps its effort and gets no effort buttons', async ($, on) => {
  on('ui.render', engine)
  chat(on, { model: 'claude-sonnet-5-5', files: { [FILE]: 'max' } })
  await $.session.start(START)

  const ui = await $.ui.mount(HINT)
  expect(await effortButton(ui, 'high')).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'compact' })).toBeDefined()
  await ui.unmount()
  expect(await stepEffort($, { model: 'claude-sonnet-5-5' })).toBe('high')
})

test('a chat gets its own choice back when it starts again, and nothing else counts', async ($, on) => {
  on('ui.render', engine)
  chat(on, { files: { [FILE]: 'xhigh\n' } })
  await $.session.start(START)
  expect(await stepEffort($)).toBe('xhigh')
})

test('a broken file means no choice', async ($, on) => {
  on('ui.render', engine)
  chat(on, { files: { [FILE]: 'ultra' } })
  await $.session.start(START)
  expect(await stepEffort($)).toBe('high')
})

const MONTHS_FILE = `${HOME}/.claude/herdr-template/statusline/months.json`

test('the månad button opens the list of months, newest first, and closes it again', async ($, on) => {
  chat(on, { files: { [MONTHS_FILE]: JSON.stringify([
    { key: '2026-11', tokens: 3024131303, usd: 1279.99, current: false },
    { key: '2026-12', tokens: 41500000, usd: 12.5, current: true },
  ]) } })
  on('ui.render', engine)

  const ui = await $.ui.mount(HINT)
  expect(await ui.find({ type: 'Text', text: /november/ })).toBeUndefined()
  await ui.press({ key: 'months' })
  expect((await ui.find({ type: 'Text', text: /november/ }))?.text).toBe('november 2026  3.02B  ≈ $1279.99')
  expect((await ui.find({ type: 'Text', text: /december/ }))?.text).toBe('december 2026 (pågår)  41.5M  ≈ $12.50')
  const rows = (await ui.findAll({ type: 'Text', text: /2026/ })).map(row => row.text)
  expect(rows[0]).toMatch(/december/)
  await ui.press({ key: 'months' })
  expect(await ui.find({ type: 'Text', text: /november/ })).toBeUndefined()
  await ui.unmount()
})

test('without the file the list says there are no months yet', async ($, on) => {
  chat(on)
  on('ui.render', engine)
  const ui = await $.ui.mount(HINT)
  await ui.press({ key: 'months' })
  expect(await ui.find({ type: 'Text', text: /Inga månader än/ })).toBeDefined()
  await ui.press({ key: 'months' })
  await ui.unmount()
})

test('HERDR_TEMPLATE_DATA moves where the effort and the months are kept', async ($, on) => {
  env.HERDR_TEMPLATE_DATA = '/data'
  try {
    const files = chat(on, { files: { '/data/statusline/months.json': JSON.stringify([{ key: '2027-01', tokens: 1000, usd: 1, current: true }]) } })
    on('ui.render', engine)
    const ui = await $.ui.mount(HINT)
    await ui.press({ key: 'months' })
    expect((await ui.find({ type: 'Text', text: /januari/ }))?.text).toBe('januari 2027 (pågår)  1.0k  ≈ $1.00')
    await ui.press({ key: 'effort-max' })
    expect(files['/data/chat-effort/chat-1']).toBe('max')
    await ui.unmount()
  } finally {
    delete env.HERDR_TEMPLATE_DATA
  }
})
