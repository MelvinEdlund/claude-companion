# Contributing

Thanks for wanting to make the kit better. New games, helpers, skills and fixes are all welcome.

## The one rule: keep it calm

The pane sits beside someone's work for hours. Anything added to it should:

- **move slowly and rarely.** Nothing blinks, flashes or loops for attention.
- **ask for nothing.** No notifications, streaks, daily goals or anything you lose by stepping away.
- **fit in 32 columns.** The pane is narrow on purpose. The playground is 8 rows tall.
- **put information before play.** The game goes below what Claude is doing, never on top of it.

## Layout

```
.claude-plugin/     plugin.json, marketplace.json, icon
hooks/register.tsx  the pane: files, helpers, status, commands
hooks/golf.tsx      golf (a Client surface module)
hooks/dart.tsx      darts (a Client surface module)
hooks/*.test.tsx    tests, run by `claude plugin test`
types/index.d.ts    the plugin's state contract
skills/             /commit, /pr-check, /spec
config/             coding rules and the Focus output style
install.sh/.ps1     installers
```

## Develop

1. Fork and clone the repository.
2. Load your copy in a session:

   ```sh
   claude --plugin-dir .
   ```

   Edits to `hooks/` reload when the turn ends.
3. Check your change before opening a PR:

   ```sh
   claude plugin validate .
   claude plugin test .
   ```

## Pull requests

- Keep each PR to one change, and say what it does for the person using the pane.
- Add a test for new behaviour. If you change or remove an existing assertion, name it in the PR (`file:line`) and explain why the new expectation is right.
- If your change affects what the pane looks like, add a screenshot.
- Write everything in English.

## Ideas that fit

- A new small game, skill-based and calm, in 32×8 cells.
- A helper for an agent type the kit does not know yet.
- A skill that helps in any project.
