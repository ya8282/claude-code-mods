# claude-code-mods

Small mods for [Claude Code](https://code.claude.com/docs).

## cache-timer

Claude Code caches your conversation prefix between requests. While the cache is warm, the next
request reads it cheaply; once it expires, the whole context is written again at the higher
cache-write rate. cache-timer shows how long you have left.

```
cache ███████░░░░░ 35m
```

The bar is green with half or more of the time left, yellow from 20%, red below that, and reads
`cold` once the cache has expired. Under two minutes the label counts seconds.

### Which TTL it counts down

Each API response reports how many tokens it wrote to the cache at each TTL
(`ephemeral_1h_input_tokens`, `ephemeral_5m_input_tokens`). cache-timer reads the newest
main-thread response that wrote to the cache and uses that TTL, so it follows what Claude Code
actually did: 1 hour on a subscription within its usage limits, 5 minutes on an API key, Bedrock,
Vertex or Foundry, after a `promptCacheTtl` setting, or once a subscription goes into overage.
Subagent requests keep their own cache and are ignored.

To force a TTL instead, set the plugin's `ttl` option to `5m` or `1h` (`/config`), and for the
status line script set `CACHE_TIMER_TTL=5m` or `1h`. Until a TTL is known it assumes
`CLAUDE_CODE_PROMPT_CACHE_TTL` if set, otherwise 1 hour.

### Status line

`plugins/cache-timer/statusline/cache-bar.sh` prints the bar for a Claude Code
[status line](https://code.claude.com/docs/en/statusline), in ANSI color. It needs
`jq` and runs on macOS and Linux.

Use it on its own in `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash /path/to/claude-code-mods/plugins/cache-timer/statusline/cache-bar.sh",
    "refreshInterval": 1
  }
}
```

Or add it to a status line script you already have, which reads the same JSON on stdin:

```bash
input=$(cat)
cache=$(printf '%s' "$input" | bash /path/to/cache-bar.sh)
```

`refreshInterval` makes the countdown move while you are idle; without it the status line only
redraws on activity.

### Bar above the prompt (plugin)

The plugin draws the same bar in the row above the prompt while Claude is idle. It uses Claude
Code's plugin hooks module API (`hooks/register.tsx`), so it needs a Claude Code version that has
it.

```bash
claude plugin marketplace add ya8282/claude-code-mods
claude plugin install cache-timer@claude-code-mods
```

Or load a local clone for one session with `claude --plugin-dir plugins/cache-timer`.

### Development

```bash
claude plugin validate plugins/cache-timer
claude plugin test plugins/cache-timer
```

## License

MIT
