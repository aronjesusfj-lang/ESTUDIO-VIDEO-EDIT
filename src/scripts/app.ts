import { hasBuiltInTranslationSupport } from "@/scripts/builtInSupport.ts";
import { cutRangesFromSegments } from "@/scripts/cuts.ts";
import { createDownloadsController } from "@/scripts/downloads.ts";
import { createProject, createProjectVideo, cloneVideoSnapshot, type Project, type ProjectVideo } from "@/scripts/project.ts";
import { renderProjectRows, setProjectView, bindProjectRowInteractions, updateProjectRowProgress } from "@/scripts/projectStage.ts";
import { getCaptionStyleState, setCaptionStyleState } from "@/scripts/captionStyleStore.ts";
import { exportProjectZip } from "@/scripts/export/zipExport.ts";
import type {
  AppState,
  Editor,
  Segment,
  TrackRole,
  VisibleTrack,
} from "@/scripts/editor.ts";
import type { createVideoExporter } from "@/scripts/export/videoExport.ts";
import { createExportModal } from "@/scripts/export/exportModal.ts";
import { baseFileName, prettifyBytes } from "@/scripts/file.ts";
import { buildSrt } from "@/scripts/subtitles.ts";
import { I18N, langName, tt } from "@/scripts/i18n.ts";
import { createStageManager } from "@/scripts/stageManager.ts";
import { createConfigStageController } from "@/scripts/stages/configStage.ts";
import { createSubtitlePreview } from "@/scripts/stages/subtitlePreview.ts";
import { createUploadStageController } from "@/scripts/stages/uploadStage.ts";
import { createTransformersClient } from "@/scripts/transformersClient.ts";
import type { createTranslationService } from "@/scripts/translation.ts";
import { ui } from "@/scripts/ui.ts";

const {
  downloads,
  renderDownloads,
  updateDownloadStatus,
  makeTransformersTracker,
  fetchWithProgress,
  refreshClearModelsUI,
  clearLocalModels,
} = createDownloadsController({
  ui,
  tt,
  prettifyBytes,
  hasBuiltInTranslationSupport,
});

// ── State ──
let selectedVideoFile: File | null = null
let videoObjectUrl = ""
let exporting = false
// 16 kHz mono audio of the current video, drawn as the timeline waveform.
let waveformAudio: Float32Array | null = null
let project: Project | null = null;
let activeProjectVideo: ProjectVideo | null = null;
let projectCancelled = false;
let projectGlobalStyle = getCaptionStyleState();
let projectVideoSelection = 0;
const state: AppState = {
  detectedLang: "",
  baseSegments: [],
  segmentsByLang: {},
  orderedLangs: [],
  activeLang: "",
  dualTrackMode: false,
  dualTrackLangs: [],
  trackStates: {},
}

const { setStage } = createStageManager({ ui });
const asrTracker = makeTransformersTracker("asr");
const translationTracker = makeTransformersTracker("translation");
const transformersClient = createTransformersClient({
  onProgress(key, payload) {
    if (key === "asr") asrTracker(payload);
    else if (key === "translation") translationTracker(payload);
  },
});

// ── Lazily loaded chunks ──
// The landing page only needs the upload and config stages. The editor and
// the translation service load once the user starts picking a file, and the
// video exporter once there are subtitles to export.
let editor: Editor | null = null;
let editorLoading: Promise<Editor> | null = null;
function loadEditor() {
  editorLoading ??= import("@/scripts/editor.ts")
    .then(({ createEditor }) => {
      editor = createEditor({
        ui,
        tt,
        I18N,
        langName,
        state,
        currentSegments,
        visibleTracks,
        trackRole,
        trackState,
        translateSegments,
        isTranslationReady,
        cutRanges,
        selectedVideoFile: () => selectedVideoFile,
        getWaveformAudio: () => waveformAudio,
        isExporting: () => exporting,
        setStage,
        onExportsEnabled: warmVideoExporter,
        videoEdits: () => activeProjectVideo ? { trim: activeProjectVideo.trim, manualCuts: activeProjectVideo.manualCuts } : undefined,
        updateVideoEdits: (edits) => { if (activeProjectVideo) { activeProjectVideo.trim = edits.trim; activeProjectVideo.manualCuts = edits.manualCuts; } },
        backStage: () => activeProjectVideo && (project?.videos.length || 0) > 1 ? "project" : "config",
        projectVideos: () => project?.videos.map(video => ({id:video.id,name:video.name})) || [],
        activeProjectVideoId: () => activeProjectVideo?.id || null,
        onSelectProjectVideo: (id) => { const video = project?.videos.find(item => item.id === id); if (video) void openProjectVideo(video); },
      });
      if (waveformAudio) editor.setWaveformAudio(waveformAudio);
      return editor;
    })
    .catch((error) => {
      editorLoading = null;
      throw error;
    });
  return editorLoading;
}

