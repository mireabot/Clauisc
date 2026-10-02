# Clauisc

A Claude Code mod that shows what Apple Music is playing, on the right side
of the band above your prompt:

```
 ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀  Pink + White           ▄▄▄▄
 ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀  Frank Ocean          ▄▀▀    ▀▀▄
 ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀  Blonde               ▀▀ ▀▀▀▀▀▀ ▀▀
 ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀  ▶ 1:01 / 3:04        ▀▀▄▀▀▀▀▀▀▄▀▀
 ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀  ━━━━━━━━──────────      ▀▀▀▀▀▀ ▄
```

- **Cover**: the track's artwork scaled to 16×16 and drawn in true color, two
  pixels per cell. `/nowplaying ascii` draws it as a colored ASCII ramp instead.
- **Track**: title, artist, album, play state, time and a progress bar,
  refreshed every 2 seconds.
- **Plush**: Claude in headphones, bopping on the track's BPM when Apple Music
  has one, on a loose random groove otherwise, and resting while paused.
- Narrow or short terminals get an 8×4 cover, then a single line.

## Requirements

- macOS with the Music app. Everything runs through the built-in `osascript`
  (AppleScript for the player, JavaScript for Automation to scale the artwork):
  no Homebrew, Node or Python packages.
- A Claude Code build with function-hook plugins (`hooks/hooks.json` with
  `modules`), the terminal UI.
- The first run asks whether your terminal may control **Music**: allow it
  (System Settings → Privacy & Security → Automation).

## Local setup

```sh
git clone https://github.com/mireabot/Clauisc.git ~/Clauisc
```

Then either:

**One session**

```sh
claude --plugin-dir ~/Clauisc/plugins/clauisc
```

**Every session**

```sh
~/Clauisc/install.sh            # adds it to CLAUDE_CODE_PLUGIN_DIRS in ~/.claude/settings.json
~/Clauisc/install.sh --remove   # takes it out again
```

The script backs up `~/.claude/settings.json` to `settings.json.bak` first.
`git pull` updates the mod in place; a running session reloads it when the
files change.

## Usage

| Command | Effect |
| --- | --- |
| `/nowplaying` | Hide or show the band |
| `/nowplaying ascii` | Draw the cover as colored ASCII |
| `/nowplaying blocks` | Draw the cover as half-block pixels (default) |

## Customizing

All drawing lives in [`plugins/clauisc/hooks/lib.ts`](plugins/clauisc/hooks/lib.ts):

- `HEAD`, `BODY`, `LEGS`: the plush sprite, one character per pixel
  (`.` transparent, keys of `PALETTE` for colors).
- `PALETTE`: the plush colors.
- `ASCII_RAMP`: characters for the ASCII cover, dark to bright.
- `beatMs`: how BPM maps to bop speed.

## Development

```sh
cd plugins/clauisc
claude plugin validate .
claude plugin test .
```

The tests mock `osascript`, so they run anywhere. Run with `claude --debug`
to see why a hook was skipped.

## Known limits

- Artwork for some Apple Music streaming and radio tracks is not exposed to
  AppleScript; those show a placeholder cover.
- Most tracks have no BPM tag, so the plush usually bops at random.
- Artwork is written to `/tmp/clauisc-art` while it is sampled.

## License

MIT
