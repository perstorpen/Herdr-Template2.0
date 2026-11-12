import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { EffortLevel } from '../types'

// The buttons of Herdr-Template2.0. The status line is plain text from a command, so it can't hold a button.
// The buttons sit on the hint line under it, in the normal layout.
//   /compact      runs /compact
//   månad         shows the tokens and dollars of every month, which the status line works out
//   effort        low … max for this chat only (Opus models)
// It also puts a green ✔ KLAR under a finished turn, and the user's own messages on a green background.

const USER_ROW = '#14632d'
const USER_TEXT = '#ffffff'

// The kinds a person writes. A message stored before the engine stamped rows is unclassified, so an old chat
// that is resumed counts too, unless the row names another sender.
const isUsersRow = (props: { origin: { kind: string }, task?: unknown, from?: unknown }) =>
  ['composer', 'bridge', 'unclassified'].includes(props.origin.kind) && !props.task && !props.from

const LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']
const chosenEffort = atom({ plugin: 'herdr-template-buttons', key: 'effort' } as const, null)

// Where the template keeps its files: $HERDR_TEMPLATE_DATA, or ~/.claude/herdr-template. The status line uses the same.
const dataDir = async ($: EngineInterface) => (await $.env.get('HERDR_TEMPLATE_DATA')) || `${await $.env.get('HOME')}/.claude/herdr-template`

// The months of the token counter. The status line works them out and writes them to a file; they are only shown here.
const monthsOpen = atom({ plugin: 'herdr-template-buttons', key: 'monthsOpen' } as const, false)

type Month = { key: string, tokens: number, usd: number, current: boolean }

const MONTH_NAMES = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december']

async function savedMonths($: EngineInterface): Promise<Month[]> {
  const text = await $.fs.read(`${await dataDir($)}/statusline/months.json`).catch(() => '[]')
  try {
    const list = JSON.parse(text)
    return Array.isArray(list) ? list.filter(month => month && typeof month.key === 'string') : []
  } catch {
    return []
  }
}

// The same short forms as on the status line.
function tokenText(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`
  return String(n)
}

const monthName = (key: string) => `${MONTH_NAMES[Number(key.slice(5)) - 1] ?? key} ${key.slice(0, 4)}`

const isOpus = (model: string) => model.toLowerCase().includes('opus')

// One file per chat, named by its session id, so a choice stays with that chat through a restart and reaches
// no other. The status line reads it too, because it only knows the effort from the settings.
const effortFile = async ($: EngineInterface) => `${await dataDir($)}/chat-effort/${await $.session.id()}`

async function savedEffort($: EngineInterface): Promise<EffortLevel | null> {
  const saved = await $.fs.read(await effortFile($)).catch(() => '')
  return LEVELS.find(level => level === saved.trim()) ?? null
}

// What the settings give this model, shown until the chat has a choice of its own.
async function settingsEffort($: EngineInterface, model: string): Promise<string | undefined> {
  const settings = await $.settings.read({ key: 'modelSettings' }) as Record<string, { effortLevel?: string }> | undefined
  return settings?.[model]?.effortLevel
}

export const register: Register = on => {
  let isRunning = false

  on('session.start', async ($, e, next) => {
    // Without this a screen that has drifted from the engine's model stays garbled, because only changed cells
    // are drawn. The settings' `env` only reaches a chat that starts after it was set, and a reload of this mod
    // reaches every running chat, so a long-lived one is repaired without a restart.
    await $.env.set('CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT', '1')

    const saved = await savedEffort($)
    await update($, chosenEffort, () => saved)
    return next(e)
  })

  // Sent with each request and written to no settings file, so it stays with this chat. It wins over /effort.
  on('turn.step', async function* ($, e, next) {
    const level = await read($, chosenEffort)
    return yield* next(level && isOpus(e.model) ? { ...e, effort: level } : e)
  })

  // The engine's own background on this row can't be changed, so the row is drawn here instead.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !isUsersRow(e.props)) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box marginTop={1} flexDirection="row" backgroundColor={USER_ROW}>
        <Text color={USER_TEXT} backgroundColor={USER_ROW}>❯ </Text>
        <Box flexGrow={1} backgroundColor={USER_ROW}>
          <Text color={USER_TEXT} backgroundColor={USER_ROW}>{e.props.text}</Text>
        </Box>
      </Box>
    )
  })

  // The engine's own line can't be coloured, so a green word goes with it. A line still waiting on
  // background agents isn't finished.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const line = await next(e)

    if (e.props.waitingFor) {
      return line
    }

    const { Box, Text } = $.ui.resolve(e)

    // In a row the engine's line takes the whole width and squeezes the word away, so it goes underneath.
    return (
      <Box flexDirection="column">
        {line}
        <Text color="#00c853" bold>✔ KLAR</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const line = await next(e)

    if (e.surface !== 'terminal') {
      return line
    }

    const { Box, Button, Text } = $.ui.resolve(e)

    // A press handler gets 10 seconds and /compact takes longer, so it is started here and not waited for.
    const compact = () => {
      // A second press while one is waiting would compact twice and spend the tokens twice.
      if (isRunning) {
        return
      }

      isRunning = true
      $.ui.toast('Kör /compact')

      $.command.run({ command: 'compact' })
        .catch(error => {
          $.ui.toast(`/compact gick inte att köra: ${error instanceof Error ? error.message : String(error)}`)
        })
        .finally(() => {
          isRunning = false
        })
    }

    const model = await $.session.model()
    const current = isOpus(model) ? (await read($, chosenEffort)) ?? await settingsEffort($, model) : undefined

    const choose = (level: EffortLevel) => async () => {
      await update($, chosenEffort, () => level)
      await $.fs.write(await effortFile($), level)
      $.ui.toast(`Effort ${level}, bara i den här chatten`)
    }

    const effortButtons = isOpus(model) && (
      <Box flexDirection="row" justifyContent="flex-end" gap={1}>
        {LEVELS.map(level => (
          <Button
            key={`effort-${level}`}
            label={level}
            variant={level === current ? 'primary' : undefined}
            dimColor={level !== current}
            onPress={choose(level)}
          />
        ))}
      </Box>
    )

    const isOpen = await read($, monthsOpen)
    const months = isOpen ? (await savedMonths($)).reverse() : []
    const toggleMonths = async () => {
      await update($, monthsOpen, open => !open)
    }

    // The newest month first; the one that is still running says so.
    const monthList = isOpen && (
      <Box flexDirection="column" alignItems="flex-end">
        <Text bold>Tokens och dollar per månad</Text>
        {months.length === 0 && <Text dimColor>Inga månader än</Text>}
        {months.map(month => (
          <Text key={`month-${month.key}`} dimColor={!month.current}>
            {`${monthName(month.key)}${month.current ? ' (pågår)' : ''}  ${tokenText(month.tokens)}  ≈ $${month.usd.toFixed(2)}`}
          </Text>
        ))}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {monthList}
        {effortButtons}
        <Box flexDirection="row">
        <Box flexGrow={1}>{line}</Box>
        <Button key="months" label={isOpen ? 'månad ▾' : 'månad ▸'} variant={isOpen ? 'primary' : undefined} onPress={toggleMonths} />
        <Button key="compact" label={' /compact'} onPress={compact} />
        </Box>
      </Box>
    )
  })
}