type TranslationService = ReturnType<typeof createTranslationService>;
let translationService: TranslationService | null = null;
let translationLoading: Promise<TranslationService> | null = null;
function loadTranslationService() {
  translationLoading ??= import("@/scripts/translation.ts")
    .then(({ createTranslationService }) => {
      translationService = createTranslationService({
        downloads,
        renderDownloads,
        updateDownloadStatus,
        transformersClient,
        tt,
        langName,
        setStatus: configStageController.setStatus,
        translationPreference: () => ui.translationModel?.value || "auto",
      });
      return translationService;
    })
    .catch((error) => {
      translationLoading = null;
      throw error;
    });
  return translationLoading;
}

const translateSegments = async (
  segments: Segment[],
  sourceLang: string,
  targetLang: string,
) =>
  (await loadTranslationService()).translateSegments(
    segments,
    sourceLang,
    targetLang,
  );

const isTranslationReady = () => !!translationService?.isTranslationReady();

type VideoExporter = ReturnType<typeof createVideoExporter>;
let videoExporter: Promise<VideoExporter> | null = null;
function loadVideoExporter() {
  videoExporter ??= import("@/scripts/export/videoExport.ts")
    .then(({ createVideoExporter }) =>
      createVideoExporter(videoExporterOptions()),
    )
    .catch((error) => {
      videoExporter = null;
      throw error;
    });
  return videoExporter;
}
// Warm the exporter up as soon as there's something to export.
function warmVideoExporter(on: boolean) {
  if (on) loadVideoExporter().catch(() => {});
}
async function downloadVideo() {
  const exporter = await loadVideoExporter();
  await exporter.downloadVideo();
}

// ── Tracks ──
function currentSegments(): Segment[] {
  return state.segmentsByLang[state.activeLang] || [];
}

// Words deleted from the transcription are cut from the video.
function cutRanges() {
  return cutRangesFromSegments(state.segmentsByLang[state.detectedLang]);
}

function trackLabel(lang: string) {
  if (state.dualTrackMode && lang === state.detectedLang)
    return tt("tracks.transcription", { lang: langName(lang) });
  if (state.dualTrackMode && state.dualTrackLangs.includes(lang))
    return tt("tracks.subtitles", { lang: langName(lang) });
  return langName(lang);
}

function trackRole(lang: string): TrackRole {
  if (state.dualTrackMode && lang === state.detectedLang) return "transcription";
  if (state.dualTrackMode && state.dualTrackLangs.includes(lang))
    return "subtitles";
  return "default";
}

function visibleTrackLangs() {
  const langs =
    state.dualTrackMode && state.dualTrackLangs.includes(state.activeLang)
      ? state.dualTrackLangs
      : [state.activeLang];
  return langs.filter((lang, index) => lang && langs.indexOf(lang) === index);
}

function trackState(lang: string) {
  return state.trackStates[lang] || {};
}

function visibleTracks(): VisibleTrack[] {
  return visibleTrackLangs()
    .map((lang) => ({
      lang,
      label: trackLabel(lang),
      role: trackRole(lang),
      segments: state.segmentsByLang[lang] || [],
      hidden: !!trackState(lang).hidden,
      locked: !!trackState(lang).locked,
    }))
    .filter((track) => track.segments.length);
}

function currentVideoSegments(): any[] {
  const tracks = visibleTracks().filter((track) => !track.hidden);
  const overlays = state.segmentsByLang["__overlay"] || [];
  if (overlays.length) tracks.push({ lang: "__overlay", label: "Text overlay", role: "overlay", segments: overlays });
  return tracks.length ? tracks : [];
}

function resetEditorState() {
  state.detectedLang = "";
  state.baseSegments = [];
  state.segmentsByLang = {};
  state.orderedLangs = [];
  state.activeLang = "";
  state.dualTrackMode = false;
  state.dualTrackLangs = [];
  state.trackStates = {};
  waveformAudio = null;
  editor?.setWaveformAudio(null);
}

