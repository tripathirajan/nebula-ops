# AI contribution policy

This governs how AI coding agents (Claude Code or otherwise) are allowed to
contribute to `@nebula-ops/otel`. It exists because a meaningful fraction of this
repo's design and implementation work is expected to be AI-assisted, sometimes
autonomously (e.g. while the maintainer is unavailable) — this document is what keeps
that autonomy bounded and auditable rather than ad hoc.

## Scope

Applies to any AI agent making changes in this repository: writing code, editing
docs, running builds/tests, committing, or pushing. It does not apply to an AI merely
being consulted for advice with no repo write access.

## Hard boundaries (never, regardless of instruction)

- **Never commit or push directly to `main`.** Always work on a feature branch,
  named descriptively (`feat/...`, `docs/...`, `fix/...`), and push that branch.
  Merging to `main` is a human decision — via PR review, not an agent's own judgment
  — unless a human has explicitly said "merge this" in the current conversation.
- **Never merge, close, or approve a pull request** on the repo owner's behalf.
- **Never commit secrets, tokens, credentials, or anything resembling a real OTLP
  endpoint/auth header** — example config values in docs/code use obviously-fake
  placeholders (`https://otel-collector.internal:4318`, not a real vendor URL with
  a real-looking key).
- **Never silently change a frozen public API surface.** Every export/signature in
  `docs/package-specs/*.md` is a contract. If implementation reveals a genuine need
  to deviate, the deviation must be stated explicitly (in the commit message or PR
  description, and ideally to the user directly) with reasoning — never a quiet
  diff between what the spec says and what the code does.
- **Never add a new runtime dependency without recording its exact version and why**
  in the relevant package spec's "External dependencies" table, in the same change
  that adds it.
- **Never lower a test-coverage threshold to make a build pass.** If code can't
  reasonably reach the coverage bar, that's a signal the code needs restructuring
  (or the untestable branch needs an explicit, justified exclusion comment) — not
  that the threshold is wrong.

## Every AI-authored commit

- Carries a `Co-Authored-By:` trailer identifying the model, per the harness
  convention already in use in this repo's commit history.
- Is scoped to one coherent change — not a giant "implement everything" commit that
  makes review or `git bisect` useless.
- Passes `build`, `lint`, `typecheck`, and `test` (with coverage) for every package
  it touches, verified by actually running those commands, before being described as
  "done."

## Decisions made without the maintainer present

Sometimes an agent has to make a design call while the maintainer is unavailable
(see [ADR 0002](../adr/0002-open-questions-resolutions.md) for a worked example —
9 open questions resolved this way during an implementation session). When this
happens:

1. **Prefer the reversible option.** A config-default choice beats a shape-of-the-API
   choice when both are defensible — defaults are cheap to flip later, exported
   signatures are not (per the frozen-API-surface rule above).
2. **Write the decision down, with reasoning, in a place a human will actually see
   it** — an ADR entry, a package-spec non-goals line, or (at minimum) a clearly
   flagged note in the PR description. A decision that only exists in the agent's
   own reasoning trace is not a recorded decision.
3. **Mark it explicitly as provisional** — "decided autonomously, revisit at next
   check-in," not phrased as if it had been reviewed and approved. Don't let a
   confident writing style imply a confidence level that isn't warranted.
4. **Don't let an unresolved question block forward progress indefinitely.** Pick the
   most defensible option, document it, move on — re-litigating the same open
   question repeatedly across a session wastes the time this autonomy was meant to
   save.

## Quality bar (see also `CLAUDE.md`)

- TypeScript strict mode, no unexplained `any`.
- 100% coverage target per package, enforced in CI.
- ESLint + Prettier clean.
- Design patterns match what's already established in the codebase (see
  `CLAUDE.md`'s "Code quality bar" section) rather than each package inventing its
  own conventions.
- Every package-facing change that affects published behavior ships its own
  changeset in the same PR.

## What "done" means for a milestone

Per [`docs/implementation-plan.md`](../implementation-plan.md), a milestone is not
done until: the acceptance criteria listed for it are met, `build`/`lint`/`typecheck`/
`test` all pass for every package touched (verified by running them, not assumed),
and a changeset exists for any package whose published surface changed. An agent
working autonomously (maintainer away) should still produce a milestone-by-milestone
status report — even without a live human to "check in" with synchronously — so the
maintainer can review what happened, in order, when they return, rather than facing
one large undifferentiated diff.

## Review cadence

Every decision recorded under "Decisions made without the maintainer present" above
gets explicitly re-surfaced (not just left in a file waiting to be stumbled on) the
next time the maintainer is present and reviewing this repo's state — this policy
exists to make autonomous progress possible, not to make it permanent without review.
