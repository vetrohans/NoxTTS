import { App, ItemView, WorkspaceLeaf } from "obsidian";
import { PlaybackInfo, PlaybackState } from "./audio-player";

export const VIEW_TYPE_NOXTTS_CONTROL = "nox-tts-control-view";

/**
 * Sidebar control panel view for NoxTTS.
 * Shows playback controls, progress, and synthesis status.
 */
export class NoxTTSControlView extends ItemView {
  private progressBar: HTMLInputElement | null = null;
  private currentTimeEl: HTMLElement | null = null;
  private durationEl: HTMLElement | null = null;
  private speedEl: HTMLElement | null = null;
  private noteTitleEl: HTMLElement | null = null;
  private playBtn: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private chapterEl: HTMLElement | null = null;
  private tagEl: HTMLElement | null = null;
  private stopBtn: HTMLButtonElement | null = null;

  private lastInfo: PlaybackInfo | null = null;
  private isSeeking = false;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_NOXTTS_CONTROL;
  }

  getDisplayText(): string {
    return "NoxTTS 控制面板";
  }

  getIcon(): string {
    return "audio-file";
  }

  async onOpen() {
    this.containerEl.empty();
    this.containerEl.addClass("nox-tts-control-panel");

    // Header
    const header = this.containerEl.createEl("div", {
      cls: "nox-tts-header",
    });
    header.createSpan({ text: "NoxTTS" });
    this.statusEl = header.createSpan({ cls: "nox-tts-status-text", text: "就绪" });

    // Note title
    this.noteTitleEl = this.containerEl.createEl("div", {
      cls: "nox-tts-note-title",
      text: "等待朗读...",
    });

    // Progress bar
    const progressContainer = this.containerEl.createEl("div", {
      cls: "nox-tts-progress",
    });
    this.progressBar = progressContainer.createEl("input", {
      type: "range",
      attr: { min: "0", max: "100", value: "0" },
    });
    this.progressBar.addEventListener("input", () => {
      this.isSeeking = true;
    });
    this.progressBar.addEventListener("change", () => {
      if (this.progressBar && this.lastInfo) {
        const seekTime =
          (parseFloat(this.progressBar.value) / 100) * this.lastInfo.duration;
        document.body.dispatchEvent(new CustomEvent("nox-tts-seek", {
          detail: { time: seekTime },
          bubbles: true,
        }));
      }
      this.isSeeking = false;
    });

    // Time info
    const timeRow = this.containerEl.createEl("div", {
      cls: "nox-tts-time-info",
    });
    this.currentTimeEl = timeRow.createSpan({ text: "00:00" });
    this.speedEl = timeRow.createSpan({ cls: "nox-tts-speed", text: "1.0x" });
    this.durationEl = timeRow.createSpan({ text: "00:00" });

    // Playback controls
    const controls = this.containerEl.createEl("div", {
      cls: "nox-tts-controls",
    });

    const backwardBtn = controls.createEl("button", { cls: "nox-tts-btn" });
    backwardBtn.setText("<<");
    backwardBtn.setAttribute("aria-label", "快退 15 秒");
    backwardBtn.addEventListener("click", () => {
      document.body.dispatchEvent(new CustomEvent("nox-tts-backward", { bubbles: true }));
    });

    this.playBtn = controls.createEl("button", {
      cls: "nox-tts-btn nox-tts-btn-play",
    });
    this.playBtn.setText("▶");
    this.playBtn.setAttribute("aria-label", "播放/暂停");
    this.playBtn.addEventListener("click", () => {
      document.body.dispatchEvent(new CustomEvent("nox-tts-toggle-play", { bubbles: true }));
    });

    const forwardBtn = controls.createEl("button", { cls: "nox-tts-btn" });
    forwardBtn.setText(">>");
    forwardBtn.setAttribute("aria-label", "快进 15 秒");
    forwardBtn.addEventListener("click", () => {
      document.body.dispatchEvent(new CustomEvent("nox-tts-forward", { bubbles: true }));
    });

    // Info section
    const infoRow = this.containerEl.createEl("div", { cls: "nox-tts-info" });
    this.chapterEl = infoRow.createSpan({ text: "" });
    this.tagEl = infoRow.createSpan({ text: "" });

    // Action buttons
    const actions = this.containerEl.createEl("div", {
      cls: "nox-tts-actions",
    });

    this.stopBtn = actions.createEl("button", { text: "停止朗读" });
    this.stopBtn.addEventListener("click", () => {
      document.body.dispatchEvent(new CustomEvent("nox-tts-stop", { bubbles: true }));
    });

    const closeBtn = actions.createEl("button", { text: "关闭面板" });
    closeBtn.addEventListener("click", () => {
      this.leaf.detach();
    });
  }

  async onClose() {
    // clean up
  }

  /**
   * Update the view with current playback info.
   */
  update(info: PlaybackInfo, synthesisProgress?: { current: number; total: number } | null) {
    this.lastInfo = info;

    if (this.noteTitleEl) {
      this.noteTitleEl.setText(info.noteTitle || "等待朗读...");
    }

    if (this.statusEl) {
      if (synthesisProgress) {
        this.statusEl.setText(
          `合成中 ${synthesisProgress.current}/${synthesisProgress.total}...`
        );
      } else {
        switch (info.state) {
          case PlaybackState.IDLE:
            this.statusEl.setText("就绪");
            break;
          case PlaybackState.LOADING:
            this.statusEl.setText("加载中...");
            break;
          case PlaybackState.PLAYING:
            this.statusEl.setText("正在朗读");
            break;
          case PlaybackState.PAUSED:
            this.statusEl.setText("|| 暂停中");
            break;
          case PlaybackState.STOPPED:
            this.statusEl.setText("已完成");
            break;
        }
      }
    }

    if (this.playBtn) {
      switch (info.state) {
        case PlaybackState.PLAYING:
          this.playBtn.setText("||");
          break;
        case PlaybackState.PAUSED:
          this.playBtn.setText("▶");
          break;
        default:
          this.playBtn.setText("▶");
      }
    }

    // Update times
    if (this.currentTimeEl) {
      this.currentTimeEl.setText(formatTime(info.currentTime));
    }
    if (this.durationEl) {
      this.durationEl.setText(formatTime(info.duration));
    }
    if (this.speedEl) {
      this.speedEl.setText(`${info.speed.toFixed(1)}x`);
    }

    // Update progress bar (unless user is dragging)
    if (this.progressBar && !this.isSeeking && info.duration > 0) {
      const percent = (info.currentTime / info.duration) * 100;
      this.progressBar.value = String(Math.min(100, Math.max(0, percent)));
    }

    // Update chapter info
    if (this.chapterEl && info.totalSegments > 1) {
      this.chapterEl.setText(
        `段落 ${info.currentSegment + 1}/${info.totalSegments}`
      );
    } else if (this.chapterEl) {
      this.chapterEl.setText("");
    }
  }
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
