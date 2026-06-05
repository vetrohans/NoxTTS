import { Plugin } from "obsidian";
import { PlaybackInfo, PlaybackState } from "./audio-player";

export class StatusBarIndicator {
  private plugin: Plugin;
  private element: HTMLElement;
  private cleanupFn: (() => void) | null = null;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.element = this.plugin.addStatusBarItem();
    this.element.addClass("nox-tts-status-bar");
    this.setIdle();
  }

  setStatus(info: PlaybackInfo) {
    this.element.empty();

    switch (info.state) {
      case PlaybackState.IDLE:
        this.setIdle();
        break;
      case PlaybackState.LOADING:
        this.setLoading(info);
        break;
      case PlaybackState.PLAYING:
        this.setPlaying(info);
        break;
      case PlaybackState.PAUSED:
        this.setPaused(info);
        break;
      case PlaybackState.STOPPED:
        this.setIdle();
        break;
    }
  }

  private setIdle() {
    this.element.setText("NoxTTS | 就绪");
    this.element.setAttribute("aria-label", "NoxTTS: 就绪");
  }

  private setLoading(info: PlaybackInfo) {
    this.element.setText(`NoxTTS | 加载中...`);
    this.element.setAttribute("aria-label", "NoxTTS: 正在合成语音");
  }

  private setPlaying(info: PlaybackInfo) {
    const current = formatTime(info.currentTime);
    const total = formatTime(info.duration);
    const speed = info.speed.toFixed(1);

    let text = `NoxTTS | ${current} / ${total} | ${speed}x`;
    if (info.totalSegments > 1) {
      text += ` | 段 ${info.currentSegment + 1}/${info.totalSegments}`;
    }

    this.element.setText(text);
    this.element.setAttribute(
      "aria-label",
      `NoxTTS: ${info.noteTitle} - 播放中`
    );
  }

  private setPaused(info: PlaybackInfo) {
    const current = formatTime(info.currentTime);
    const total = formatTime(info.duration);
    const speed = info.speed.toFixed(1);

    this.element.setText(
      `NoxTTS | ${current} / ${total} | ${speed}x | || 暂停中`
    );
    this.element.setAttribute("aria-label", "NoxTTS: 暂停中");
  }

  setText(text: string) {
    this.element.setText(text);
  }

  onClick(callback: () => void) {
    this.element.style.cursor = "pointer";
    this.element.addEventListener("click", callback);
  }
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
