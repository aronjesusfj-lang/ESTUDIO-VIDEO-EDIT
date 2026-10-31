import { createStoreZip, type ZipEntry } from "@/scripts/export/zipStore.ts"

export type ProjectExportItem = {
  name: string
  srt: string
  renderVideo?: () => Promise<Blob | null>
}

export type ProjectZipOptions = {
  items: ProjectExportItem[]
  manifest: unknown
  includeVideo: boolean
  /** Called if the conservative estimated total exceeds the configured ceiling. */
  onMemoryFallback: () => Promise<void> | void
  maxBytes?: number
}

/** Build project ZIP with store-only entries; video rendering remains caller-owned. */
export async function exportProjectZip(options: ProjectZipOptions) {
  const maxBytes = options.maxBytes ?? 1_200_000_000
  const manifest = JSON.stringify(options.manifest, null, 2)
  let accumulatedBytes = new Blob([manifest]).size + options.items.reduce((n, item) => n + new Blob([item.srt]).size, 0)
  if (accumulatedBytes > maxBytes) {
    await options.onMemoryFallback()
    return null
  }
  const entries: ZipEntry[] = [{ name: "manifest.json", data: manifest }]
  for (const [index, item] of options.items.entries()) {
    const base = item.name.replace(/\\/g, "/").split("/").pop()?.replace(/\.[^.]*$/, "") || `video-${index + 1}`
    entries.push({ name: `${base}.srt`, data: item.srt })
    if (!options.includeVideo || !item.renderVideo) continue
    const video = await item.renderVideo()
    if (!video) {
      await options.onMemoryFallback()
      return null
    }
    if (accumulatedBytes + video.size > maxBytes) {
      await options.onMemoryFallback()
      return null
    }
    entries.push({ name: `${base}.mp4`, data: video })
    accumulatedBytes += video.size
  }
  return createStoreZip(entries)
}
