---
name: spec
description: Write a short, testable spec before building something non-trivial - the goal, acceptance criteria, the exact changes planned, and open questions - grounded in the actual code. Use when the user describes a feature or a larger fix and before writing code for it.
---

# Spec first, then code

A spec is a page the user can read in two minutes and say yes to. It saves the
expensive mistake: building the wrong thing well.

1. **Ground it.** Read the code the change touches before writing a word. Name files and functions as `path:line`. Never describe code you have not opened.
2. **Write the spec** in `specs/<short-name>.md` (or the folder the repo already uses), with exactly these sections:
   - **Goal** - one or two sentences: what changes for the user, and why.
   - **Acceptance criteria** - a checklist of observable outcomes, each one testable (`- [ ] Signing in with an expired link shows "Link expired" and a resend button`).
   - **Exact changes** - per file: what is added, changed or removed. Small enough to review.
   - **Out of scope** - what this deliberately does not do.
   - **Open questions** - anything ambiguous, marked `[NEEDS CLARIFICATION]`. Ask them before coding; do not guess.
3. **Stop and ask.** Show the spec and wait for a yes or answers to the open questions.
4. **Build to the spec.** Tests first from the acceptance criteria where the project has tests, then the code.
5. **Close it out.** Tick each criterion that now holds, note any deviation and why, and say what was verified and how.
