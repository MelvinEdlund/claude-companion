# claude-code-kit installer for Windows (PowerShell 5.1+).
# Safe to run again: it updates what it installed and never overwrites your own files.
#
#   irm https://raw.githubusercontent.com/MelvinEdlund/claude-code-kit/main/install.ps1 | iex
#
# Options (environment variables):
#   $env:KIT_RULES = '0'   skip adding the coding rules to ~/.claude/CLAUDE.md
#   $env:KIT_STYLE = '0'   skip the optional Focus output style
$ErrorActionPreference = 'Stop'

$Repo = 'MelvinEdlund/claude-code-kit'
$ClaudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$KitDir = Join-Path $ClaudeDir 'claude-code-kit'
$ImportLine = '@' + ((Join-Path $KitDir 'config/CLAUDE.md') -replace '\\', '/')

function Write-Note($text) { Write-Host "  $text" }
function Write-Step($text) { Write-Host ''; Write-Host $text -ForegroundColor White }

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Host 'Claude Code is not installed. Get it first: https://docs.claude.com/claude-code'
  return
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host 'git is required.'
  return
}

New-Item -ItemType Directory -Force $ClaudeDir | Out-Null

Write-Step '1/5  Kit files'
if (Test-Path (Join-Path $KitDir '.git')) {
  git -C $KitDir pull --ff-only --quiet
  Write-Note "updated $KitDir"
} else {
  git clone --quiet --depth 1 "https://github.com/$Repo.git" $KitDir
  Write-Note "cloned to $KitDir"
}

Write-Step '2/5  Plugin (companion pane, games, skills)'
try { claude plugin marketplace add $Repo *> $null } catch {}
$installed = $false
try { claude plugin install 'companion-kit@companion-kit' *> $null; $installed = $LASTEXITCODE -eq 0 } catch {}
if (-not $installed) {
  try { claude plugin install companion-kit --marketplace $Repo *> $null; $installed = $LASTEXITCODE -eq 0 } catch {}
}
if ($installed) {
  Write-Note 'installed companion-kit'
} else {
  Write-Note 'could not install automatically - inside Claude Code run:'
  Write-Note "/plugin install companion-kit --marketplace $Repo"
}

Write-Step '3/5  Coding rules'
$UserRules = Join-Path $ClaudeDir 'CLAUDE.md'
if ($env:KIT_RULES -eq '0') {
  Write-Note 'skipped (KIT_RULES=0)'
} elseif ((Test-Path $UserRules) -and (Select-String -Path $UserRules -SimpleMatch $ImportLine -Quiet)) {
  Write-Note "already imported in $UserRules"
} else {
  Add-Content -Path $UserRules -Value "`n$ImportLine" -Encoding utf8
  Write-Note "imported into $UserRules (your own rules are untouched)"
}

Write-Step '4/5  Fullscreen view (the pane sits beside the chat there)'
if (Get-Command node -ErrorAction SilentlyContinue) {
  Write-Note (node (Join-Path $KitDir 'scripts/set-fullscreen.mjs') (Join-Path $ClaudeDir 'settings.json'))
} else {
  Write-Note "node not found - add `"tui`": `"fullscreen`" to $(Join-Path $ClaudeDir 'settings.json')"
}

Write-Step '5/5  Focus output style (optional)'
if ($env:KIT_STYLE -eq '0') {
  Write-Note 'skipped (KIT_STYLE=0)'
} else {
  $StyleDir = Join-Path $ClaudeDir 'output-styles'
  New-Item -ItemType Directory -Force $StyleDir | Out-Null
  $Style = Join-Path $StyleDir 'focus.md'
  if (Test-Path $Style) {
    Write-Note 'focus.md already exists - left as is'
  } else {
    Copy-Item (Join-Path $KitDir 'config/output-styles/focus.md') $Style
    Write-Note 'added - turn it on with /output-style focus'
  }
}

Write-Host ''
Write-Host 'Done. Start Claude Code in a wide terminal (110+ columns) and the companion pane opens on your first prompt.'
Write-Host 'Open it any time with /companion.'
