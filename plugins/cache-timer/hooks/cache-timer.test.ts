import { test, expect, mock } from 'claude-code/testing'
import { format, gauge, tierFromTranscript } from './register'

test('formats the countdown', () => {
  expect(format(0)).toBe('cold')
  expect(format(59_000)).toBe('0:59')
  expect(format(119_000)).toBe('1:59')
  expect(format(120_000)).toBe('2m')
  expect(format(45 * 60_000)).toBe('45m')
})

test('gauge fills and colors by remaining fraction', () => {
  const h = 60 * 60_000
  expect(gauge(h, h)).toMatchObject({ filled: '█'.repeat(12), empty: '', color: 'green' })
  expect(gauge(h / 2, h).color).toBe('green')
  expect(gauge(h / 4, h)).toMatchObject({ filled: '███', color: 'yellow' })
  expect(gauge(h / 10, h).color).toBe('red')
  expect(gauge(1000, h).filled).toBe('█')
  expect(gauge(0, h)).toMatchObject({ filled: '', empty: '░'.repeat(12), label: 'cold' })
})

const usage = { model: 'm', input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const turn = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' as const }
const props = { hasSurvey: false, isWorking: false, maxRows: 10, columns: 80 } as never

for (const surface of ['terminal', 'desktop'] as const) {
  for (const [ttl, min] of [['5m', 5], ['1h', 60]] as const) {
    // Forced via the option; auto detection is covered below.
    test(`${surface}: bar counts down ${ttl} from the last main-thread response`, { options: { ttl } }, async ($, on) => {
      const clock = mock.clock(on)
      on('session.start', (_$, e) => ({ cwd: e.cwd }))
      on('turn.complete', () => ({ text: '' }))
      on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
      const label = async () => {
        const ui = await $.ui.mount({ plugin: 'cache-timer', surface, component: 'AbovePrompt', props })
        return (await ui.findAll({ type: 'Text' })).at(-1)
      }

      await $.session.start({ cwd: '/', surface, isInteractive: true })
      expect(await label()).toBeUndefined()

      await $.turn.complete({ ...turn, usage })
      await clock.advance(1000)
      expect(await label()).toMatchObject({ text: `${min}m`, props: { color: 'green' } })

      // A subagent's turn does not refresh the main cache.
      await clock.advance(min * 60_000 - 3000)
      await $.turn.complete({ ...turn, usage, agentId: 'sub' })
      await clock.advance(1000)
      expect(await label()).toMatchObject({ text: '0:01', props: { color: 'red' } })
      await clock.advance(1000)
      expect((await label())?.text).toBe('cold')
    })
  }
}

test('defaults to a 1h TTL and clears the old status entry', async ($, on) => {
  const clock = mock.clock(on)
  const shown: (string | undefined)[] = []
  on('ui.status', (_$, e) => { shown.push(e.text); return { value: undefined } as never })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(shown).toEqual([undefined])

  await $.turn.complete({ ...turn, usage })
  await clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', component: 'AbovePrompt', props })
  expect((await ui.findAll({ type: 'Text' })).at(-1)?.text).toBe('60m')
})

const line = (o: object) => JSON.stringify(o)
const reply = (w5: number, w1: number, isSidechain = false) =>
  line({ type: 'assistant', isSidechain, message: { usage: { cache_creation: { ephemeral_5m_input_tokens: w5, ephemeral_1h_input_tokens: w1 } } } })

test('reads the TTL the API applied from the newest main-thread cache write', () => {
  expect(tierFromTranscript([reply(0, 900), line({ type: 'user' })].join('\n'))).toBe('1h')
  expect(tierFromTranscript([reply(0, 900), reply(300, 0)].join('\n'))).toBe('5m')
  // A response served wholly from cache writes nothing: look further back.
  expect(tierFromTranscript([reply(300, 0), reply(0, 0)].join('\n'))).toBe('5m')
  // Subagents and junk lines do not count.
  expect(tierFromTranscript(['ut":1}}', reply(0, 900), reply(300, 0, true), 'not json', ''].join('\n'))).toBe('1h')
  // A mixed write lapses at the shorter TTL.
  expect(tierFromTranscript(reply(10, 900))).toBe('5m')
  expect(tierFromTranscript(line({ type: 'user' }))).toBeNull()
})

test('auto: follows the TTL in the transcript, 1h until one is known', async ($, on) => {
  const clock = mock.clock(on)
  let transcript = reply(0, 900)
  on('process.run', () => ({ value: { exitCode: 0, stdout: transcript, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}) as never)
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  const label = async () => {
    const ui = await $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', component: 'AbovePrompt', props })
    return (await ui.findAll({ type: 'Text' })).at(-1)?.text
  }
  const endTurn = async () => {
    await $.turn.complete({ ...turn, usage })
    await $.classic.Stop({ stop_hook_active: false } as never)
    await clock.advance(1000)
  }

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await endTurn()
  expect(await label()).toBe('60m')

  transcript = [reply(0, 900), reply(300, 0)].join('\n')
  await endTurn()
  expect(await label()).toBe('5m')
})
