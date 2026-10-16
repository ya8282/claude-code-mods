export type Pending = string | null

declare module 'claude-code' {
  interface PluginState {
    'copy-commands': { pending: Pending }
  }
}
