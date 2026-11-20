---
name: commit
description: Commit the current changes safely with a clear message, and push the branch. Never commits to main or master directly, never force-pushes, never skips hooks. Use when the user says "commit", "push", "save my work" or similar.
---

# Commit and push, safely

1. **Look before you stage.** Run `git status --short` and `git diff --stat`. If nothing changed, say so and stop.
2. **Never on the default branch.** If the current branch is `main`, `master` or the repo's default branch, create a short, descriptive branch first (`git switch -c <type>/<what>`, e.g. `fix/login-redirect`) and say you did.
3. **Leave secrets out.** Do not stage `.env*`, credential files, private keys or anything matching the repo's `.gitignore`. If one is modified, warn the user and leave it unstaged.
4. **Stage on purpose.** Stage the files that belong to this change. If the working tree mixes unrelated changes, ask which belong together, or make one commit per concern.
5. **Write the message.** Imperative subject under 72 characters that says what changes for the reader (`Fix redirect loop after sign-in`, not `updates`). Add a short body when the why is not obvious. Follow the repo's existing convention (Conventional Commits or not) by reading `git log --oneline -10`.
6. **Commit with hooks on.** If a pre-commit hook fails, fix the cause and commit again. Never pass `--no-verify`.
7. **Push.** `git push -u origin <branch>`. Never `--force`; if the push is rejected, fetch, rebase or merge, and try again.
8. **Report.** One line: the branch, the commit subject, and the next step (usually opening a PR, see `/pr-check`).
