import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** Load the app/CLI shared project manifest (v1). */
export async function loadManifest(file) {
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  if (manifest.version !== 1 || !Array.isArray(manifest.videos)) {
    throw new Error('Manifest must use version 1 and contain a videos array')
  }
  return { ...manifest, videos: manifest.videos.map((video, index) => {
    if (!video || typeof video.file !== 'string' || !video.file.trim()) throw new Error(`videos[${index}].file is required`)
    return { ...video, cuts: video.manualCuts ?? video.cuts ?? [], style: video.styleOverride ?? video.style, file: path.resolve(path.dirname(file), video.file) }
  }) }
}
