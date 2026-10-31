export type ProjectRow = {
  id: string
  name: string
  duration?: number
  language?: string
  status?: string
  progress?: number
  progressLabel?: string
  text?: string
}

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!)

function formatDuration(seconds = 0) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—"
  const mins = Math.floor(seconds / 60)
  return `${mins}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
}

/** Paints the production list while keeping all user supplied text escaped. */
export function renderProjectRows(
  container: HTMLElement,
  videos: ProjectRow[],
  locale = "en",
  view: "list" | "grid" = "list",
) {
  container.dataset.view = view
  container.innerHTML = videos.map((video, index) => `
    <article class="project-row" data-video-id="${escapeHtml(video.id)}">
      <button class="project-row-main" type="button" data-project-expand="${escapeHtml(video.id)}" aria-expanded="false">
        <span class="project-row-index">${String(index + 1).padStart(2, "0")}</span>
        <span class="project-file-icon">▶</span>
        <span class="project-file-name">${escapeHtml(video.name)}</span>
        <span class="project-row-lang">${escapeHtml(video.language || (locale === "es" ? "Auto" : "Auto"))}</span>
        <span class="project-row-duration">${formatDuration(video.duration)}</span>
        <span class="project-row-status" data-status="${escapeHtml(video.status || "ready")}">${escapeHtml(video.progressLabel || statusLabel(video.status || "ready", locale))}</span>
      </button>
      <div class="project-row-progress" ${video.status === "transcribing" ? "" : "hidden"}>
        <span class="project-row-progress-fill" style="width:${Math.max(0, Math.min(100, video.progress || 0))}%"></span>
      </div>
      <div class="project-row-details" hidden>
        <label>${locale === "es" ? "Texto para este video" : "Text for this video"}
          <textarea data-project-text="${escapeHtml(video.id)}" rows="3" placeholder="${locale === "es" ? "Escribe o genera subtítulos para este video…" : "Write or generate subtitles for this video…"}">${escapeHtml(video.text || "")}</textarea>
        </label>
        <div class="project-row-tools">
          <button type="button" data-project-edit="${escapeHtml(video.id)}">${locale === "es" ? "Abrir editor" : "Open editor"}</button>
          <button type="button" data-project-style="${escapeHtml(video.id)}">${locale === "es" ? "Guardar estilo actual para este video" : "Save current style for this video"}</button>
          <button type="button" data-project-remove="${escapeHtml(video.id)}">${locale === "es" ? "Quitar" : "Remove"}</button>
        </div>
      </div>
    </article>`).join("")
}

function statusLabel(status: string, locale: string) {
  const labels: Record<string, [string, string]> = {
    queued: ["En cola", "Queued"], transcribing: ["Preparando", "Preparing"],
    ready: ["Listo", "Ready"], error: ["Error", "Error"], cancelled: ["Cancelado", "Cancelled"],
  }
  return labels[status]?.[locale === "es" ? 0 : 1] || status
}

export function updateProjectRowProgress(container: HTMLElement, id: string, progress: number, label: string, status = "transcribing") {
  const row = container.querySelector<HTMLElement>(`[data-video-id="${CSS.escape(id)}"]`)
  if (!row) return
  const statusElement = row.querySelector<HTMLElement>(".project-row-status")
  if (statusElement) {
    statusElement.dataset.status = status
    statusElement.textContent = label
  }
  const fill = row.querySelector<HTMLElement>(".project-row-progress-fill")
  const track = row.querySelector<HTMLElement>(".project-row-progress")
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, progress))}%`
  if (track) track.hidden = status !== "transcribing"
}

export function setProjectView(container: HTMLElement, view: "list" | "grid") {
  container.dataset.view = view
  document.querySelectorAll<HTMLElement>("[data-project-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.projectView === view)
  })
}

export function bindProjectRowInteractions(
  container: HTMLElement,
  handlers: {
    onText?: (id: string, text: string) => void
    onEdit?: (id: string) => void
    onRemove?: (id: string) => void
    onStyle?: (id: string) => void
  } = {},
) {
  container.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-project-expand], [data-project-edit], [data-project-remove], [data-project-style]")
    if (!target) return
    const id = target.dataset.projectExpand || target.dataset.projectEdit || target.dataset.projectRemove || target.dataset.projectStyle || ""
    if (target.hasAttribute("data-project-expand")) {
      const details = target.closest(".project-row")?.querySelector<HTMLElement>(".project-row-details")
      if (details) details.hidden = !details.hidden
      target.setAttribute("aria-expanded", String(details ? !details.hidden : false))
    } else if (target.hasAttribute("data-project-edit")) handlers.onEdit?.(id)
    else if (target.hasAttribute("data-project-style")) handlers.onStyle?.(id)
    else handlers.onRemove?.(id)
  })
  container.addEventListener("input", (event) => {
    const target = event.target as HTMLTextAreaElement
    if (target.matches("[data-project-text]")) handlers.onText?.(target.dataset.projectText || "", target.value)
  })
}
