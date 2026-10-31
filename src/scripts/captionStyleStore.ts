// Caption style state, kept apart from the editor chunk so the batch table can
// read and swap styles per video without loading the editor.
//
// Styles are keyed by `trackStyleKey(role, lang)`; the base styles below are the
// starting point for every new track and are shared by the preview and the
// canvas renderer, so they are exported as live objects (mutated in place).
export const captionStyle: any = {
  font: "sans",
  size: 1,
  color: "#ffffff",
  weight: 600,
  italic: false,
  align: "center",
  bgEnabled: true,
  bgColor: "#06080b",
  bgOpacity: 0.84,
  outline: false,
  wordHighlight: false,
  position: "bottom",
  customX: 50,
  customY: 88,
  secondary: false,
}

export const transcriptionCaptionStyle: any = {
  font: "sans",
  size: 0.86,
  color: "#dbeafe",
  weight: 500,
  italic: true,
  align: "center",
  bgEnabled: true,
  bgColor: "#06080b",
  bgOpacity: 0.5,
  outline: false,
  wordHighlight: false,
  position: "top",
  customX: 50,
  customY: 12,
  secondary: false,
}

const DEFAULT_CAPTION_STYLE = { ...captionStyle }
const DEFAULT_TRANSCRIPTION_STYLE = { ...transcriptionCaptionStyle }

export type CaptionStyleState = {
  styles: Record<string, any>
  presets: Record<string, string>
}

const captionStylesByTrack = new Map<string, any>()
const presetIdsByTrack = new Map<string, string>()

export function cloneStyle(style: any) {
  return { ...style }
}

export function baseStyleForRole(role = "default") {
  return role === "transcription" ? transcriptionCaptionStyle : captionStyle
}

export function trackStyleKey(role = "default", lang = "") {
  return `${role || "default"}:${lang || "__default"}`
}

export function captionStyleForTrack(role = "default", lang = "") {
  if (!lang) return baseStyleForRole(role)
  const key = trackStyleKey(role, lang)
  if (!captionStylesByTrack.has(key)) {
    captionStylesByTrack.set(key, cloneStyle(baseStyleForRole(role)))
  }
  return captionStylesByTrack.get(key)
}

export function captionStyleForRole(role = "default", lang = "") {
  return captionStyleForTrack(role, lang)
}

/** Every per-track style, for bulk edits (word highlight, resets). */
export function eachTrackStyle(fn: (style: any) => void) {
  captionStylesByTrack.forEach(fn)
}

export function getPresetIdForTrack(
  role = "default",
  lang = "",
): string | undefined {
  return presetIdsByTrack.get(trackStyleKey(role, lang))
}

export function setPresetIdForTrack(
  role: string,
  lang: string,
  id: string,
): void {
  presetIdsByTrack.set(trackStyleKey(role, lang), id)
}

export function getCaptionStyleState(): CaptionStyleState {
  const styles: Record<string, any> = {}
  captionStylesByTrack.forEach((style, key) => {
    styles[key] = cloneStyle(style)
  })
  const presets: Record<string, string> = {}
  presetIdsByTrack.forEach((id, key) => {
    presets[key] = id
  })
  return { styles, presets }
}

export function setCaptionStyleState(
  state: CaptionStyleState | null | undefined,
): void {
  captionStylesByTrack.clear()
  presetIdsByTrack.clear()
  if (!state) return
  Object.entries(state.styles || {}).forEach(([key, style]) => {
    if (style) captionStylesByTrack.set(key, cloneStyle(style))
  })
  Object.entries(state.presets || {}).forEach(([key, id]) => {
    if (typeof id === "string") presetIdsByTrack.set(key, id)
  })
}

export function resetCaptionStyleState(): void {
  captionStylesByTrack.clear()
  presetIdsByTrack.clear()
  // The base styles are shared objects, so they are restored in place.
  for (const key of Object.keys(captionStyle)) {
    if (!(key in DEFAULT_CAPTION_STYLE)) delete captionStyle[key]
  }
  Object.assign(captionStyle, DEFAULT_CAPTION_STYLE)
  for (const key of Object.keys(transcriptionCaptionStyle)) {
    if (!(key in DEFAULT_TRANSCRIPTION_STYLE))
      delete transcriptionCaptionStyle[key]
  }
  Object.assign(transcriptionCaptionStyle, DEFAULT_TRANSCRIPTION_STYLE)
}

export function cloneCaptionStyleState(
  state: CaptionStyleState,
): CaptionStyleState {
  const styles: Record<string, any> = {}
  Object.entries(state?.styles || {}).forEach(([key, style]) => {
    styles[key] = cloneStyle(style)
  })
  return { styles, presets: { ...(state?.presets || {}) } }
}
