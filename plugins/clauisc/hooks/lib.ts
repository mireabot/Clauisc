import type { ArtStyle, Track } from '../types'

/** Album art is sampled at ART_PX x ART_PX and drawn two pixels per cell. */
export const ART_PX = 12

/** Every piece of the band is three rows tall: the cover, the ring and the notes. */
export const BAND_ROWS = 3
export const COVER_COLS = 6
export const RING_COLS = 5
export const NOTES_COLS = 5

const DEFAULT = 0x01000000
const HALF_TOP = 0x2580 // ▀
const HALF_BOTTOM = 0x2584 // ▄
const NOTE = 0x266a // ♪
const ASCII_RAMP = '.:-=+*#%@'

const SEP = '\u001f'

/** AppleScript printing the player state and current track, fields split by U+001F. */
export const INFO_SCRIPT = `
if application "Music" is not running then return "stopped"
tell application "Music"
  set stateText to player state as string
  if stateText is "stopped" then return "stopped"
  set {trackKey, trackName, trackArtist, trackAlbum, trackBpm, trackLength} to {"", "", "", "", 0, 0}
  set {trackKind, trackProblem} to {"", ""}
  try
    set nowTrack to current track
    try
      set trackKind to (class of nowTrack) as string
    end try
    try
      set trackKey to persistent ID of nowTrack
    end try
    try
      set trackName to name of nowTrack
    end try
    try
      set trackArtist to artist of nowTrack
    end try
    try
      set trackAlbum to album of nowTrack
    end try
    try
      set trackBpm to bpm of nowTrack
    end try
    try
      set trackLength to duration of nowTrack
    end try
  on error errorText number errorNumber
    set trackProblem to (errorNumber as string) & " " & errorText
  end try
  if trackName is "" then
    try
      set trackName to current stream title
    end try
  end if
  set playhead to 0
  try
    set playhead to player position
  end try
  set sep to character id 31
  return stateText & sep & trackKey & sep & trackName & sep & trackArtist & sep & trackAlbum & sep & trackBpm & sep & playhead & sep & trackLength & sep & trackKind & sep & trackProblem
end tell
`

/** AppleScript writing the current track's artwork bytes to the path in argv. */
export const ART_SCRIPT = `
on run argv
  set outPath to item 1 of argv
  tell application "Music"
    try
      set artBytes to raw data of artwork 1 of current track
    on error
      try
        set artBytes to data of artwork 1 of current track
      on error
        return "none"
      end try
    end try
  end tell
  set outFile to open for access (POSIX file outPath) with write permission
  try
    set eof outFile to 0
    write artBytes to outFile
  end try
  close access outFile
  return "ok"
end run
`

/** JXA scaling an image file to W x H and printing its pixels as hex RGB. */
export const SAMPLE_SCRIPT = `
ObjC.import('AppKit');
function run(argv) {
  var W = parseInt(argv[1]), H = parseInt(argv[2]);
  var img = $.NSImage.alloc.initWithContentsOfFile(argv[0]);
  if (img.isNil()) return '';
  var rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, W, H, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
  $.NSGraphicsContext.saveGraphicsState;
  var ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep);
  ctx.imageInterpolation = $.NSImageInterpolationHigh;
  $.NSGraphicsContext.currentContext = ctx;
  img.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, W, H), $.NSMakeRect(0, 0, 0, 0), $.NSCompositingOperationCopy, 1);
  $.NSGraphicsContext.restoreGraphicsState;
  var out = '';
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var c = rep.colorAtXY(x, y);
    [c.redComponent, c.greenComponent, c.blueComponent].forEach(function (v) {
      var n = Math.max(0, Math.min(255, Math.round(v * 255)));
      out += (n < 16 ? '0' : '') + n.toString(16);
    });
  }
  return out;
}
`

