---
name: sharpen
description: Sharpen a rough idea into a precise, executable instruction via blindspot diagnosis, merged clarification questions, conditional knowledge boosts, and a structured prompt plus execution advice. Use when an idea is still vague, an instruction lacks acceptance criteria or boundaries, or the user says "sharpen this", "幫我把這個想清楚", or "磨一下這個需求".
---

# Sharpen

Turn a rough concept into a precise, executable instruction plus execution advice.
Positioning: automatically apply "high-quality handoff prompt" standards to short hand-typed prompts.

## Interaction protocol (CRITICAL)

Codex has no structured question tool. Whenever this skill says "ask the user":

1. Present at most 3 questions per round as a numbered list; each question offers lettered options (a/b/c, ≤4) — concrete guesses, not abstract categories. Free-form answers are always welcome.
2. STOP and wait for the user's reply. Never answer the questions yourself or proceed on guesses.
3. After the reply, run the "After answering" logic of that step.

At most 2 question rounds total; anything still unclear becomes a labeled assumption.

## Workflow

Phase 1 (diagnose & clarify) → summary approval → Phase 2 (compose) → draft approval → delivery.

### Phase 1: Diagnose & clarify

1. **Get the concept.** Use the argument text; if it is a file path, read that file; if empty, ask "What do you want to do? One sentence is enough."
2. **Blindspot scan.** Load `references/blindspot-checklist.md` and compare the input against B1–B8. Record each as strong hit (must ask), weak hit (don't ask — record as assumption), or miss.
   - Fast track: input already contains goal + acceptance criteria + authorization boundary → skip all questions, one-line summary, go straight to Phase 2.
   - Zero strong hits → skip to step 4.
3. **Merged clarification questions.** Merge strong hits into ≤3 questions per the checklist merge rules and ask them in one round. After answering: record answers; if they reveal new strong hits, at most one more round (2 total); remaining ambiguity becomes assumptions.
4. **Understanding summary (approval gate).** Show a four-field summary — Goal / Scope / Locked decisions / Remaining assumptions — then STOP and wait for explicit approval before Phase 2. If the user corrects it, revise and show again.

### Phase 2: Compose

1. **Conditional knowledge boost.** Three triggers; if none hit, skip entirely with zero output. Hard cap 10 lines — beyond that, turn it into "research first" execution advice instead of lecturing:
   - Domain-specific task AND the repo has a matching skill or rules file → don't expand the content, just list that file path in the prompt's References section.
   - Architectural decision (new directory, new dependency, cross-layer change, public interface) → 2–3 lines of trade-offs; add the decision points to the prompt.
   - Possible conflict with repo reality (target may not exist / something similar already exists) → verify with a quick read of the repo, or record as an assumption.
2. **Assemble the six-section prompt.** Per `references/prompt-template.md`: Goal & motivation / Scope & current state / Authorization boundary / Acceptance criteria / Reporting format / References. Write unresolved items as "(assumption) …". Use the checklist's conservative defaults for unconfirmed authorization fields.
3. **Execution advice.** Per `references/execution-advice.md`, output one fixed advice line (run directly / split into sequential tasks / scoped `codex exec` one-shots / fresh-session review, plus a complexity note).
4. **Draft approval (gate).** Show the full prompt in a code block plus the advice line, then STOP and wait for approval. If the user asks for changes, go back to step 2.

### Delivery

Ask one question: (a) run it now in this session per the advice, (b) output the prompt only as a copy-paste block (with the advice line appended), or (c) adjust the draft. Then do exactly that.

## Iron rules

- Don't pester: zero strong hits → zero questions; ≤3 questions per round, ≤4 options each; at most 2 rounds.
- Don't lecture: knowledge boost only when triggered, ≤10 lines; deeper research becomes "research first" advice, not an essay.
- Don't act unapproved: never execute the task or modify any file before the draft is approved.
- Not project-bound: works in any repo. Do not reference `.claude/ops/` — its dispatch tables assume Claude Code's Agent tool (see `references/execution-advice.md`).
- Output language follows the user's input language.

## References

- `references/blindspot-checklist.md`: eight blindspots with detection cues, question phrasing, merge rules, fast track, authorization defaults. (Copied from the Claude version; "AskUserQuestion" there means one question round here.)
- `references/prompt-template.md`: six-section prompt template, writing guidance, before/after example.
- `references/execution-advice.md`: execution mode criteria mapped to Codex-native modes.