function subtitleSegmentsFromText(text: string, duration: number): Segment[] {
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (!total || !lines.length) return [];
  return lines.map((line, index) => ({ start: total * index / lines.length, end: total * (index + 1) / lines.length, text: line }));
}

function projectTextLanguage(video?: ProjectVideo) {
  const subtitle = ui.projectSubtitleLanguage?.value;
  if (subtitle && subtitle !== "same") return subtitle;
  const selected = ui.projectLanguage?.value;
  return (selected && selected !== "auto" ? selected : "") || (video?.language !== "auto" ? video?.language : "") || state.detectedLang || document.documentElement.lang || "en";
}

// Until the editor chunk is loaded there's nothing on screen to update: it
// renders the current state when it's created.
function enableExports(on: boolean) {
  editor?.enableExports(on);
}

const exportModal = createExportModal({ ui, tt, isExporting: () => exporting });
const { closeExportModal } = exportModal;

const subtitlePreview = createSubtitlePreview({ ui });

const configStageController = createConfigStageController({
  ui,
  tt,
  downloads,
  fetchWithProgress,
  updateDownloadStatus,
  transformersClient,
  translateSegments,
  selectedVideoFile: () => selectedVideoFile,
  isExporting: () => exporting,
  setGeneratedState: (generated) => {
    Object.assign(state, generated, { trackStates: {} });
    if (activeProjectVideo) {
      activeProjectVideo.status = "ready";
      if (activeProjectVideo.text?.trim()) {
        const lang = generated.activeLang || generated.detectedLang || projectTextLanguage(activeProjectVideo);
        const manualSegments = subtitleSegmentsFromText(activeProjectVideo.text, ui.video.duration);
        state.segmentsByLang[lang] = manualSegments;
        state.activeLang = lang;
        state.orderedLangs = Array.from(new Set([...state.orderedLangs, lang]));
        activeProjectVideo.subtitles = manualSegments;
      }
    }
    editor?.enableWordAnimationForAll();
    editor?.syncActiveCaptionStyle();
  },
  setWaveformAudio: (audio) => {
    waveformAudio = audio;
    editor?.setWaveformAudio(audio);
  },
  renderTabs: () => editor?.renderTabs(),
  renderSegments: () => editor?.renderSegments(),
  enableExports,
  resetHistory: () => editor?.resetHistory(),
  updateCaption: () => editor?.updateCaption(),
  setStage,
  prepareEditor: loadEditor,
  onTranscriptPreview: subtitlePreview.setTranscript,
  onGenerationProgress: (progress) => {
    const video = activeProjectVideo;
    if (!video || video.status !== "transcribing" || !project || !ui.projectRows) return;
    video.progress = progress;
    updateProjectRowProgress(ui.projectRows, video.id, progress, video.progressLabel || (locale === "es" ? "Procesando" : "Processing"));
  },
  onGenerationStatus: (message) => {
    const video = activeProjectVideo;
    if (!video || video.status !== "transcribing" || !project || !ui.projectRows) return;
    video.progressLabel = message;
    updateProjectRowProgress(ui.projectRows, video.id, video.progress || 0, message);
  },
});

const uploadStageController = createUploadStageController({
  ui,
  tt,
  setStage,
  setStatus: configStageController.setStatus,
  setProgress: configStageController.setProgress,
  isExporting: () => exporting,
  getVideoObjectUrl: () => videoObjectUrl,
  setVideoObjectUrl: (url) => {
    videoObjectUrl = url;
  },
  setSelectedVideoFile: (file) => {
    selectedVideoFile = file;
  },
  resetEditorState,
  setLangAddStatus: (...args) => editor?.setLangAddStatus(...args),
  populateAddLang: () => editor?.populateAddLang(),
  renderSegments: () => editor?.renderSegments(),
  enableExports,
  resetHistory: () => editor?.resetHistory(),
  startEarlyTranscription: (file) =>
    configStageController.startEarlyTranscription(file),
  resetTranscriptionCache: () =>
    configStageController.resetTranscriptionCache(),
  onBack: () => {
    if (!activeProjectVideo) return false;
    if ((project?.videos.length || 0) < 2) {
      activeProjectVideo = null;
      project = null;
      return false;
    }
    saveActiveProjectSnapshot();
    setStage("project");
    refreshProject();
    return true;
  },
});

