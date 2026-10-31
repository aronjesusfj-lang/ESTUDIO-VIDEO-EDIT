import type { AppState } from "@/scripts/editor.ts"
import type { CaptionStyleState } from "@/scripts/captionStyleStore.ts"
import { DEFAULT_TRIM, type VideoEdits } from "@/scripts/edits.ts"
import type { SubtitleSegment } from "@/scripts/subtitles.ts"

export type ProjectVideoStatus = "queued" | "transcribing" | "ready" | "error" | "cancelled"

export type ProjectVideoSnapshot = {
  editor: AppState
  captionStyles: CaptionStyleState
  edits: VideoEdits
}

export type ProjectVideo = {
  id: string
  file: File
  name: string
  duration: number
  language: string
  status: ProjectVideoStatus
  progress?: number
  progressLabel?: string
  snapshot?: ProjectVideoSnapshot
  text?: string
  subtitles?: SubtitleSegment[]
  trim: VideoEdits["trim"]
  manualCuts: VideoEdits["manualCuts"]
  styleOverride?: CaptionStyleState
  error?: string
}

export type Project = {
  id: string
  name: string
  videos: ProjectVideo[]
  createdAt: number
  updatedAt: number
}

export type ProjectManifestVideo = {
  file: string
  trim?: VideoEdits["trim"]
  manualCuts?: VideoEdits["manualCuts"]
  styleOverride?: CaptionStyleState
}

export type ProjectManifest = { version: 1; videos: ProjectManifestVideo[] }

const id = () => globalThis.crypto?.randomUUID?.() || `video-${Date.now()}-${Math.random().toString(36).slice(2)}`

export function createProject(name: string): Project {
  const now = Date.now()
  return { id: id(), name, videos: [], createdAt: now, updatedAt: now }
}

export function createProjectVideo(file: File): ProjectVideo {
  return {
    id: id(), file, name: file.name, duration: 0, language: "auto",
    status: "queued", trim: { ...DEFAULT_TRIM }, manualCuts: [],
  }
}

export function cloneVideoSnapshot(snapshot: ProjectVideoSnapshot): ProjectVideoSnapshot {
  return structuredClone(snapshot)
}
