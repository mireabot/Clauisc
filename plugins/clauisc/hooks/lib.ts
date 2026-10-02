import type { ArtStyle, Track } from '../types'

/** Album art is sampled at ART_PX x ART_PX and drawn two pixels per cell. */
export const ART_PX = 16

const DEFAULT = 0x01000000
const HALF_TOP = 0x2580 // ▀
const HALF_BOTTOM = 0x2584 // ▄
const NOTE = 0x266a // ♪
const ASCII_RAMP = '.:-=+*#%@'

const SEP = '\u001f'

/** AppleScript printing the player state and current track, one field per line. */
export const INFO_SCRIPT = `
if application "Music" is not running then return "stopped"
tell application "Music"
  set st to player state as string
  if st is "stopped" then return "stopped"
  set t to current track
  set {tid, tn, ta, tb, tbpm, tdur} to {"", "", "", "", 0, 0}
  try
    set tid to persistent ID of t
  end try
  try
    set tn to name of t
  end try
  try
    set ta to artist of t
  end try
  try
    set tb to album of t
  end try
  try
    set tbpm to bpm of t
  end try
  try
    set tdur to duration of t
  end try
  if tn is "" then
    try
      set tn to current stream title
    end try
  end if
  set pos to 0
  try
    set pos to player position
  end try
  set s to (ASCII character 31)
  return st & s & tid & s & tn & s & ta & s & tb & s & tbpm & s & pos & s & tdur
end tell
`

/** AppleScript writing the current track's artwork bytes to the path in argv. */
export const ART_SCRIPT = `
on run argv
  set p to item 1 of argv
  tell application "Music"
    try
      set d to raw data of artwork 1 of current track
    on error
      try
        set d to data of artwork 1 of current track
      on error
        return "none"
      end try
    end try
  end tell
  set f to open for access (POSIX file p) with write permission
  try
    set eof f to 0
    write d to f
  end try
  close access f
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
  const f = stdout.replace(/\n$/, '').split(SEP)
  if (f.length < 8 || (f[0] !== 'playing' && f[0] !== 'paused')) return null
  return {
    isPlaying: f[0] === 'playing',
    id: f[1] || `${f[2]}|${f[3]}`,
    name: f[2] || 'Unknown track',
    artist: f[3] ?? '',
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

// The plush: Claude in headphones, 12 x 9 pixels on a 14 x 10 canvas.
const PALETTE: Record<string, number> = {
  o: 0xd97757, // body
  k: 0x1f1f1f, // eyes
  h: 0xa8adb3, // headband
  c: 0x4a4f55, // ear cups
}
const HEAD = [
  '....hhhh....',
  '..hh....hh..',
  '.h........h.',
  'cc.oooooo.cc',
  'cc.okooko.cc',
  'cc.oooooo.cc',
]
const BODY = ['.oooooooooo.', '...oooooo...']
const LEGS = ['...o.o..o.o.', '..o.o..o.o..']
export const PLUSH_COLS = 14
export const PLUSH_ROWS = 5

/** A bright, saturated color for a beat's note: `hue` in 0..1. */
export function noteColor(hue: number): number {
  const h = (((hue % 1) + 1) % 1) * 6
  const x = Math.round(255 * (1 - Math.abs((h % 2) - 1)))
  const [r, g, b] = [[255, x, 0], [x, 255, 0], [0, 255, x], [0, x, 255], [x, 0, 255], [255, 0, x]][Math.floor(h)]!
  return (r! << 16) | (g! << 8) | b!
}

/**
 * Frame 0..3 of the bop: down, tilt right, down, tilt left; -1 is still.
 * Every frame floats a ♪ in `note`'s color, alternating sides.
 */
export function plushCells(frame: number, note = PALETTE.o!): string {
  const W = PLUSH_COLS, H = PLUSH_ROWS * 2
  const canvas: (number | null)[][] = Array.from({ length: H }, () => Array(W).fill(null))
  const still = frame < 0
  const dy = still ? 0 : frame % 2 === 0 ? 1 : 0
  const tilt = still ? 0 : [0, 1, 0, -1][frame % 4]!
  const legs = LEGS[still ? 0 : (frame >> 1) % 2]!
  const put = (rows: string[], y0: number, dx: number) =>
    rows.forEach((row, y) =>
      [...row].forEach((p, x) => {
        if (p !== '.') canvas[y0 + y + dy]![1 + x + dx] = PALETTE[p] ?? null
      }),
    )
  put(HEAD, 0, tilt)
  put(BODY, HEAD.length, 0)
  put([legs], HEAD.length + BODY.length, 0)

  const words: number[] = []
  for (let r = 0; r < PLUSH_ROWS; r++) {
    for (let x = 0; x < W; x++) {
      const top = canvas[r * 2]![x]!
      const bottom = canvas[r * 2 + 1]![x]!
      const noteHere = !still && r === 0 && top === null && bottom === null &&
        x === (frame % 2 === 0 ? W - 1 : 0)
      if (noteHere) words.push(NOTE, note, DEFAULT)
      else halfCell(words, top, bottom)
    }
  }
  return encode(words)
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function progressBar(position: number, duration: number, width: number): string {
  if (duration <= 0 || width <= 0) return ''
  const filled = Math.round(Math.min(1, position / duration) * width)
  return '━'.repeat(filled) + '─'.repeat(width - filled)
}

/** Milliseconds to the next bop: the track's beat when it has a BPM, else a loose random groove. */
export function beatMs(bpm: number, random: number): number {
  if (bpm > 0) {
    let ms = 60000 / bpm
    while (ms < 300) ms *= 2
    while (ms > 1200) ms /= 2
    return ms
  }
  return 380 + random * 320
}
