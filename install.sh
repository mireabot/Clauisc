#!/bin/sh
# Loads Clauisc into every Claude Code session on this Mac by adding the
# plugin folder to CLAUDE_CODE_PLUGIN_DIRS in ~/.claude/settings.json.
# Usage: ./install.sh          (install)
#        ./install.sh --remove (uninstall)
set -eu

if [ "$(uname)" != "Darwin" ]; then
  echo "Clauisc reads Apple Music through osascript, so it needs macOS." >&2
  exit 1
fi

PLUGIN_DIR="$(cd "$(dirname "$0")/plugins/clauisc" && pwd)"
SETTINGS="$HOME/.claude/settings.json"
MODE="${1:-install}"

mkdir -p "$HOME/.claude"
[ -f "$SETTINGS" ] && cp "$SETTINGS" "$SETTINGS.bak"

# JSON edit with JavaScript for Automation: no jq or python needed.
osascript -l JavaScript - "$SETTINGS" "$PLUGIN_DIR" "$MODE" <<'JXA'
ObjC.import('Foundation');
function run(argv) {
  var path = argv[0], dir = argv[1], remove = argv[2] === '--remove';
  var fm = $.NSFileManager.defaultManager;
  var settings = {};
  if (fm.fileExistsAtPath(path)) {
    var text = ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null));
    if (text && text.trim()) settings = JSON.parse(text);
  }
  settings.env = settings.env || {};
  var dirs = (settings.env.CLAUDE_CODE_PLUGIN_DIRS || '').split(':').filter(function (d) { return d && d !== dir; });
  if (!remove) dirs.push(dir);
  if (dirs.length) settings.env.CLAUDE_CODE_PLUGIN_DIRS = dirs.join(':');
  else delete settings.env.CLAUDE_CODE_PLUGIN_DIRS;
  if (Object.keys(settings.env).length === 0) delete settings.env;
  $(JSON.stringify(settings, null, 2) + '\n').writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
  return '';
}
JXA

if [ "$MODE" = "--remove" ]; then
  echo "Removed Clauisc from $SETTINGS (backup: $SETTINGS.bak)."
  exit 0
fi

echo "Added $PLUGIN_DIR to CLAUDE_CODE_PLUGIN_DIRS in $SETTINGS (backup: $SETTINGS.bak)."
echo "Asking Music once so macOS shows its Automation prompt; click Allow."
osascript -e 'tell application "Music" to get player state' >/dev/null 2>&1 || true
echo "Done. Start a new Claude Code session; /clauisc toggles the band."
