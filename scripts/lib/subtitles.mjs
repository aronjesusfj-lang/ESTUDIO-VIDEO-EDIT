export function formatSrtTime(seconds) {
  const ms = Math.max(0, Math.round((Number(seconds) || 0) * 1000))
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
}

export function toSrt(chunks) {
  return chunks.map((chunk, index) => `${index + 1}\n${formatSrtTime(chunk.timestamp?.[0] ?? chunk.start)} --> ${formatSrtTime(chunk.timestamp?.[1] ?? chunk.end)}\n${String(chunk.text || '').trim()}`).join('\n\n') + (chunks.length ? '\n' : '')
}

export function escapeAss(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\N')
}

export function toAss(chunks, style = {}) {
  const color = String(style.color || '#FFFFFF').replace('#', '')
  const outline = String(style.outlineColor || '#000000').replace('#', '')
  const alphaColor = (hex) => `&H00${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`
  const size = Math.max(12, Math.min(96, Number(style.fontSize) || 42))
  const font = String(style.fontFamily || 'Arial').replace(/[{},\n]/g, '')
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${font},${size},${alphaColor(color)},&H000000FF,${alphaColor(outline)},&H80000000,0,0,1,${Number(style.outlineWidth) || 2},0,2,60,60,${Number(style.marginV) || 50},1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`
  const stamp = (seconds) => {
    const cs = Math.max(0, Math.round(seconds * 100))
    return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
  }
  return header + chunks.map((chunk) => `Dialogue: 0,${stamp(chunk.start)},${stamp(chunk.end)},Default,,0,0,0,,${escapeAss(chunk.text)}`).join('\n') + '\n'
}
