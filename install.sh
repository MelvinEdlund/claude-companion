#!/usr/bin/env sh
# claude-code-kit installer for macOS and Linux.
# Safe to run again: it updates what it installed and never overwrites your own files.
#
#   curl -fsSL https://raw.githubusercontent.com/MelvinEdlund/claude-code-kit/main/install.sh | sh
#
# Options (environment variables):
#   KIT_RULES=0   skip adding the coding rules to ~/.claude/CLAUDE.md
#   KIT_STYLE=0   skip the optional Focus output style
set -eu

REPO="MelvinEdlund/claude-code-kit"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
KIT_DIR="$CLAUDE_DIR/claude-code-kit"
IMPORT_LINE="@$KIT_DIR/config/CLAUDE.md"

say() { printf '  %s\n' "$1"; }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

command -v claude >/dev/null 2>&1 || {
  echo "Claude Code is not installed. Get it first: https://docs.claude.com/claude-code"
  exit 1
}
command -v git >/dev/null 2>&1 || { echo "git is required."; exit 1; }

mkdir -p "$CLAUDE_DIR"

step "1/5  Kit files"
if [ -d "$KIT_DIR/.git" ]; then
  git -C "$KIT_DIR" pull --ff-only --quiet && say "updated $KIT_DIR"
else
  git clone --quiet --depth 1 "https://github.com/$REPO.git" "$KIT_DIR" && say "cloned to $KIT_DIR"
fi

step "2/5  Plugin (companion pane, games, skills)"
claude plugin marketplace add "$REPO" >/dev/null 2>&1 || true
if claude plugin install companion-kit@companion-kit >/dev/null 2>&1 \
  || claude plugin install companion-kit --marketplace "$REPO" >/dev/null 2>&1; then
  say "installed companion-kit"
else
  say "could not install automatically - inside Claude Code run:"
  say "/plugin install companion-kit --marketplace $REPO"
fi

step "3/5  Coding rules"
if [ "${KIT_RULES:-1}" = "0" ]; then
  say "skipped (KIT_RULES=0)"
elif [ -f "$CLAUDE_DIR/CLAUDE.md" ] && grep -qF "$IMPORT_LINE" "$CLAUDE_DIR/CLAUDE.md"; then
  say "already imported in $CLAUDE_DIR/CLAUDE.md"
else
  printf '\n%s\n' "$IMPORT_LINE" >> "$CLAUDE_DIR/CLAUDE.md"
  say "imported into $CLAUDE_DIR/CLAUDE.md (your own rules are untouched)"
fi

step "4/5  Fullscreen view (the pane sits beside the chat there)"
if command -v node >/dev/null 2>&1; then
  say "$(node "$KIT_DIR/scripts/set-fullscreen.mjs" "$CLAUDE_DIR/settings.json")"
else
  say "node not found - add \"tui\": \"fullscreen\" to $CLAUDE_DIR/settings.json"
fi

step "5/5  Focus output style (optional)"
if [ "${KIT_STYLE:-1}" = "0" ]; then
  say "skipped (KIT_STYLE=0)"
else
  mkdir -p "$CLAUDE_DIR/output-styles"
  if [ -e "$CLAUDE_DIR/output-styles/focus.md" ]; then
    say "focus.md already exists - left as is"
  else
    cp "$KIT_DIR/config/output-styles/focus.md" "$CLAUDE_DIR/output-styles/focus.md"
    say "added - turn it on with /output-style focus"
  fi
fi

printf '\n\033[1mDone.\033[0m Start Claude Code in a wide terminal (110+ columns) and the companion pane opens on your first prompt.\n'
printf 'Open it any time with /companion.\n'
