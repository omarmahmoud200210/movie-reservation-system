# Working with this repo

## Delegation to OpenCode

Implementation work planned by Claude is delegated to the `opencode` CLI (via the `opencode-delegate`
skill). **Only use free models** — the user has no paid subscription on any OpenCode-accessible
provider (Google, OpenRouter, OpenAI credentials are configured, but billing must stay at $0).

Confirmed free model IDs (check `opencode models | grep -i free` for the current list, this drifts):
- `opencode/deepseek-v4-flash-free`
- `opencode/north-mini-code-free`
- `opencode/mimo-v2.5-free`
- `opencode/nemotron-3-ultra-free`
- Any `openrouter/...:free` suffixed model (e.g. `openrouter/qwen/qwen3-coder:free`)

Never pass a metered/pay-per-token model without explicit user confirmation.

## Division of labor

1. Claude plans (brainstorming/writing-plans skills as needed).
2. OpenCode implements, one task per dispatch, free model only.
3. Claude reviews the diff and re-runs the real gates itself — never trusts OpenCode's self-report.
4. Claude commits only after review; the user gives the final go-ahead before the overall work is
   considered done.
