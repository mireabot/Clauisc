# Clauisc

**Apple Music, live in your Claude Code prompt.** Clauisc is a Claude Code
plugin that shows what's playing on the right side of the band above your
input line: a pixel-art album cover, the track, a boombox whose notes flash
to the beat, and a little Claude plush in headphones bopping along.

```
 ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀  Pink + White          ♪ ▄▄▄▄
 ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀  Frank Ocean          ▄▀▀    ▀▀▄
 ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀  Blonde               ▀▀ ▀▀▀▀▀▀ ▀▀
 ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀  ▶ 1:01 / 3:04        ▀▀▄▀▀▀▀▀▀▄▀▀
 ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀  ━━━━━━━━──────────      ▀▀▀▀▀▀ ▄
```

> **Status: early.** Built and tested against a mocked Music app; first runs
> on real Macs are happening now. Reports and screenshots are welcome in
> [Issues](https://github.com/mireabot/Clauisc/issues).

## Features

- **Pixel cover**: the current track's artwork in true color, 16×16 pixels
  in 16×8 terminal cells. `/nowplaying ascii` switches to colored ASCII art.
- **Track info**: title, artist, album, play/pause, time and a progress bar,
  refreshed every 2 seconds.
- **Bopping plush**: Claude in headphones bobs and tilts on every beat, using
  the track's BPM when Apple Music has one and a loose random groove
  otherwise. Each beat floats a ♪ in a fresh random color. Paused, it rests.
- **Boombox**: VK's ASCII boombox (see [Credits](#credits)) plays along; its
  three notes each take a random color on every beat and rest in gray while
  paused. It shows when the terminal has room, at least about 85 columns and
  9 rows for the band.
- **Fits the terminal**: the boombox steps aside first, then the cover
  shrinks to 8×4, then the band becomes a single line.
- **No dependencies**: only macOS's built-in `osascript`.

## Requirements

- macOS with the Music app.
- Claude Code in the terminal, on a build that supports function-hook
  plugins.
- A true-color terminal (Terminal, iTerm2, Ghostty, kitty, WezTerm) for the
  best cover.
- On first run macOS asks whether your terminal may control **Music**; allow
  it. You can change this later in System Settings → Privacy & Security →
  Automation.

## Setup

```sh
git clone https://github.com/mireabot/Clauisc.git ~/Clauisc
```

**Try it in one session**

```sh
claude --plugin-dir ~/Clauisc/plugins/clauisc
```

**Load it in every session**

```sh
~/Clauisc/install.sh            # adds the plugin to CLAUDE_CODE_PLUGIN_DIRS in ~/.claude/settings.json
~/Clauisc/install.sh --remove   # removes it again
```

`install.sh` backs up `~/.claude/settings.json` to `settings.json.bak` before
changing it.

**Update**: `git pull`. A running session reloads the plugin when its files
change. If you installed before the plugin folder was renamed to
`plugins/clauisc`, run `install.sh` again.

## Usage

Play something in Music and the band appears above your prompt.

| Command | Effect |
| --- | --- |
| `/nowplaying` | Hide or show the band |
| `/nowplaying ascii` | Draw the cover as colored ASCII |
| `/nowplaying blocks` | Draw the cover as half-block pixels (default) |

## How it works

1. **Track**: every 2 seconds an AppleScript asks Music for the player state,
   title, artist, album, BPM, position and duration.
2. **Artwork**: when the track changes, AppleScript writes the artwork's raw
   bytes to `/tmp/clauisc-art`. A JavaScript for Automation script loads the
   file with AppKit, scales it to 16×16 with high-quality interpolation, and
   prints each pixel's RGB.
3. **Cover**: each terminal cell holds two pixels: an upper half block `▀`
   whose foreground is the top pixel and background the bottom one. Terminal
   cells are about twice as tall as wide, so 16×8 cells look square. ASCII
   mode averages the two pixels and picks a character from `.:-=+*#%@` by
   brightness, drawn in that color.
4. **Drawing**: the cover, the boombox and the plush are Claude Code
   `Raster` elements. On each beat the plush and the boombox's notes are
   repainted in place, without redrawing the band.

## Customizing

Everything visual lives in
[`plugins/clauisc/hooks/lib.ts`](plugins/clauisc/hooks/lib.ts):

| Name | What it controls |
| --- | --- |
| `HEAD`, `BODY`, `LEGS` | The plush sprite, one character per pixel (`.` is transparent; other letters are `PALETTE` keys) |
| `PALETTE` | Plush colors |
| `noteColor` | How each beat's note colors are picked |
| `BOOMBOX_NOTES` | Which cells of the boombox are notes |
| `ASCII_RAMP` | ASCII cover characters, dark to bright |
| `beatMs` | How BPM maps to bop speed |

## Development

```sh
cd plugins/clauisc
claude plugin validate .
claude plugin test .
```

The tests mock `osascript`, so they run on any OS. Start Claude Code with
`--debug` to see why a hook was skipped or a drawing refused.

```
.claude-plugin/marketplace.json   marketplace manifest
plugins/clauisc/
  .claude-plugin/plugin.json      plugin manifest
  hooks/register.tsx              hooks: polling, band drawing, /nowplaying
  hooks/lib.ts                    AppleScript/JXA, parsing, cover and plush cells
  types/index.d.ts                state contract
  tests/band.test.tsx             tests
install.sh                        local install for every session
```

## Known limits

- Some Apple Music streaming and radio tracks don't expose artwork to
  AppleScript; those get a placeholder cover.
- Most tracks have no BPM tag, so the plush usually bops at random.
- Terminal only: other Claude Code surfaces show their usual band.

## Credits

- **Boombox** ASCII art by **VK**, from
  [asciiart.website/art/2612](https://asciiart.website/art/2612)
  (Christopher Johnson's ASCII Art Collection). It is drawn unchanged, with
  the artist's signature; Clauisc only colors its notes. The art belongs to
  its artist and is not covered by this repository's MIT license.
- The Claude plush is original fan art inspired by Claude Code's mascot.
  Clauisc is a fan project, not affiliated with or endorsed by Anthropic.
  Claude is a trademark of Anthropic.

## License

Code: [MIT](LICENSE). Third-party art keeps its own terms; see
[Credits](#credits).