const num = (s: string | undefined) => {
  const n = parseFloat((s ?? '').trim().replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export function parseInfo(stdout: string): Track | null {
  // AppleScript spells an absent value "missing value" when it joins text.
  const f = stdout
    .replace(/\n$/, '')
    .split(SEP)
    .map(field => (field.trim() === 'missing value' ? '' : field))
  if (f.length < 8 || (f[0] !== 'playing' && f[0] !== 'paused')) return null
  const name = f[2] ?? ''
  const artist = f[3] ?? ''
  if (!name && !artist) {
    // Paused with nothing loaded: nothing to show.
    if (f[0] !== 'playing') return null
    // Playing, but Music describes no track (often a streamed song): still show the band.
    return {
      isPlaying: true,
      id: 'undescribed',
      name: 'Playing in Music',
      artist: 'Music shares no track details',
      album: '',
      bpm: 0,
      position: num(f[6]),
      duration: num(f[7]),
    }
  }
  return {
    isPlaying: f[0] === 'playing',
    id: f[1] || `${name}|${artist}`,
    name: name || 'Unknown track',
    artist,
    album: f[4] ?? '',
    bpm: num(f[5]),
    position: num(f[6]),
    duration: num(f[7]),
  }
}

export function isPixels(hex: string): boolean {
  return hex.length === ART_PX * ART_PX * 6 && /^[0-9a-f]+$/.test(hex)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Little-endian u32 words as standard padded base64, the Raster's `cells`. */
export function encode(words: number[]): string {
  const bytes = new Uint8Array(Uint32Array.from(words).buffer)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? B64[n & 63]! : '='
  }
  return out
}

/** One cell from a top and bottom pixel; null is transparent. */
function halfCell(words: number[], top: number | null, bottom: number | null) {
  if (top === null && bottom === null) words.push(0x20, DEFAULT, DEFAULT)
  else if (top === null) words.push(HALF_BOTTOM, bottom!, DEFAULT)
  else words.push(HALF_TOP, top, bottom ?? DEFAULT)
}

/** Pixel grid from hex, box-averaged down by `scale`. */
function pixels(hex: string, scale: number): number[][] {
  const size = ART_PX / scale
  const grid: number[][] = []
  for (let y = 0; y < size; y++) {
    const row: number[] = []
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = ((y * scale + dy) * ART_PX + x * scale + dx) * 6
          r += parseInt(hex.slice(i, i + 2), 16)
          g += parseInt(hex.slice(i + 2, i + 4), 16)
          b += parseInt(hex.slice(i + 4, i + 6), 16)
        }
      }
      const n = scale * scale
      row.push((Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n))
    }
    grid.push(row)
  }
  return grid
}

const mix = (a: number, b: number) =>
  ((((a >> 16) + (b >> 16)) >> 1) << 16) |
  (((((a >> 8) & 0xff) + ((b >> 8) & 0xff)) >> 1) << 8) |
  (((a & 0xff) + (b & 0xff)) >> 1)

const luma = (c: number) => (0.2126 * (c >> 16) + 0.7152 * ((c >> 8) & 0xff) + 0.0722 * (c & 0xff)) / 255

/**
 * Raster cells for the album art: `size` columns by `size / 2` rows.
 * `blocks` packs two pixels per cell; `ascii` picks a ramp character by
 * brightness, colored with the cell's average.
 */
export function artCells(hex: string | null, size: number, style: ArtStyle): string {
  const rows = size / 2
  const words: number[] = []
  if (!hex) {
    // No artwork: a dim checker so the slot still reads as a cover.
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < size; x++)
        words.push(x === size >> 1 && y === rows >> 1 ? NOTE : 0x2591, 0x6b6b6b, DEFAULT)
    return encode(words)
  }
  const grid = pixels(hex, ART_PX / size)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < size; x++) {
      const top = grid[y * 2]![x]!
      const bottom = grid[y * 2 + 1]![x]!
      if (style === 'blocks') halfCell(words, top, bottom)
      else {
        const c = mix(top, bottom)
        const i = Math.min(ASCII_RAMP.length - 1, Math.floor(luma(c) * ASCII_RAMP.length))
        words.push(ASCII_RAMP.charCodeAt(i), c, DEFAULT)
      }
    }
  }
  return encode(words)
}

/** A bright, saturated color for a beat's note: `hue` in 0..1. */
export function noteColor(hue: number): number {
  const h = (((hue % 1) + 1) % 1) * 6
  const x = Math.round(255 * (1 - Math.abs((h % 2) - 1)))
  const [r, g, b] = [[255, x, 0], [x, 255, 0], [0, 255, x], [0, x, 255], [x, 0, 255], [255, 0, x]][Math.floor(h)]!
  return (r! << 16) | (g! << 8) | b!
}

