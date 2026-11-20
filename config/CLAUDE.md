# Coding rules (claude-code-kit)

General rules for every project. A project's own `CLAUDE.md` adds to these and wins where they disagree.

## Before writing code

- **Read before you edit.** Open the code a change touches, and the code that calls it, before changing it. Never describe or change code you have not read.
- **Spec before anything non-trivial.** For a feature or a larger fix, write the goal, testable acceptance criteria and the exact changes first (`/spec`), and ask where something is ambiguous instead of guessing.
- **Stay in scope.** Do what was asked. Something else worth fixing is mentioned once, at the end, as a separate offer, not folded into the change.

## Writing code

- **Clean code.** Clarity over cleverness: a reader should understand the intent from the code itself. Names say what a thing is, not how it is built.
- **No duplication.** If the same expression or block appears twice, restructure so it lives once.
- **Small, reviewable changes.** One concern per change. Do not reformat or rename code the change does not need.
- **Comments say why, not what.** Delete comments that restate the code.
- **No dead scaffolding.** Do not add options, layers or hooks for a future nobody asked for.
- **Handle the unhappy path.** Errors are named, shown and logged where the caller can act on them, never swallowed. An empty list and a failed request are different states.
- **No secrets in code.** Keys and tokens come from the environment, never from a literal or a committed file.

## Tests

- **A changed test is a claim, not a formality.** When you change or delete an existing assertion, snapshot or fixture, say which one (`file:line`), what it asserted before, and why the new expectation is right. "Changed so it passes" and "the old expectation was wrong" look the same in a diff.
- **Never weaken a test to make it pass.** A failing test is information: find out what it is telling you.
- **Test behaviour, not implementation.** A test should survive a refactor that keeps behaviour.

## Reporting

- **Report faithfully.** If tests fail, say so with the output. If a step was skipped, say that. When something is done and verified, say it plainly.
- **Verify before claiming.** "Works" means you ran it: name the command or the check.
- **Errors matter-of-fact.** Location, cause, fix.

## Safety

- **Confirm before anything destructive or outward-facing**: deleting, overwriting, force-pushing, migrating a shared database, sending a message, opening a PR, publishing. Approval for one action does not carry over to the next.
- **Look before you overwrite.** Read a file or a target before replacing it.
- **Git:** never commit straight to `main`/`master`, never `--force`, never `--no-verify`. Fix the hook's complaint instead.

## Interfaces (optional, for UI work)

- **Calm and low-motion.** Ambient UI that someone watches while working stays nearly still. Animation is slow, small and purposeful; nothing blinks, bounces or loops for attention. Respect `prefers-reduced-motion`.
- **Every state designed.** Loading, empty, error and success each have a deliberate look; none is inferred from another.
- **Design tokens, not literals.** Colours, spacing and radii come from the design system, never a hard-coded hex or pixel value in a component.
- **Both themes.** Nothing ships checked in light or dark only.
