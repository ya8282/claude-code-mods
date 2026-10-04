import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { CacheTtl } from '../types'

const TTL_MS: Record<CacheTtl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }
const WIDTH = 12
// Enough for many responses, and under the 4 MiB a host process may hand back.
const TAIL_BYTES = 2_000_000

// Kept in $.state so a hot reload does not forget the last response.
const lastAt = atom({ plugin: 'cache-timer', key: 'lastAt' } as const, null as number | null)
const now = atom({ plugin: 'cache-timer', key: 'now' } as const, 0)
const tier = atom({ plugin: 'cache-timer', key: 'tier' } as const, null as CacheTtl | null)

/**
 * The TTL the API applied, from the newest main-thread response in a transcript (JSONL) that
 * wrote to the cache. A response served wholly from cache writes nothing, so look further back.
 * Takes the transcript's tail, so a cut-off first line is expected and skipped.
 */
export const tierFromTranscript = (jsonl: string): CacheTtl | null => {
  for (const line of jsonl.split('\n').reverse()) {
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry?.type !== 'assistant' || entry.isSidechain) continue
    const written = entry.message?.usage?.cache_creation
    // The 5m part of a mixed write lapses first, so it decides.
    if (written?.ephemeral_5m_input_tokens > 0) return '5m'
    if (written?.ephemeral_1h_input_tokens > 0) return '1h'
  }
  return null
}

export const format = (leftMs: number) => {
  if (leftMs <= 0) return 'cold'
  const s = Math.ceil(leftMs / 1000)
  return s >= 120 ? `${Math.ceil(s / 60)}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const gauge = (leftMs: number, ttlMs: number) => {
  const frac = Math.max(0, Math.min(1, leftMs / ttlMs))
  const filled = leftMs > 0 ? Math.max(1, Math.round(frac * WIDTH)) : 0
  const color = frac >= 0.5 ? 'green' : frac >= 0.2 ? 'yellow' : 'red'
  return { filled: '█'.repeat(filled), empty: '░'.repeat(WIDTH - filled), color, label: format(leftMs) }
}

export const register: Register = (on, options) => {
  const forced = TTL_MS[options.ttl as CacheTtl] ? (options.ttl as CacheTtl) : null

  on('session.start', async ($, e, next) => {
    // Earlier versions pinned a status line entry; it stays until cleared.
    $.ui.status(undefined)
    $.clock.every(1000, async () => {
      if ((await read($, lastAt)) === null) return
      const t = await $.clock.now()
      await update($, now, () => t)
    })
    return next(e)
  })

  // The cache is refreshed by each request, so the turn's end is the last write. Subagents keep
  // their own prefix; no usage means no request reached the API (interrupt, error).
  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && e.usage) {
      const t = await $.clock.now()
      await update($, lastAt, () => t)
      await update($, now, () => t)
    }
    return next(e)
  })

  // The turn's usage omits the per-TTL split, so read it from the transcript once per turn.
  // Only its tail: $.fs.read refuses files over 4 MiB, which long sessions pass.
  on('classic.Stop', async ($, e, next) => {
    if (!forced) {
      try {
        const { stdout } = await $.process.run(['tail', '-c', String(TAIL_BYTES), e.transcript_path])
        const found = tierFromTranscript(stdout)
        if (found) await update($, tier, () => found)
      } catch {
        // ponytail: no tail (Windows) or no transcript keeps the last known tier
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const at = await read($, lastAt)
    // Mid-turn the cache is being refreshed, so the bar only matters while idle.
    if (at === null || e.props.isWorking || e.props.hasSurvey) return next(e)

    const ttl = TTL_MS[forced ?? (await read($, tier)) ?? '1h']
    const g = gauge(at + ttl - (await read($, now)), ttl)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>cache </Text>
        <Text color={g.color}>{g.filled}</Text>
        <Text dimColor>{g.empty} </Text>
        <Text color={g.filled ? g.color : 'red'} bold>{g.label}</Text>
      </Box>
    )
  })
}
