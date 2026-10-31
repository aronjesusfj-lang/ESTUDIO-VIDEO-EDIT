// Everything that only matters once there are subtitles to edit: timeline,
// caption styling, transcript editor, undo history and the editor toolbar. It
// ships as its own chunk and loads when the user starts picking a file.
import type { TimeRange } from "@/scripts/cuts.ts";
import { DEFAULT_TRIM, effectiveCuts, normalizeEdits, type VideoEdits } from "@/scripts/edits.ts";
import { createEditorHistory } from "@/scripts/editorHistory.ts";
import { createEditorSegmentsController } from "@/scripts/editorSegments.ts";
import type { Stage } from "@/scripts/stageManager.ts";
import { createEditorStageController } from "@/scripts/stages/editorStage.ts";
import { createSubtitleStyleController } from "@/scripts/subtitleStyle.ts";
import type { SubtitleSegment } from "@/scripts/subtitles.ts";
import { createTimelineController } from "@/scripts/timeline.ts";
import { createTranscriptEditor } from "@/scripts/transcriptEditor.ts";
import type { ui as appUi } from "@/scripts/ui.ts";
import { computeWaveform } from "@/scripts/waveform.ts";
import { alignSegmentsToSpeech } from "@/scripts/silenceAlignment.ts";

export type Segment = SubtitleSegment;
export type SegmentsByLang = Record<string, Segment[]>;
export type TrackState = { hidden?: boolean; locked?: boolean };
export type TrackRole = "default" | "transcription" | "subtitles";
export type VisibleTrack = {
  lang: string;
  label: string;
  role: TrackRole;
  segments: Segment[];
  hidden?: boolean;
  locked?: boolean;
};

// Mutable app state shared by the main bundle and the editor.
export type AppState = {
  detectedLang: string;
  baseSegments: Segment[];
  segmentsByLang: SegmentsByLang;
  orderedLangs: string[];
  activeLang: string;
  dualTrackMode: boolean;
  dualTrackLangs: string[];
  trackStates: Record<string, TrackState>;
};

type EditorContext = {
  ui: typeof appUi;
  tt: (path: string, vars?: Record<string, unknown>) => string;
  I18N: any;
  langName: (code: string) => string;
  state: AppState;
  currentSegments: () => Segment[];
  visibleTracks: () => VisibleTrack[];
  trackRole: (lang: string) => TrackRole;
  trackState: (lang: string) => TrackState;
  translateSegments: (
    segments: Segment[],
    sourceLang: string,
    targetLang: string,
  ) => Promise<Segment[]>;
  isTranslationReady: () => boolean;
  cutRanges: () => TimeRange[];
  selectedVideoFile: () => File | null;
  getWaveformAudio: () => Float32Array | null;
  isExporting: () => boolean;
  setStage: (stage: Stage) => void;
  onExportsEnabled: (on: boolean) => void;
  videoEdits?: () => VideoEdits;
  updateVideoEdits?: (edits: VideoEdits) => void;
  backStage?: () => Stage;
  projectVideos?: () => Array<{id:string;name:string}>;
  activeProjectVideoId?: () => string | null;
  onSelectProjectVideo?: (id:string) => void;
};

