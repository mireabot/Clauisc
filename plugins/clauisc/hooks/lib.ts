import type { Track } from '../types'

/** Every piece of the band is three rows tall: the title stack, the ring and the notes. */
export const BAND_ROWS = 3
export const RING_COLS = 5
export const NOTES_COLS = 5

const DEFAULT = 0x01000000

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

/**
 * JXA reading macOS's system Now Playing info (what Control Center shows),
 * which also describes streamed Apple Music songs that Music's AppleScript
 * cannot. Prints JSON for parseNowPlaying.
 */
export const NOW_SCRIPT = `
ObjC.import('Foundation');
function run() {
  $.NSBundle.bundleWithPath('/System/Library/PrivateFrameworks/MediaRemote.framework/').load;
  var request = $.NSClassFromString('MRNowPlayingRequest');
  if (request.isNil()) return JSON.stringify({ error: 'MRNowPlayingRequest is unavailable' });
  var item = request.localNowPlayingItem;
  if (item.isNil()) return JSON.stringify({ state: 'stopped' });
  var info = item.nowPlayingInfo;
  if (info.isNil()) return JSON.stringify({ state: 'stopped' });
  function raw(key) { return info.objectForKey('kMRMediaRemoteNowPlayingInfo' + key); }
  function get(key) { var value = raw(key); return value.isNil() ? null : ObjC.unwrap(value); }
  var rate = Number(get('PlaybackRate') || 0);
  var elapsed = Number(get('ElapsedTime') || 0);
  var stamp = raw('Timestamp');
  var since = stamp.isNil() ? 0 : -stamp.timeIntervalSinceNow;
  return JSON.stringify({
    state: rate > 0 ? 'playing' : 'paused',
    id: String(get('UniqueIdentifier') || get('ContentItemIdentifier') || ''),
    title: get('Title') || '',
    artist: get('Artist') || '',
    album: get('Album') || '',
    position: elapsed + rate * since,
    duration: Number(get('Duration') || 0),
  });
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

/** What NOW_SCRIPT reports, parsed: the track, or null when nothing is playing. */
export type NowPlaying = { track: Track | null }

/**
 * NOW_SCRIPT's JSON as a track; null when it is not Now Playing JSON at all
 * (the caller then falls back to Music's AppleScript).
 */
export function parseNowPlaying(stdout: string): NowPlaying | null {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(stdout.trim()) as Record<string, unknown>
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || typeof raw.error === 'string') return null
  const text = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : '')
  const number = (key: string) => (typeof raw[key] === 'number' && Number.isFinite(raw[key]) ? (raw[key] as number) : 0)
  const state = text('state')
  const name = text('title')
  const artist = text('artist')
  const hasTrack = (state === 'playing' || state === 'paused') && (name !== '' || artist !== '')
  return {
    track: hasTrack
      ? {
          isPlaying: state === 'playing',
          id: text('id') || `${name}|${artist}`,
          name: name || 'Unknown track',
          artist,
          album: text('album'),
          bpm: 0,
          position: number('position'),
          duration: number('duration'),
        }
      : null,
  }
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