const locale = document.documentElement.lang || "en";
function refreshProject() {
  if (!project || !ui.projectRows) return;
  if (ui.projectName) project.name = ui.projectName.value;
  ui.projectStart.disabled = !project.videos.length || project.videos.every((v) => v.status === "ready");
  renderProjectRows(ui.projectRows, project.videos.map(v => ({id:v.id,name:v.name,duration:v.duration,language:v.language,status:v.status,text:v.text,progress:v.progress,progressLabel:v.progressLabel})), locale, ui.projectRows.dataset.view === "grid" ? "grid" : "list");
  const count = document.querySelector("#project-count"); if (count) count.textContent = `${project.videos.length} ${locale === "es" ? "videos" : "videos"}`;
  if (ui.projectStatus) {
    const ready = project.videos.filter(video => video.status === "ready").length;
    const failed = project.videos.filter(video => video.status === "error").length;
    ui.projectStatus.textContent = project.videos.length === 0
      ? (locale === "es" ? "Agrega videos para empezar" : "Add videos to get started")
      : failed > 0
        ? (locale === "es" ? `${ready} listos · ${failed} con error` : `${ready} ready · ${failed} failed`)
        : ready === project.videos.length
          ? (locale === "es" ? `${ready} videos listos` : `${ready} videos ready`)
          : (locale === "es" ? `${ready} de ${project.videos.length} listos` : `${ready} of ${project.videos.length} ready`);
  }
}
function saveActiveProjectSnapshot() {
  if (!activeProjectVideo) return;
  if (!activeProjectVideo.snapshot && !state.orderedLangs.length && !Object.keys(state.segmentsByLang).length) return;
  activeProjectVideo.snapshot = { editor: structuredClone(state), captionStyles: getCaptionStyleState(), edits: editor?.getVideoEdits() || {trim:activeProjectVideo.trim,manualCuts:activeProjectVideo.manualCuts} };
  if (currentSegments().length) {
    activeProjectVideo.text = currentSegments().map(s=>s.text).join("\n");
    activeProjectVideo.subtitles = currentSegments();
  }
}
async function openProjectVideo(video: ProjectVideo) {
  const selection = ++projectVideoSelection;
  saveActiveProjectSnapshot(); activeProjectVideo = video;
  uploadStageController.handleSelectedFile(video.file);
  if (video.file.type.startsWith("video/")) {
    await new Promise<void>(resolve => {
      if (ui.video.readyState >= 1 && ui.video.duration > 0) { resolve(); return; }
      const finish = () => { ui.video.removeEventListener("loadedmetadata", finish); resolve(); };
      ui.video.addEventListener("loadedmetadata", finish, {once:true});
      window.setTimeout(finish, 5000);
    });
    if (selection !== projectVideoSelection) return;
    if (Number.isFinite(ui.video.duration)) video.duration = ui.video.duration;
    if (video.text?.trim() && video.duration > 0) video.subtitles = subtitleSegmentsFromText(video.text, video.duration);
  }
  if (video.snapshot) {
    Object.assign(state, structuredClone(video.snapshot.editor));
    if (video.text?.trim() && video.subtitles?.length) {
      const lang = projectTextLanguage(video);
      state.segmentsByLang[lang] = video.subtitles; state.activeLang = lang; state.detectedLang ||= lang;
      state.orderedLangs = Array.from(new Set([...state.orderedLangs,lang]));
    }
    setCaptionStyleState(video.styleOverride || video.snapshot.captionStyles || projectGlobalStyle);
    video.trim = video.snapshot.edits.trim; video.manualCuts = video.snapshot.edits.manualCuts;
    const loaded = await loadEditor(); loaded.setVideoEdits(video.snapshot.edits); loaded.renderTabs(); loaded.renderSegments(); loaded.updateCaption();
    if (selection !== projectVideoSelection) return;
    loaded.syncProjectVideos();
    setStage("editor");
  } else {
    resetEditorState();
    setCaptionStyleState(video.styleOverride || projectGlobalStyle);
    setStage("config");
  }
  refreshProject();
}
bindProjectRowInteractions(ui.projectRows, {
  onText(id, text) {
    const v = project?.videos.find(x=>x.id===id); if (!v) return;
    v.text = text;
    const duration = v.duration || (activeProjectVideo?.id === id ? ui.video.duration : 0);
    const lang = projectTextLanguage(v);
    v.subtitles = subtitleSegmentsFromText(text, duration);
    if (activeProjectVideo?.id === id) {
      state.segmentsByLang[lang] = v.subtitles; state.activeLang = lang; state.detectedLang ||= lang; state.orderedLangs = Array.from(new Set([...state.orderedLangs,lang])); editor?.renderTabs(); editor?.renderSegments(); editor?.updateCaption();
      v.snapshot = { editor: structuredClone(state), captionStyles: getCaptionStyleState(), edits: {trim:v.trim,manualCuts:v.manualCuts} };
    } else {
      const editorState = v.snapshot?.editor || {detectedLang:lang,baseSegments:v.subtitles,segmentsByLang:{},orderedLangs:[],activeLang:lang,dualTrackMode:false,dualTrackLangs:[],trackStates:{}};
      editorState.segmentsByLang[lang] = v.subtitles; editorState.activeLang = lang; editorState.detectedLang ||= lang; editorState.orderedLangs = Array.from(new Set([...editorState.orderedLangs,lang]));
      v.snapshot = {editor:editorState,captionStyles:v.styleOverride || v.snapshot?.captionStyles || projectGlobalStyle,edits:v.snapshot?.edits || {trim:v.trim,manualCuts:v.manualCuts}};
    }
    if (v.subtitles.length) {
      v.status = "ready";
      const row = ui.projectRows?.querySelector<HTMLElement>(`[data-video-id="${CSS.escape(v.id)}"]`);
      const status = row?.querySelector<HTMLElement>(".project-row-status");
      if (status) { status.dataset.status = "ready"; status.textContent = locale === "es" ? "Listo" : "Ready"; }
      if (ui.projectStart) ui.projectStart.disabled = project?.videos.every(item => item.status === "ready") ?? true;
    }
  },
  onEdit(id) { const v = project?.videos.find(x=>x.id===id); if (v) void openProjectVideo(v); },
  onRemove(id) { if (!project) return; project.videos = project.videos.filter(x=>x.id!==id); refreshProject(); },
  onStyle(id) { const v = project?.videos.find(x=>x.id===id); if (v) { saveActiveProjectSnapshot(); v.styleOverride = getCaptionStyleState(); if (v.snapshot) v.snapshot.captionStyles = structuredClone(v.styleOverride); } },
});
ui.projectStyleGlobal?.addEventListener("click", () => { saveActiveProjectSnapshot(); projectGlobalStyle = getCaptionStyleState(); });
ui.projectAdd?.addEventListener("click", () => ui.projectAddInput.click());
ui.multiUploadButton?.addEventListener("click", () => ui.projectAddInput.click());
ui.projectAddInput?.addEventListener("change", () => {
  const files = Array.from(ui.projectAddInput.files || []); if (!files.length) return;
  project ||= createProject(ui.projectName?.value || "");
  project.videos.push(...files.map(createProjectVideo));
  ui.projectAddInput.value = ""; refreshProject(); setStage(project.videos.length >= 2 ? "project" : "config");
  if (project.videos.length === 1) void openProjectVideo(project.videos[0]);
});
document.querySelectorAll<HTMLElement>("[data-project-view]").forEach(button => button.addEventListener("click", () => { if (ui.projectRows) {setProjectView(ui.projectRows, button.dataset.projectView === "grid" ? "grid" : "list"); refreshProject();} }));
ui.projectName?.addEventListener("input", refreshProject);
ui.projectStart?.addEventListener("click", async () => {
  if (!project) return; projectCancelled = false; ui.projectCancel.hidden = false;
  for (const video of project.videos) {
    if (projectCancelled) break; if (video.status === "ready") continue;
    video.status = "transcribing"; video.progress = 0; video.progressLabel = locale === "es" ? "Preparando" : "Preparing"; activeProjectVideo = video; refreshProject();
    uploadStageController.handleSelectedFile(video.file);
    if (video.file.type.startsWith("video/")) {
      await new Promise<void>(resolve => {
        if (ui.video.readyState >= 1 && ui.video.duration > 0) { resolve(); return; }
        const finish = () => { ui.video.removeEventListener("loadedmetadata", finish); resolve(); };
        ui.video.addEventListener("loadedmetadata", finish, {once:true});
        window.setTimeout(finish, 5000);
      });
      if (Number.isFinite(ui.video.duration)) video.duration = ui.video.duration;
      refreshProject();
    }
    const projectLang = ui.projectLanguage?.value || video.language;
    ui.inputLang.value = projectLang === "auto" ? "" : projectLang;
    ui.outputLang.value = ui.projectSubtitleLanguage?.value || "same";
    ui.asrModel.value = ui.projectModel?.value || "balanced";
    const generated = await configStageController.generate({navigate:false});
    if (!generated) { video.status = "error"; video.progress = 0; video.progressLabel = locale === "es" ? "Error al procesar" : "Processing failed"; }
    else { saveActiveProjectSnapshot(); video.progress = 100; video.progressLabel = locale === "es" ? "Listo" : "Ready"; }
    refreshProject();
  }
  if (projectCancelled) {
    const current = activeProjectVideo;
    if (current?.status === "transcribing") { current.status = "cancelled"; current.progressLabel = locale === "es" ? "Cancelado" : "Cancelled"; }
  }
  ui.projectCancel.hidden = true; setStage("project"); refreshProject();
});
ui.projectCancel?.addEventListener("click", () => { projectCancelled = true; });
ui.projectExport?.addEventListener("click", async () => {
  if (!project) return;
  saveActiveProjectSnapshot();
  const ready = project.videos.filter(v => v.snapshot);
  const includeVideo = ui.projectOutput?.value === "video";
  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const renderVideo = async (video: ProjectVideo) => {
    await openProjectVideo(video);
    const exporter = await loadVideoExporter();
    return exporter.exportToBlob();
  };
  const items = ready.map(video => ({
    name: video.name,
    srt: buildSrt(video.subtitles || []),
    ...(includeVideo ? {renderVideo: () => renderVideo(video)} : {}),
  }));
  if (!ui.projectZip?.checked) {
    for (const video of ready) {
      triggerDownload(new Blob([buildSrt(video.subtitles || [])], {type:"text/plain;charset=utf-8"}), `${baseFileName(video.file)}.srt`);
      if (includeVideo) { const rendered = await renderVideo(video); if (rendered) triggerDownload(rendered, `${baseFileName(video.file)}.mp4`); }
    }
    setStage("project");
    return;
  }
  const blob = await exportProjectZip({
    items,
    manifest:{version:1,videos:project.videos.map(v=>({file:v.name,trim:v.trim,manualCuts:v.manualCuts,styleOverride:v.styleOverride}))},
    includeVideo,
    onMemoryFallback: async () => {
      for (const video of ready) {
        triggerDownload(new Blob([buildSrt(video.subtitles || [])], {type:"text/plain;charset=utf-8"}), `${baseFileName(video.file)}.srt`);
        if (includeVideo) { const rendered = await renderVideo(video); if (rendered) triggerDownload(rendered, `${baseFileName(video.file)}.mp4`); }
      }
    },
  });
  if (blob) triggerDownload(blob, `${baseFileName(new File([], project.name))}.zip`);
  setStage("project");
});

