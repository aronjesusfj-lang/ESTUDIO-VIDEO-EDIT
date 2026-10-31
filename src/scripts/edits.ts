// Per-video trim and manual cuts. Pure helpers only: no DOM, no storage, so the
// batch pipeline can reuse them without loading the editor chunk.
import type { TimeRange } from "@/scripts/cuts.ts"

export type Trim = { start: number; end: number }

export type VideoEdits = { trim: Trim; manualCuts: TimeRange[] }

// A trim whose end is 0 means "not set yet": it becomes the whole video the
// first time the edits are normalized against a known duration.
export const DEFAULT_TRIM: Trim = { start: 0, end: 0 }

function validDuration(duration: number) {
  return Number.isFinite(duration) && duration > 0 ? duration : 0
}

function finiteOr(value: number | null | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function clampValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function clipRange(
  range: TimeRange | null | undefined,
  start: number,
  end: number,
): TimeRange | null {
  if (!range) return null
  const rangeStart = Math.max(start, finiteOr(range.start, start))
  const rangeEnd = Math.min(end, finiteOr(range.end, start))
  return rangeEnd > rangeStart ? { start: rangeStart, end: rangeEnd } : null
}

function clipRanges(
  ranges: TimeRange[] | null | undefined,
  start: number,
  end: number,
): TimeRange[] {
  const clipped: TimeRange[] = []
  for (const range of ranges || []) {
    const value = clipRange(range, start, end)
    if (value) clipped.push(value)
  }
  return clipped
}

/** Trim clamped to the media: an unset end (0) keeps the whole duration. */
export function normalizeTrim(
  trim: Partial<Trim> | null | undefined,
  duration: number,
): Trim {
  const total = validDuration(duration)
  if (!total) return { start: 0, end: 0 }
  const start = clampValue(finiteOr(trim?.start, 0), 0, total)
  const rawEnd = finiteOr(trim?.end, total)
  const end = rawEnd > 0 ? clampValue(rawEnd, 0, total) : total
  // A collapsed selection keeps nothing, which callers read as "no trim".
  if (start >= end) return { start: 0, end: 0 }
  return { start, end }
}

export function normalizeEdits(
  edits: Partial<VideoEdits> | null | undefined,
  duration: number,
): VideoEdits {
  const total = validDuration(duration)
  return {
    trim: normalizeTrim(edits?.trim, total),
    manualCuts: total ? clipRanges(edits?.manualCuts, 0, total) : [],
  }
}

/** Sorted, overlapping and adjacent ranges merged into one. */
export function mergeTimeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = (ranges || [])
    .filter(
      (range) =>
        range &&
        Number.isFinite(range.start) &&
        Number.isFinite(range.end) &&
        range.end > range.start,
    )
    .map((range) => ({ start: range.start, end: range.end }))
    .sort((a, b) => a.start - b.start)

  const merged: TimeRange[] = []
  for (const range of sorted) {
    const previous = merged[merged.length - 1]
    // A cut that ends where the next one starts is one continuous cut.
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end)
    } else {
      merged.push(range)
    }
  }
  return merged
}

/**
 * Cuts to apply to the source media: the trim's outside plus every manual and
 * word cut, clipped to the media and merged. Mapping source time through these
 * ranges (see cuts.ts) yields an output timeline that starts at 0.
 */
export function effectiveCuts(
  edits: VideoEdits | null | undefined,
  wordCuts: TimeRange[],
  duration: number,
): TimeRange[] {
  const total = validDuration(duration)
  if (!total) return []

  const normalized = normalizeEdits(edits, total)
  const ranges = [
    ...normalized.manualCuts,
    ...clipRanges(wordCuts, 0, total),
  ]

  // A collapsed trim carries no usable selection, so it is ignored instead of
  // cutting the whole video away.
  if (trimDuration(normalized.trim) > 0) {
    if (normalized.trim.start > 0)
      ranges.push({ start: 0, end: normalized.trim.start })
    if (normalized.trim.end < total)
      ranges.push({ start: normalized.trim.end, end: total })
  }

  return mergeTimeRanges(ranges)
}

export function clampToTrim(time: number, trim: Trim): number {
  const start = finiteOr(trim?.start, 0)
  const end = Math.max(start, finiteOr(trim?.end, start))
  return clampValue(finiteOr(time, start), start, end)
}

export function trimDuration(trim: Trim): number {
  const start = finiteOr(trim?.start, 0)
  const end = finiteOr(trim?.end, start)
  return Math.max(0, end - start)
}

/** Inclusive on both ends, matching the fixed points of clampToTrim. */
export function isInsideTrim(time: number, trim: Trim): boolean {
  const start = finiteOr(trim?.start, 0)
  const end = Math.max(start, finiteOr(trim?.end, start))
  return time >= start && time <= end
}
