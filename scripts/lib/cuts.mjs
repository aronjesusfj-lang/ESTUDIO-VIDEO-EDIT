// Time-range helpers shared by the CLI and the manifest flow. The semantics
// mirror src/scripts/cuts.ts so the batch output matches the editor.

/** Parses "1:02:03.5", "02:03" or plain seconds into a number of seconds. */
export function parseTime(value) {
  const raw = String(value ?? '').trim()
  if (!raw) throw new Error('Time value is empty')

  if (/^\d+(?:[.,]\d+)?$/.test(raw)) {
    const seconds = Number(raw.replace(',', '.'))
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`Invalid time value: ${value}`)
    return seconds
  }

  const parts = raw.split(':')
  if (parts.length < 2 || parts.length > 3) throw new Error(`Invalid time value: ${value}`)

  const last = parts[parts.length - 1]
  if (!/^\d{1,2}(?:[.,]\d{1,3})?$/.test(last)) throw new Error(`Invalid time value: ${value}`)
  const seconds = Number(last.replace(',', '.'))
  if (seconds >= 60) throw new Error(`Invalid time value: ${value} (seconds must be below 60)`)

  if (!/^\d+$/.test(parts[0])) throw new Error(`Invalid time value: ${value}`)
  if (parts.length === 2) return Number(parts[0]) * 60 + seconds

  if (!/^\d+$/.test(parts[1])) throw new Error(`Invalid time value: ${value}`)
  const minutes = Number(parts[1])
  if (minutes >= 60) throw new Error(`Invalid time value: ${value} (minutes must be below 60)`)
  return Number(parts[0]) * 3600 + minutes * 60 + seconds
}

/** Parses a single range such as "00:10-00:40". */
export function parseTimeRange(range) {
  const raw = String(range ?? '').trim()
  const match = raw.match(/^(.+?)\s*-\s*(.+)$/)
  if (!match) throw new Error(`Invalid time range: ${range} (expected START-END)`)

  const start = parseTime(match[1])
  const end = parseTime(match[2])
  if (!(end > start)) throw new Error(`Invalid time range: ${range} (end must be greater than start)`)
  return { start, end }
}

/** Sorts and merges overlapping or touching ranges. */
export function mergeRanges(ranges) {
  const sorted = (ranges || [])
    .map((range) => ({ start: Number(range?.start), end: Number(range?.end) }))
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)

  return sorted.reduce((merged, range) => {
    const previous = merged[merged.length - 1]
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end)
    } else {
      merged.push({ ...range })
    }
    return merged
  }, [])
}

/**
 * Clamps a trim window to the media duration. Returns null when there is no
 * trim or when the window collapses to nothing.
 */
export function normalizeTrim(trim, duration) {
  if (!trim) return null
  const total = Number(duration)
  if (!Number.isFinite(total) || total <= 0) return null

  const start = Math.max(0, Math.min(total, Number(trim.start) || 0))
  const end = Math.max(0, Math.min(total, Number(trim.end) || 0))
  if (!(end > start)) return null
  return { start, end }
}

/** All source ranges removed by the trim window and the manual cuts. */
export function effectiveCuts({ trim, cuts } = {}, duration) {
  const total = Number(duration)
  if (!Number.isFinite(total) || total <= 0) return []

  const ranges = []
  if (trim) {
    const window = normalizeTrim(trim, total)
    // A collapsed trim removes the whole media, which is what the editor
    // would render (an empty timeline).
    if (!window) return [{ start: 0, end: total }]
    if (window.start > 0) ranges.push({ start: 0, end: window.start })
    if (window.end < total) ranges.push({ start: window.end, end: total })
  }

  for (const cut of cuts || []) {
    const start = Math.max(0, Math.min(total, Number(cut?.start)))
    const end = Math.max(0, Math.min(total, Number(cut?.end)))
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) ranges.push({ start, end })
  }

  return mergeRanges(ranges)
}

/** Maps a source time to the time it lands on once the cuts are removed. */
export function mapTimeThroughCuts(ranges, time) {
  let removed = 0
  for (const range of ranges || []) {
    if (time <= range.start) break
    removed += Math.min(time, range.end) - range.start
  }
  return time - removed
}

/** Kept parts of [start, end), already mapped to the output timeline. */
export function keptParts(ranges, start, end) {
  const parts = []
  let cursor = start
  for (const range of ranges || []) {
    if (range.end <= cursor) continue
    if (range.start >= end) break
    if (range.start > cursor) {
      parts.push({ start: cursor, end: range.start, outputStart: mapTimeThroughCuts(ranges, cursor) })
    }
    cursor = Math.max(cursor, range.end)
  }
  if (cursor < end) {
    parts.push({ start: cursor, end, outputStart: mapTimeThroughCuts(ranges, cursor) })
  }
  return parts
}

/** Subtitle timings for the cut video (segments fully inside a cut are dropped). */
export function segmentsThroughCuts(segments, ranges) {
  if (!ranges || !ranges.length) return segments
  return (segments || [])
    .filter((segment) => keptParts(ranges, segment.start, segment.end).length)
    .map((segment) => ({
      ...segment,
      start: mapTimeThroughCuts(ranges, segment.start),
      end: mapTimeThroughCuts(ranges, segment.end),
      words: Array.isArray(segment.words)
        ? segment.words.map((word) => ({
            ...word,
            start: mapTimeThroughCuts(ranges, word.start),
            end: mapTimeThroughCuts(ranges, word.end),
          }))
        : segment.words,
    }))
}

/** Source ranges of video to keep after applying trim and cuts. */
export function keptRanges(trim, cuts, duration) {
  const total = Number(duration)
  if (!Number.isFinite(total) || total <= 0) return []
  const removed = effectiveCuts({ trim, cuts }, total)
  return keptParts(removed, 0, total).map(({ start, end }) => ({ start, end }))
}
