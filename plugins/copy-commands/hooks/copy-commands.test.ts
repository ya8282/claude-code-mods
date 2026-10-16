import { test, expect } from 'claude-code/testing'
import { commandLines, shellBlocks } from './register'

const answer = [
  'Run these:',
  '```',
  '# Should print one line.',
  'bd close abc-1.2',
  '```',
  'and',
  '```bash',
  "git commit -F - <<'MSG'",
  'subject',
  'MSG',
  '',
  '```',
  '```ts',
  'const x = 1',
  '```',
].join('\n')

test('keeps shell and untagged blocks verbatim, drops other languages', () => {
  expect(shellBlocks(answer)).toEqual([
    '# Should print one line.\nbd close abc-1.2\n',
    "git commit -F - <<'MSG'\nsubject\nMSG\n\n",
  ])
})

test('no blocks, nothing to copy', () => {
  expect(shellBlocks('All done, nothing for you to run.')).toEqual([])
})

test('counts command lines, not comments or blanks', () => {
  expect(commandLines('# c\nbd close x\n\ngit push\n')).toBe(2)
})

const turn = { durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' as const }
const props = { hasSurvey: false, isWorking: false, maxRows: 10, columns: 80 } as never

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: holds commands across turns until c copies them`, async ($, on) => {
    const copies: string[] = []
    on('ui.copy', (_$, e) => { copies.push(e.text); return { value: { isCopied: true } } })
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('turn.complete', () => ({ text: '' }))
    on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
    const mount = () => $.ui.mount({ plugin: 'copy-commands', surface, component: 'AbovePrompt', props })

    await $.session.start({ cwd: '/', surface, isInteractive: true })
    expect(await (await mount()).find({ type: 'Button', key: 'copy' })).toBeUndefined()

    await $.turn.complete({ ...turn, answer })
    await $.turn.complete({ ...turn, answer: 'A later answer with nothing to run.' })
    await $.turn.complete({ ...turn, answer: 'Subagent block\n```\nrm x\n```', agentId: 'sub' })

    const ui = await mount()
    await ui.press({ key: 'copy' })
    expect(copies).toEqual([shellBlocks(answer).join('\n')])
    expect(await (await mount()).find({ type: 'Button', key: 'copy' })).toBeUndefined()
  })
}
