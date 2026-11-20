// Sets "tui": "fullscreen" in a Claude Code settings.json, leaving every other key alone.
// The companion pane sits beside the chat only in the fullscreen view.
// Usage: node set-fullscreen.mjs <path to settings.json>
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('usage: node set-fullscreen.mjs <settings.json>')
  process.exit(2)
}

const settings = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
if (settings.tui !== undefined) {
  console.log(`already set ("tui": "${settings.tui}") - left as is`)
} else {
  settings.tui = 'fullscreen'
  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n')
  console.log('set "tui": "fullscreen"')
}