/** Milliseconds to the next beat: the track's beat when it has a BPM, else a loose random groove. */
export function beatMs(bpm: number, random: number): number {
  if (bpm > 0) {
    let ms = 60000 / bpm
    while (ms < 300) ms *= 2
    while (ms > 1200) ms /= 2
    return ms
  }
  return 380 + random * 320
}

const ACCENT = 0xd97757
const RING_RESTING = 0x8a8a8a
const RING_TRACK = 0x444444

// The ring: a circle 9 dots across in braille, whose cells hold 2 x 4 dots.
// Braille dots are as far apart across as down, so the circle comes out round.
const RING_DOTS: { x: number; y: number; at: number }[] = (() => {
  const dots: { x: number; y: number; at: number }[] = []
  const cx = (RING_COLS * 2 - 1) / 2
  const cy = (BAND_ROWS * 4 - 1) / 2
  for (let y = 0; y < BAND_ROWS * 4; y++) {
    for (let x = 0; x < RING_COLS * 2; x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (Math.abs(d - 4) <= 0.55) {
        // Clockwise from twelve o'clock, 0..1.
        const at = (Math.atan2(x - cx, cy - y) / (2 * Math.PI) + 1) % 1
        dots.push({ x, y, at })
      }
    }
  }
  return dots
})()

const BRAILLE_BIT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]

/**
 * The progress ring, RING_COLS x BAND_ROWS cells: the played part of the
 * track lit clockwise from the top, the rest dim. A cell shows one color, so
 * a cell the arc reaches shows only its lit dots.
 */
export function ringCells(fraction: number, isPlaying: boolean): string {
  const lit = Math.max(0, Math.min(1, fraction))
  const cells = Array.from({ length: RING_COLS * BAND_ROWS }, () => ({ on: 0, off: 0 }))
  for (const dot of RING_DOTS) {
    const cell = cells[Math.floor(dot.y / 4) * RING_COLS + Math.floor(dot.x / 2)]!
    const bit = BRAILLE_BIT[dot.y % 4]![dot.x % 2]!
    if (dot.at < lit) cell.on |= bit
    else cell.off |= bit
  }
  const words: number[] = []
  for (const cell of cells) {
    if (cell.on) words.push(0x2800 + cell.on, isPlaying ? ACCENT : RING_RESTING, DEFAULT)
    else if (cell.off) words.push(0x2800 + cell.off, RING_TRACK, DEFAULT)
    else words.push(0x20, DEFAULT, DEFAULT)
  }
  return encode(words)
}

/** One note in the notes frame: its cell, color and glyph. */
export type FloatingNote = { col: number; row: number; color: number; glyph: number }

/**
 * One beat of the notes frame: every note rises a row, those past the top
 * leave, and (with `spawn`) a new one starts on the bottom row at a random column.
 */
export function riseNotes(
  notes: readonly FloatingNote[],
  random: () => number,
  spawn = true,
): FloatingNote[] {
  const risen = notes.map(note => ({ ...note, row: note.row - 1 })).filter(note => note.row >= 0)
  if (!spawn) return risen
  risen.push({
    col: Math.floor(random() * NOTES_COLS),
    row: BAND_ROWS - 1,
    color: noteColor(random()),
    glyph: random() < 0.5 ? 0x266a : 0x266b,
  })
  return risen
}

/** The notes frame, NOTES_COLS x BAND_ROWS cells. */
export function notesCells(notes: readonly FloatingNote[]): string {
  const words: number[] = []
  for (let row = 0; row < BAND_ROWS; row++) {
    for (let col = 0; col < NOTES_COLS; col++) {
      const note = notes.find(n => n.row === row && n.col === col)
      if (note) words.push(note.glyph, note.color, DEFAULT)
      else words.push(0x20, DEFAULT, DEFAULT)
    }
  }
  return encode(words)
}

/** A one-line, actionable reading of osascript's error output. */
export function explainFailure(stderr: string): string {
  if (/-1743|not authori[sz]ed|Not allowed to send Apple events/i.test(stderr)) {
    return 'macOS is blocking access to Music. Allow your terminal app under System Settings → Privacy & Security → Automation → Music, then restart it.'
  }
  if (/-1728|-1708/.test(stderr)) return 'Music has no current track it can describe.'
  const line = stderr.trim().split('\n').pop() ?? ''
  return line ? `osascript failed: ${line.slice(0, 160)}` : 'osascript failed without saying why.'
}