export function createEditor(ctx: EditorContext) {
  const { ui, tt, state, trackRole, trackState } = ctx;

  function syncActiveCaptionStyle() {
    subtitleStyleController.setActiveTrack(
      trackRole(state.activeLang),
      state.activeLang,
    );
  }

  function enableWordAnimationForAll() {
    if (!ui.wordAnimation.checked) return;
    subtitleStyleController.setWordHighlightForAll(true);
  }

  function enableExports(on: boolean) {
    editorStageController.enableExports(on);
    ctx.onExportsEnabled(on);
  }

  const snapshotSegments = () => historyController.snapshotSegments();
  const pushHistory = (snapshotBefore: string) =>
    historyController.pushHistory(snapshotBefore);

  // Cut ranges are read on every playback frame: cache them per edit.
  let cuts: TimeRange[] = [];
  let edits: VideoEdits = ctx.videoEdits?.() || { trim: { ...DEFAULT_TRIM }, manualCuts: [] };
  const refreshCuts = () => {
    edits = ctx.videoEdits?.() || edits;
    const duration = Number.isFinite(ui.video.duration) ? ui.video.duration : 0;
    cuts = ctx.videoEdits
      ? effectiveCuts(edits, ctx.cutRanges(), duration)
      : ctx.cutRanges();
  };

  function undo() {
    transcript.commitPendingEdit();
    historyController.undo();
  }

  function redo() {
    transcript.commitPendingEdit();
    historyController.redo();
  }

  let timelineTimer = 0;
  function scheduleTimelineRender() {
    window.clearTimeout(timelineTimer);
    timelineTimer = window.setTimeout(renderTimeline, 250);
  }

  function toggleTrack(lang: string, key: "hidden" | "locked") {
    const before = snapshotSegments();
    state.trackStates[lang] = {
      ...trackState(lang),
      [key]: !trackState(lang)[key],
    };
    pushHistory(before);
    renderTimeline();
    updateCaption();
  }

  const subtitleStyleController = createSubtitleStyleController({
    ui,
    I18N: ctx.I18N,
    langName: ctx.langName,
    onSelectTrack: (lang) => editorSegmentsController.selectLang(lang),
  });

  let editorSegmentsController: ReturnType<
    typeof createEditorSegmentsController
  >;
  const { renderTimeline, updateCaption, setWaveform } =
    createTimelineController({
      ui,
      tt,
      currentSegments: ctx.currentSegments,
      visibleTracks: ctx.visibleTracks,
      textOverlays: () => state.segmentsByLang["__overlay"] || [],
      activeLang: () => state.activeLang,
      setActiveLang: (lang) => {
        state.activeLang = lang;
        syncActiveCaptionStyle();
      },
      renderTabs: () => {
        editorSegmentsController.renderTabs();
        // Picking a block on another track switches the transcript too.
        if (transcript.renderedLang() !== state.activeLang) renderSegments();
      },
      renderCaptions: (tracks, time) =>
        subtitleStyleController.renderCaptions(tracks, time),
      toggleTrackHidden: (lang) => toggleTrack(lang, "hidden"),
      toggleTrackLocked: (lang) => toggleTrack(lang, "locked"),
      snapshotSegments,
      pushHistory,
      renderSegments: () => editorSegmentsController.renderSegments(),
      enableExports,
      cutRanges: () => cuts,
      videoEdits: () => edits,
      updateVideoEdits: (next) => {
        const before = snapshotSegments();
        edits = next;
        ctx.updateVideoEdits?.(edits);
        pushHistory(before);
        refreshCuts();
      },
      onActiveSegment: (index, lang, scroll) =>
        transcript.setActiveLine(index, lang, scroll),
      onPlaybackTime: (time) => transcript.highlightTime(time),
    });

  const transcript = createTranscriptEditor({
    root: ui.transcript,
    tt,
    segmentsFor: (lang) => state.segmentsByLang[lang] || [],
    activeLang: () => state.activeLang,
    sourceLang: () => state.detectedLang,
    cutRanges: () => cuts,
    snapshotSegments,
    pushHistory,
    undo,
    redo,
    seek: (time) => {
      ui.video.currentTime = Math.max(0, time + 0.001);
      updateCaption();
    },
    onTextChange: () => {
      updateCaption();
      scheduleTimelineRender();
    },
    onStructureChange: () => {
      refreshCuts();
      editorSegmentsController.renderTranscriptMeta();
      renderTimeline();
      enableExports(true);
      updateCaption();
    },
  });

  editorSegmentsController = createEditorSegmentsController({
    ui,
    tt,
    langName: ctx.langName,
    getState: () => state,
    setActiveLang: (lang) => {
      state.activeLang = lang;
      syncActiveCaptionStyle();
    },
    setOrderedLangs: (langs) => {
      state.orderedLangs = langs;
    },
    setSegmentsForLang: (lang, segments) => {
      state.segmentsByLang[lang] = segments;
      if (ui.wordAnimation.checked)
        subtitleStyleController.setWordHighlightForAll(true);
    },
    removeSegmentsForLang: (lang) => {
      delete state.segmentsByLang[lang];
    },
    showDualTrack: (existing, added) => {
      const existingRole = trackRole(existing);
      state.dualTrackMode = true;
      state.dualTrackLangs =
        added === state.detectedLang ? [added, existing] : [existing, added];
      // The language already on screen stays the main subtitle and keeps its
      // look; the added one goes under it, a bit smaller.
      subtitleStyleController.stackSecondaryTrack(
        { role: existingRole, lang: existing },
        { role: trackRole(existing), lang: existing },
        { role: trackRole(added), lang: added },
      );
    },
    hideDualTrack: (remaining) => {
      if (!state.dualTrackMode) return;
      // The language left on screen takes the look of the main subtitle: the
      // one the other was stacked under or, as generated, the translation.
      const candidates = state.dualTrackLangs.filter(
        (lang) => !subtitleStyleController.isSecondaryTrack(trackRole(lang), lang),
      );
      const main =
        candidates.find((lang) => trackRole(lang) === "subtitles") ||
        candidates[0];
      if (main)
        subtitleStyleController.inheritTrackStyle(
          { role: trackRole(main), lang: main },
          { role: "default", lang: remaining },
        );
      state.dualTrackMode = false;
      state.dualTrackLangs = [];
    },
    translateSegments: ctx.translateSegments,
    isTranslationReady: ctx.isTranslationReady,
    snapshotSegments,
    pushHistory,
    transcript,
    cutRanges: () => cuts,
    renderTimeline,
    updateCaption,
    enableExports,
  });
  const { addLanguage, populateAddLang, renderTabs, setLangAddStatus } =
    editorSegmentsController;

  // Every full redraw follows a state change (generation, undo, new track),
  // so it's also where the cut ranges catch up.
  function renderSegments() {
    refreshCuts();
    editorSegmentsController.renderSegments();
  }

  const editorStageController = createEditorStageController({
    ui,
    currentSegments: ctx.currentSegments,
    cutRanges: () => cuts,
    selectedVideoFile: ctx.selectedVideoFile,
    activeLang: () => state.activeLang,
    isExporting: ctx.isExporting,
    setStage: ctx.setStage,
    backStage: ctx.backStage,
    projectVideos: ctx.projectVideos,
    activeProjectVideoId: ctx.activeProjectVideoId,
    onSelectProjectVideo: ctx.onSelectProjectVideo,
    undo,
    redo,
  });

  const historyController = createEditorHistory<SegmentsByLang>({
    getState: () => ({
      segmentsByLang: state.segmentsByLang,
      orderedLangs: state.orderedLangs,
      activeLang: state.activeLang,
      dualTrackMode: state.dualTrackMode,
      dualTrackLangs: state.dualTrackLangs,
      trackStates: state.trackStates,
      videoEdits: edits,
    }),
    restoreState: (snapshot) => {
      state.segmentsByLang = snapshot.segmentsByLang || {};
      state.orderedLangs =
        snapshot.orderedLangs || Object.keys(state.segmentsByLang);
      state.activeLang = snapshot.activeLang || state.orderedLangs[0] || "";
      if (!state.segmentsByLang[state.activeLang])
        state.activeLang =
          state.orderedLangs[0] || Object.keys(state.segmentsByLang)[0] || "";
      state.dualTrackMode = !!snapshot.dualTrackMode;
      state.dualTrackLangs = snapshot.dualTrackLangs || [];
      state.trackStates = snapshot.trackStates || {};
      edits = snapshot.videoEdits || { trim: { ...DEFAULT_TRIM }, manualCuts: [] };
      ctx.updateVideoEdits?.(edits);
    },
    refreshButtons: (canUndo, canRedo) => {
      if (ui.undoBtn) ui.undoBtn.disabled = !canUndo;
      if (ui.redoBtn) ui.redoBtn.disabled = !canRedo;
    },
    onRestore: () => {
      syncActiveCaptionStyle();
      renderTabs();
      renderSegments();
      enableExports(true);
      updateCaption();
    },
  });

  subtitleStyleController.renderPresets();
  subtitleStyleController.syncStyleControls();
  subtitleStyleController.applyCaptionStyle();
  subtitleStyleController.wireStyleControls();
  editorStageController.wireEditorStage();
  ui.addSubtitleBtn?.addEventListener("click", () => {
    if (!state.activeLang) return;
    const text = window.prompt("Text for the new subtitle:");
    if (!text?.trim()) return;
    const before = snapshotSegments();
    const start = Math.max(0, ui.video.currentTime || 0);
    const segment: Segment = { start, end: start + 3, text: text.trim() };
    const segments = state.segmentsByLang[state.activeLang] || (state.segmentsByLang[state.activeLang] = []);
    segments.push(segment);
    segments.sort((a, b) => a.start - b.start);
    pushHistory(before);
    renderSegments();
    renderTimeline();
    enableExports(true);
    updateCaption();
  });
  ui.addTextOverlayBtn?.addEventListener("click", () => {
    const text = window.prompt("Text to show over the video:")?.trim();
    if (!text) return;
    const durationInput = window.prompt("Duration in seconds:", "3");
    const duration = Number(durationInput);
    if (!Number.isFinite(duration) || duration <= 0) return;
    const before = snapshotSegments();
    const start = Math.max(0, ui.video.currentTime || 0);
    const overlays = state.segmentsByLang["__overlay"] || (state.segmentsByLang["__overlay"] = []);
    overlays.push({ start, end: start + duration, text });
    pushHistory(before);
    updateCaption();
    enableExports(true);
  });
  ui.alignSilenceBtn?.addEventListener("click", () => {
    const audio = ctx.getWaveformAudio();
    const segments = state.segmentsByLang[state.activeLang] || [];
    if (!audio || !segments.length) return;
    const before = snapshotSegments();
    const aligned = alignSegmentsToSpeech(segments, audio);
    const changed = aligned.some((segment, index) =>
      segment.start !== segments[index].start || segment.end !== segments[index].end,
    );
    if (!changed) return;
    state.segmentsByLang[state.activeLang] = aligned;
    pushHistory(before);
    renderSegments();
    renderTimeline();
    updateCaption();
  });
  ui.langAddSelect?.addEventListener("change", () => {
    const target = ui.langAddSelect.value;
    if (target) addLanguage(target);
  });
  // Catch up with anything that happened before this chunk loaded.
  populateAddLang();
  renderSegments();

  return {
    enableExports,
    enableWordAnimationForAll,
    populateAddLang,
    renderSegments,
    renderTabs,
    resetHistory: () => historyController.resetHistory(),
    getVideoEdits: () => edits,
    setVideoEdits: (next: VideoEdits) => {
      const duration = Number.isFinite(ui.video.duration) ? ui.video.duration : 0;
      edits = normalizeEdits(next, duration);
      ctx.updateVideoEdits?.(edits);
      refreshCuts();
      renderTimeline();
      updateCaption();
    },
    setLangAddStatus,
    setWaveformAudio: (audio: Float32Array | null, sampleRate = 16_000) => {
      if (ui.alignSilenceBtn) ui.alignSilenceBtn.disabled = !audio?.length;
      setWaveform(audio?.length ? computeWaveform(audio, sampleRate) : null);
    },
    syncActiveCaptionStyle,
    syncProjectVideos: editorStageController.syncProjectVideos,
    updateCaption,
  };
}

export type Editor = ReturnType<typeof createEditor>;
