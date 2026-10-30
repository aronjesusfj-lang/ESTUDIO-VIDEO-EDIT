import type { SubtitleSegment } from "@/scripts/subtitles.ts"

/** Snap subtitle edges to nearby speech activity. It only adjusts within the
 * supplied window, so it cannot move a cue across a large pause. */
export function alignSegmentsToSpeech(
  segments: SubtitleSegment[],
  audio: Float32Array,
  sampleRate = 16_000,
  searchSeconds = 0.35,
): SubtitleSegment[] {
  if (!audio.length || !segments.length || sampleRate <= 0) return segments.map((s) => ({ ...s }))
  const frameSeconds = 0.02
  const frameSize = Math.max(1, Math.round(sampleRate * frameSeconds))
  const energy = new Float32Array(Math.ceil(audio.length / frameSize))
  let max = 0
  for (let frame = 0; frame < energy.length; frame += 1) {
    const from = frame * frameSize
    const to = Math.min(audio.length, from + frameSize)
    let sum = 0
    for (let i = from; i < to; i += 1) sum += audio[i] * audio[i]
    energy[frame] = Math.sqrt(sum / Math.max(1, to - from))
    max = Math.max(max, energy[frame])
  }
  const threshold = Math.max(0.006, max * 0.08)
  const active = energy.map((value) => value >= threshold)
  const searchFrames = Math.ceil(searchSeconds / frameSeconds)
  const find = (time: number, edge: "start" | "end") => {
    const center = Math.max(0, Math.min(energy.length - 1, Math.round(time / frameSeconds)))
    const from = Math.max(0, center - searchFrames)
    const to = Math.min(energy.length - 1, center + searchFrames)
    let best = -1
    for (let frame = from; frame <= to; frame += 1) {
      if (!active[frame]) continue
      if (best < 0 || Math.abs(frame - center) < Math.abs(best - center) ||
        (Math.abs(frame - center) === Math.abs(best - center) && edge === "start" && frame < best) ||
        (Math.abs(frame - center) === Math.abs(best - center) && edge === "end" && frame > best)) best = frame
    }
    return best < 0 ? time : best * frameSeconds + (edge === "end" ? frameSeconds : 0)
  }
  return segments.map((segment) => {
    const start = find(segment.start, "start")
    const end = find(segment.end, "end")
    if (end <= start + 0.12) return { ...segment }
    return { ...segment, start, end }
  })
}
