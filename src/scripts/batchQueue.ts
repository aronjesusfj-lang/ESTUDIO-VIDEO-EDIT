import type { ui as appUi } from "@/scripts/ui.ts"

type QueueItem = { file: File; status: "queued" | "processing" | "done" | "error"; error?: string; review?: string[] }
type BatchQueueOptions = { ui: typeof appUi; processFile: (file: File) => Promise<string[] | void> }

export function createBatchQueue({ ui, processFile }: BatchQueueOptions) {
  const items: QueueItem[] = []
  let cancelled = false
  let busy = false
  try {
    const template = JSON.parse(localStorage.getItem("subvid.batch-template.v1") || "null")
    if (template?.model) ui.batchModel.value = template.model
    if (template?.translationModel) ui.batchTranslationModel.value = template.translationModel
    if (template?.language) ui.batchLanguage.value = template.language
    if (template?.output) ui.batchOutput.value = template.output
    if (template?.format) ui.batchFormat.value = template.format
    if (template?.normalizeAudio) ui.batchNormalizeAudio.checked = true
  } catch { /* Ignore invalid local preferences. */ }

  function render() {
    ui.batchQueue.hidden = items.length === 0
    ui.batchItems.replaceChildren(...items.map((item, index) => {
      const row = document.createElement("div")
      row.className = "batch-item"
      const name = document.createElement("span")
      name.className = "batch-item-name"
      name.textContent = item.file.name
      const status = document.createElement("span")
      status.className = `batch-item-status is-${item.status}`
      status.textContent = item.status === "error" ? item.error || "Failed" : item.status === "done" && item.review?.length ? `done · ${item.review.length} review notes` : item.status
      if (item.review?.length) status.title = item.review.join("\n")
      row.append(name, status)
      if (item.status === "error") {
        const retry = document.createElement("button")
        retry.type = "button"
        retry.className = "btn-ghost"
        retry.textContent = "Retry"
        retry.addEventListener("click", () => void run([index]))
        row.append(retry)
      }
      return row
    }))
    ui.batchStart.disabled = busy || !items.some((item) => item.status === "queued")
    ui.batchCancel.hidden = !busy
  }

  async function run(indices = items.map((_, index) => index).filter((index) => items[index].status === "queued")) {
    if (busy) return
    busy = true
    cancelled = false
    render()
    const selected = indices.filter((index) => items[index] && items[index].status !== "done")
    for (let at = 0; at < selected.length; at += 1) {
      if (cancelled) break
      const index = selected[at]
      const item = items[index]
      item.status = "processing"
      item.error = undefined
      ui.batchProgress.textContent = `${at + 1}/${selected.length}`
      render()
      try {
        item.review = await processFile(item.file) || []
        item.status = "done"
      } catch (error) {
        item.status = "error"
        item.error = error instanceof Error ? error.message : String(error)
      }
      render()
    }
    busy = false
    ui.batchProgress.textContent = cancelled ? "Cancelled" : ""
    render()
  }

  ui.batchInput.addEventListener("change", () => {
    for (const file of Array.from(ui.batchInput.files || [])) {
      if (!items.some((item) => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified))
        items.push({ file, status: "queued" })
    }
    ui.batchInput.value = ""
    render()
  })
  ui.batchStart.addEventListener("click", () => void run())
  ui.batchCancel.addEventListener("click", () => { cancelled = true })
  render()
  return { render, run, items }
}
