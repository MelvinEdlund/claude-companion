---
name: pr-check
description: Pre-flight check before opening a pull request - fetch the target branch, detect merge conflicts and overlapping files, run the project's checks, and print the exact `gh pr create` command. Use when the user is about to open a PR or asks "is this ready?".
---

# Pull request pre-flight

Work through these in order and stop at the first real problem, explaining it plainly.

1. **Know the target.** The target is the branch the user names, else the repo's default branch (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, or `git symbolic-ref refs/remotes/origin/HEAD`).
2. **Fetch.** `git fetch origin <target>`.
3. **Conflicts.** Check whether the branch merges cleanly without touching the working tree: `git merge-tree --write-tree origin/<target> HEAD`. A non-zero exit or `CONFLICT` lines means conflicts: list the files and offer to rebase or merge.
4. **Overlap.** Files changed on both sides since the merge base (`git diff --name-only $(git merge-base origin/<target> HEAD) origin/<target>` intersected with the branch's own changes) are worth a look even without conflicts. List them.
5. **Checks.** Run what the project defines, in this order when present: typecheck, lint, tests (`package.json` scripts, `Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`). Report failures with their output. Do not "fix" a failing test by weakening its assertion.
6. **Changed tests are claims.** If the branch changes or deletes an existing assertion, snapshot or fixture, list each one: `file:line`, what it asserted before, and why the new expectation is right. That list belongs in the PR body.
7. **Uncommitted work.** If the tree is dirty, say so and offer `/commit` first.
8. **Print the command.** Give the exact command, ready to copy:
   `gh pr create --base <target> --title "<subject>" --body "<summary + test notes>"`
   Do not run it unless the user asks: opening a PR is outward-facing.
