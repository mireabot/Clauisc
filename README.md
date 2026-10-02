# Clauisc

**Apple Music, live in your Claude Code prompt.** Clauisc is a Claude Code
plugin that sits right-aligned just above your input line: the track, a
progress ring, and music notes rising to the beat, framed like a little
boombox.

```
 __________________________________________________
| Landline               ♪                   ⢀⡤⠶⢤⡀ |
| binki                ♫                     ⢾   ⡷ |
|                         ♪                  ⠈⠓⠶⠚⠁ |
`--------------------------------------------------'
```

> **Status: early.** Tested against a mocked Music app and on macOS 26. Reports and screenshots are welcome in
> [Issues](https://github.com/mireabot/Clauisc/issues).

## Features

- **Title and artist**, stacked and left-aligned at the frame's left edge.
- **Progress ring**: a 9-dot circle in braille that fills clockwise from the
  top as the track plays; accent-colored while playing, gray while paused.
- **Rising notes**: in the middle of the frame, on every beat a ♪ or ♫ in a
  random color starts at the bottom of a 5×3 area and floats up a row per
  beat. The beat follows
  the track's BPM when Apple Music has one, a loose random groove otherwise.
  Paused, the last notes drift away.
- **Two-way sync**: play, pause, skip or scrub in Music and the band follows
  within about 2 seconds.
- **Fits the terminal**: 5 rows tall; in a small window it becomes one line.
- **Streamed songs too**: reads macOS's system Now Playing info, so streamed
  Apple Music songs show up, not just your library.
- **No dependencies**: only macOS's built-in `osascript`.

## Requirements

- macOS with the Music app.
- Claude Code in the terminal, on a build that supports function-hook
  plugins.
- A true-color terminal (Terminal, iTerm2, Ghostty, kitty, WezTerm) for the
  ring and note colors.
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
| `/clauisc` | Hide or show the band |
| `/clauisc status` | Report what Clauisc sees: which source answered, osascript's output, the track, timers, and whether the band was drawn |

## Troubleshooting

Run `/clauisc status` first; it checks Music right away and reports what it
found.

- **The band says macOS is blocking access to Music**: open System Settings →
  Privacy & Security → Automation, turn on **Music** under your terminal app,
  and restart the terminal.
- **No band and no message**: Music isn't open, or nothing is loaded in it.
  Start a track; the band appears within 2 seconds.
- **The band doesn't follow play/pause**: check `/clauisc status`. `timer
  ticks` should climb by about one every 2 seconds; if it doesn't, `backup
  polls` shows the beat timer covering for it.
- **`band drawn: 0 times`**: Claude Code isn't loading the plugin. Check
  `claude --version`, run `claude plugin validate ~/Clauisc/plugins/clauisc`,
  and start with `claude --debug --plugin-dir ~/Clauisc/plugins/clauisc` to
  see why.
- **Check Music directly**:
  `osascript -e 'tell application "Music" to get name of current track'`
- **Small window or the desktop app**: the band needs 5 rows and about 32
  columns, and only the terminal draws the ring and notes; otherwise it's
  one line of text.

## How it works

1. **Track**: every 2 seconds a JavaScript for Automation script reads
   macOS's system **Now Playing** info, the same data Control Center's media
   widget shows: title, artist, album, position and duration. It
   describes streamed Apple Music songs, which Music's own AppleScript can't
   on recent macOS. If Now Playing can't be read, Clauisc falls back to
   asking Music through AppleScript. The beat timer doubles as a backup: if
   the 2-second timer goes quiet, it checks itself.
2. **Ring**: braille cells hold 2×4 dots spaced evenly across and down, so a
   circle drawn in dots stays round. Between polls the ring advances from the
   time since the last one.
3. **Drawing**: the ring and notes are Claude Code `Raster` elements.
   On each beat the ring and notes are repainted in place, without
   redrawing the band.

## Customizing

Layout lives in [`plugins/clauisc/hooks/register.tsx`](plugins/clauisc/hooks/register.tsx),
drawing in [`plugins/clauisc/hooks/lib.ts`](plugins/clauisc/hooks/lib.ts):

| Name | What it controls |
| --- | --- |
| `GAP` | Columns between components |
| `TEXT_PAD` | Columns left of the title/artist stack |
| `BAR_INNER` | Inside width of the frame; the notes sit in its middle and the title stack fills the space to their left |
| `RING_COLS`, `NOTES_COLS`, `BAND_ROWS` | Component sizes |
| `noteColor` | How each note's color is picked |
| `riseNotes` | How notes start and rise |
| `beatMs` | How BPM maps to the beat |

## Development

### Live reload while you edit

Start Claude Code on the plugin folder:

```sh
claude --debug --plugin-dir ~/Clauisc/plugins/clauisc
```

An interactive session watches that folder: save a file and the plugin
reloads in place (its hooks run again, the band redraws), with no restart.
If a hook throws or a drawing is refused, the transcript shows one dim line
naming the hook and the reason; `--debug` writes every occurrence to the
debug log. `/clauisc status` shows the plugin's own view at any time.

You can also ask Claude in that same session to change the plugin: edits it
makes reload when its turn ends.

### Checks

```sh
cd ~/Clauisc/plugins/clauisc
claude plugin validate .   # what the engine will load, and anything it would refuse
claude plugin test .       # the tests; they mock osascript, so they run on any OS
```

Once the plugin has loaded, Claude Code writes its API types to
`plugins/clauisc/.claude-plugin/types/` (git-ignored), so an editor or
`tsc -p plugins/clauisc` type-checks it.

### Files

```
.claude-plugin/marketplace.json   marketplace manifest
plugins/clauisc/
  .claude-plugin/plugin.json      plugin manifest
  hooks/register.tsx              hooks: polling, beat, band layout, /clauisc
  hooks/lib.ts                    AppleScript/JXA, parsing, ring and notes cells
  types/index.d.ts                state contract
  tests/band.test.tsx             tests
install.sh                        local install for every session
```

## Known limits

- Now Playing comes from macOS's private MediaRemote framework. It works on
  macOS 26 from `osascript`, but Apple has restricted it before and a macOS
  update could again; Clauisc then falls back to Music's AppleScript, which
  only sees library songs.
- Now Playing is system-wide: if another app (a browser, Spotify) is the
  current player, the band shows that.
- Now Playing has no BPM, so the notes usually rise on a random groove.
- The ring and notes are terminal only; other Claude Code surfaces
  get one line of text.

## Credits

- The frame's shape is inspired by **VK**'s ASCII boombox
  ([asciiart.website/art/2612](https://asciiart.website/art/2612)).
- Clauisc is a fan project, not affiliated with or endorsed by Anthropic.
  Claude is a trademark of Anthropic.

## License

[MIT](LICENSE)
