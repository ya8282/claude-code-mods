import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

const SHELL = new Set(['', 'sh', 'bash', 'zsh', 'shell', 'console'])
const FENCE = /^```([\w-]*)[^\n]*\n([\s\S]*?)^```[ \t]*$/gm

const pending = atom({ plugin: 'copy-commands', key: 'pending' } as const, null)

// Untagged blocks count too: printed commands are often fenced without a language.
export const shellBlocks = (text: string): string[] =>
  [...text.matchAll(FENCE)]
    .filter(([, lang = '']) => SHELL.has(lang.toLowerCase()))
    .map(([, , body = '']) => body)
    .filter(body => body.trim() !== '')

export const commandLines = (text: string): number =>
  text.split('\n').filter(l => l.trim() && !l.trimStart().startsWith('#')).length

const copyPending = async ($: EngineInterface, surface?: RenderSurface): Promise<string> => {
  const text = await read($, pending)
  if (text === null) return 'copy-commands: nothing waiting to copy'

  const copied = await $.ui.copy({ text, surface })
  if (!copied.isCopied) return `copy-commands: not copied (${copied.reason})`

  await update($, pending, () => null)
  return `Copied ${commandLines(text)} command line(s) to the clipboard`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'copy-commands', description: 'Copy the commands Claude last printed for you to run' })
    return next(e)
  })

  on('command.run', { command: 'copy-commands' }, async $ => ({ text: await copyPending($) }))

  // Held until copied or replaced, so a session that finishes while you are elsewhere keeps them.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return result

    const blocks = shellBlocks(e.answer)
    if (blocks.length > 0) await update($, pending, () => blocks.join('\n'))

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const text = await read($, pending)
    if (text === null || e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text color="yellow">{commandLines(text)} command line(s) ready </Text>
        <Button key="copy" hotkey="c" plain onPress={async press => $.ui.toast(await copyPending($, press.surface))}>
          Copy
        </Button>
        <Text> </Text>
        <Button key="dismiss" hotkey="x" plain onPress={() => update($, pending, () => null)}>
          Dismiss
        </Button>
        <Text dimColor>  (ctrl+x tab, then c)</Text>
      </Box>
    )
  })
}
