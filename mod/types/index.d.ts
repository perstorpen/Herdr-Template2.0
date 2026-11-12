export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

declare module 'claude-code' {
  interface PluginState {
    'herdr-template-buttons': { effort: EffortLevel | null, monthsOpen: boolean }
  }
}