const videoExporterOptions = (): Parameters<typeof createVideoExporter>[0] => ({
  ui,
  tt,
  currentSegments: currentVideoSegments,
  cutRanges,
  selectedVideoFile: () => selectedVideoFile,
  activeLang: () => state.activeLang,
  baseFileName: () => baseFileName(selectedVideoFile),
  isExporting: () => exporting,
  setExporting: (value) => {
    exporting = value;
  },
  enableExports,
  setStatus: configStageController.setStatus,
  modal: exportModal,
  remuxAudioToAacLc: configStageController.remuxAudioToAacLc,
});

// ── Init ──
renderDownloads();
configStageController.schedulePreload();
setStage("upload");
uploadStageController.wireUploadStage();
configStageController.wireConfigStage();
subtitlePreview.wire();
ui.downloadVideoBtn.addEventListener("click", downloadVideo);
ui.exportClose.addEventListener("click", closeExportModal);
ui.exportBackdrop.addEventListener("click", closeExportModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !ui.exportModal.hidden) closeExportModal();
});
ui.downloadsToggle.addEventListener("click", () => {
  const opening = ui.downloadsPanel.hidden;
  ui.downloadsPanel.hidden = !opening;
  // The panel header already shows the status, so drop the dock label while open.
  ui.statusDock?.classList.toggle("panel-open", opening);
  if (opening) {
    renderDownloads();
    refreshClearModelsUI();
  }
});
ui.clearModelsBtn?.addEventListener("click", clearLocalModels);
