import type { SubtitleSegment } from "@/scripts/subtitles.ts"

export type SubtitleQualityWarning = { segment: number; code: "long-text" | "short-duration" | "long-duration" | "overlap"; message: string }

/** Deterministic review hints for manual review; these never alter cue content or timing. */
export function reviewSubtitleQuality(segments: SubtitleSegment[]): SubtitleQualityWarning[] {
  const warnings: SubtitleQualityWarning[] = []
  segments.forEach((segment, index) => {
    const text = String(segment.text || "").trim()
    const duration = segment.end - segment.start
    if (text.length > 42) warnings.push({ segment: index + 1, code: "long-text", message: "Long line may be hard to read" })
    if (duration > 0 && duration < 0.45) warnings.push({ segment: index + 1, code: "short-duration", message: "Very short display time" })
    if (duration > 7) warnings.push({ segment: index + 1, code: "long-duration", message: "Long cue may need a split" })
    const next = segments[index + 1]
    if (next && segment.end > next.start + 0.04) warnings.push({ segment: index + 1, code: "overlap", message: `Overlaps subtitle ${index + 2}` })
  })
  return warnings
}
