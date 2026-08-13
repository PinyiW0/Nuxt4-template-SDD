# Execution Advice (Codex mapping)

Codex has no subagent / Agent tool. The criteria below keep the same dispatch logic as the Claude version (`dispatch-fallback.md`) but map conclusions to Codex-native execution modes. Never reference `.claude/ops/` — its tables assume Claude Code's Agent tool semantics.

## Criteria → advice (first hit wins, top to bottom)

| Task shape | Criterion | Advice |
|------------|-----------|--------|
| Review / second opinion | always (never self-review) | Review in a **fresh session**, given only the diff and the acceptance criteria |
| Exploration / search | expect to open >3 files, or target location unknown | Run a scoped read-only exploration pass first, then implement |
| Batch edits | same pattern across ≥3 files | Split into sequential sub-tasks, or scoped `codex exec` one-shots per sub-task |
| Web research | need >2 pages | Separate research pass before implementation |
| Everything else | none of the above | Run directly in this session |

- Multi-stage tasks may combine advice: e.g. "explore first, then implement here".
- Exception: single-point confirmation with a known file and known location — just do it directly.

## Complexity note (instead of model names)

Do not prescribe model names. Append one word so the user can pick a model (`codex -m …`) or reasoning effort themselves:

- `mechanical` — existence checks, list-making, verbatim comparison
- `exploratory` — search, inventory, summarization; implementation with clear acceptance criteria
- `judgment-heavy` — adversarial review, architecture decisions, tricky debugging

## Output format (one fixed line)

```
Advice: {run directly | split into sequential tasks | scoped codex exec one-shots | fresh-session review} ({mechanical|exploratory|judgment-heavy}) — reason: {matched criterion}
```
