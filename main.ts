import {
  Plugin,
  Notice,
  MarkdownView,
  Modal,
} from "obsidian";
import {
  NoxTTSSettings,
  DEFAULT_SETTINGS,
} from "./src/settings";
import { NoxTTSSettingTab } from "./src/settings-tab";
import { preprocessText } from "./src/text-processor";
import { segmentText } from "./src/text-segmenter";
import { hashSegment } from "./src/audio-cache";
import { ApiClient } from "./src/api-client";
import { AudioCache } from "./src/audio-cache";
import { AudioPlayer, PlaybackState, PlaybackInfo } from "./src/audio-player";
import { StatusBarIndicator } from "./src/status-bar";
import { NoxTTSControlView, VIEW_TYPE_NOXTTS_CONTROL } from "./src/control-view";
import { MobilePlaybackManager } from "./src/mobile-player";

export default class NoxTTSPlugin extends Plugin {
  settings: NoxTTSSettings;
  apiClient: ApiClient;
  audioCache: AudioCache;
  audioPlayer: AudioPlayer;
  statusBar: StatusBarIndicator;
  mobilePlayer: MobilePlaybackManager;

  private currentNotePath: string | null = null;
  private currentNoteTitle: string | null = null;
  private lastTriggerTime = 0;
  private isSynthesizing = false;

  // Synthesis progress exposed for the control view
  synthesisProgress: { current: number; total: number } | null = null;

  /**
   * Check if there is an active playback/reading session.
   * PRD 6.8: multi-instance protection.
   */
  private isActive(): boolean {
    const state = this.audioPlayer.getInfo().state;
    return (
      state === PlaybackState.PLAYING ||
      state === PlaybackState.PAUSED ||
      state === PlaybackState.LOADING ||
      this.isSynthesizing
    );
  }

  /**
   * PRD 6.8: If already reading note A and user triggers on note B,
   * ask whether to stop A and start B.
   */
  private async checkActiveAndConfirm(newNoteTitle: string): Promise<boolean> {
    if (!this.isActive()) return true;

    const currentTitle =
      this.audioPlayer.getInfo().noteTitle || "未知笔记";

    // Same note or same operation → allow restart
    if (currentTitle === newNoteTitle) return true;

    // Different note → ask
    return new Promise((resolve) => {
      const modal = new Modal(this.app);
      modal.titleEl.setText("NoxTTS");

      const contentEl = modal.contentEl;
      contentEl.createEl("p", {
        text: `正在朗读《${currentTitle}》`,
      });
      contentEl.createEl("p", {
        text: `是否停止当前朗读，开始朗读《${newNoteTitle}》？`,
      });

      const buttonEl = contentEl.createEl("div");
      buttonEl.style.marginTop = "12px";
      buttonEl.style.display = "flex";
      buttonEl.style.justifyContent = "flex-end";
      buttonEl.style.gap = "8px";

      const cancelBtn = buttonEl.createEl("button", { text: "取消" });
      cancelBtn.onclick = () => {
        modal.close();
        resolve(false);
      };

      const confirmBtn = buttonEl.createEl("button", {
        text: "停止并切换",
        cls: "mod-cta",
      });
      confirmBtn.onclick = () => {
        this.stopPlayback();
        modal.close();
        resolve(true);
      };

      modal.open();
    });
  }

  async onload() {
    await this.loadSettings();

    // Initialize modules
    this.apiClient = new ApiClient(this.settings);
    this.audioCache = new AudioCache(this);
    await this.audioCache.initialize();
    this.audioPlayer = new AudioPlayer();
    this.statusBar = new StatusBarIndicator(this);
    this.mobilePlayer = new MobilePlaybackManager(this.audioPlayer);
    this.mobilePlayer.setup();

    // Register settings tab
    this.addSettingTab(new NoxTTSSettingTab(this.app, this));

    // Register the control panel view
    this.registerView(
      VIEW_TYPE_NOXTTS_CONTROL,
      (leaf) => new NoxTTSControlView(leaf)
    );

    // Expose plugin on window for control view access
    (window as any).__noxTtsPlugin = this;

    // Listen to playback state changes → update control view
    this.audioPlayer.onChange((info: PlaybackInfo) => {
      this.statusBar.setStatus(info);
      this.updateControlView(info);
    });

    // Status bar click → toggle play/pause
    this.statusBar.onClick(() => {
      const state = this.audioPlayer.getInfo().state;
      if (
        state === PlaybackState.PLAYING ||
        state === PlaybackState.PAUSED
      ) {
        this.audioPlayer.togglePlayPause();
      }
    });

    // Listen for control view events (use document.body for custom events)
    const body = document.body;
    this.registerDomEvent(body, "nox-tts-toggle-play" as any, () => {
      this.audioPlayer.togglePlayPause();
    });
    this.registerDomEvent(body, "nox-tts-stop" as any, () => {
      this.stopPlayback();
    });
    this.registerDomEvent(body, "nox-tts-forward" as any, () => {
      this.audioPlayer.seekForward(15);
    });
    this.registerDomEvent(body, "nox-tts-backward" as any, () => {
      this.audioPlayer.seekBackward(15);
    });
    this.registerDomEvent(body, "nox-tts-seek" as any, (e: Event) => {
      const time = (e as CustomEvent).detail?.time;
      if (typeof time === "number") {
        this.audioPlayer.seekTo(time);
      }
    });

    // Ribbon icon (PRD 5.2) — click to read current note
    this.addRibbonIcon("audio-file", "NoxTTS: 朗读当前笔记", () => {
      this.readCurrentNote();
    });

    // Register commands
    this.registerCommands();

    // Delegated listener: wire speed select dropdowns in embedded audio players
    // (inline JS is blocked by Obsidian's CSP, so we catch events globally)
    this.registerDomEvent(document.body, "change" as any, (evt: Event) => {
      const target = evt.target as HTMLElement;
      if (!target || !target.closest) return;
      const select = target.closest(".nox-tts-speed-select");
      if (!select) return;
      const embed = select.closest(".nox-tts-embed");
      if (!embed) return;
      const audio = embed.querySelector("audio");
      if (audio) {
        audio.playbackRate = parseFloat((select as HTMLSelectElement).value);
      }
    });
  }

  onunload() {
    this.audioPlayer.stop();
    delete (window as any).__noxTtsPlugin;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  syncSettings() {
    this.apiClient.updateSettings(this.settings);
    this.audioPlayer.setSpeed(this.settings.defaultSpeed);
  }

  private registerCommands() {
    this.addCommand({
      id: "nox-tts-read-note",
      name: "NoxTTS：朗读当前笔记",
      callback: () => this.readCurrentNote(),
    });
    this.addCommand({
      id: "nox-tts-read-selection",
      name: "NoxTTS：朗读选中文本",
      callback: () => this.readSelectedText(),
    });
    this.addCommand({
      id: "nox-tts-read-tag",
      name: "NoxTTS：按标签朗读",
      callback: () => this.readByTag(),
    });
    this.addCommand({
      id: "nox-tts-read-review",
      name: "NoxTTS：朗读待复习卡片",
      callback: () => this.readReviewCards(),
    });
    this.addCommand({
      id: "nox-tts-pre-synthesize",
      name: "NoxTTS：预合成当前笔记",
      callback: () => this.preSynthesize(),
    });
    this.addCommand({
      id: "nox-tts-navigate-next-header",
      name: "NoxTTS：跳转到下一标题",
      callback: () => this.navigateNextHeader(),
    });
    this.addCommand({
      id: "nox-tts-pause",
      name: "NoxTTS：暂停 / 继续",
      callback: () => this.audioPlayer.togglePlayPause(),
    });
    this.addCommand({
      id: "nox-tts-stop",
      name: "NoxTTS：停止",
      callback: () => this.stopPlayback(),
    });
    this.addCommand({
      id: "nox-tts-forward",
      name: "NoxTTS：快进 15 秒",
      callback: () => this.audioPlayer.seekForward(15),
    });
    this.addCommand({
      id: "nox-tts-backward",
      name: "NoxTTS：快退 15 秒",
      callback: () => this.audioPlayer.seekBackward(15),
    });
    this.addCommand({
      id: "nox-tts-clear-cache",
      name: "NoxTTS：清除音频缓存",
      callback: async () => {
        await this.audioCache.clearAll();
        new Notice("NoxTTS：音频缓存已清除");
      },
    });
  }

  // === Control View Helpers ===

  /**
   * Open or reveal the control panel in the right sidebar.
   */
  async ensureControlView() {
    const { workspace } = this.app;

    // Check if view is already open
    const existing = workspace.getLeavesOfType(VIEW_TYPE_NOXTTS_CONTROL);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    // Open in right sidebar
    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({
        type: VIEW_TYPE_NOXTTS_CONTROL,
        active: true,
      });
      workspace.revealLeaf(leaf);
    }
  }

  /**
   * Push playback / synthesis state to the control view.
   */
  private updateControlView(info: PlaybackInfo) {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_NOXTTS_CONTROL);
    for (const leaf of leaves) {
      if (leaf.view instanceof NoxTTSControlView) {
        leaf.view.update(info, this.synthesisProgress);
      }
    }
  }

  /**
   * Get the control view instance if open.
   */
  getControlView(): NoxTTSControlView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_NOXTTS_CONTROL);
    if (leaves.length > 0 && leaves[0].view instanceof NoxTTSControlView) {
      return leaves[0].view;
    }
    return null;
  }

  // === Command Handlers ===

  private async readCurrentNote() {
    if (!this.checkDuplicateTrigger()) return;

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("NoxTTS：请打开一篇笔记");
      return;
    }

    const file = view.file;
    if (!file) {
      new Notice("NoxTTS：当前文件未保存");
      return;
    }

    if (!(await this.checkActiveAndConfirm(file.basename))) return;

    const content = view.getViewData();
    await this.synthesizeAndPlay(content, file.path, file.basename, file.stat.mtime);
  }

  private async readSelectedText() {
    if (!this.checkDuplicateTrigger()) return;

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("NoxTTS：请打开一篇笔记");
      return;
    }

    const selection = view.editor.getSelection();
    if (!selection.trim()) {
      new Notice("NoxTTS：请先选中要朗读的文本");
      return;
    }

    const file = view.file;
    const notePath = file ? file.path : "selection";
    const noteTitle = file ? `[选中] ${file.basename}` : "[选中文本]";
    const noteModified = file ? file.stat.mtime : Date.now();

    if (!(await this.checkActiveAndConfirm(noteTitle))) return;

    await this.synthesizeAndPlay(selection, notePath, noteTitle, noteModified);
  }

  private async readByTag() {
    if (!this.checkDuplicateTrigger()) return;

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("NoxTTS：请打开一篇笔记");
      return;
    }

    const tag = await this.showTagInputModal();
    if (!tag) return;

    const content = view.getViewData();
    const file = view.file;
    if (!file) return;

    const extractedText = extractParagraphsByTag(content, tag);
    if (!extractedText.trim()) {
      new Notice(`NoxTTS：未找到包含标签 #${tag} 的内容`);
      return;
    }

    await this.synthesizeAndPlay(
      extractedText,
      `${file.path}#tag=${tag}`,
      `[标签: #${tag}] ${file.basename}`,
      file.stat.mtime
    );
  }

  private async readReviewCards() {
    if (!this.checkDuplicateTrigger()) return;

    const cards = await this.getDueReviewCards();
    if (cards.length === 0) {
      new Notice("NoxTTS：没有待复习的卡片");
      return;
    }

    const text = cards
      .map((card, i) => `卡片 ${i + 1}。问题：${card.front}。答案：${card.back}。`)
      .join("\n\n");

    await this.synthesizeAndPlay(
      text,
      "review-cards",
      `待复习卡片 (${cards.length} 张)`,
      Date.now()
    );
  }

  private async preSynthesize() {
    if (this.isSynthesizing) {
      new Notice("NoxTTS：正在合成中，请稍候...");
      return;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) {
      new Notice("NoxTTS：请打开一篇笔记");
      return;
    }

    const file = view.file;
    const content = view.getViewData();

    new Notice("NoxTTS：开始预合成...");
    await this.synthesizeAndPlay(content, file.path, file.basename, file.stat.mtime, true);
  }

  private navigateNextHeader() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;

    const editor = view.editor;
    const cursor = editor.getCursor();
    const content = view.getViewData();
    const lines = content.split("\n");

    for (let i = cursor.line + 1; i < lines.length; i++) {
      if (/^#{1,6}\s/.test(lines[i])) {
        editor.setCursor({ line: i, ch: 0 });
        editor.scrollIntoView(
          { from: { line: i, ch: 0 }, to: { line: i, ch: 0 } },
          true
        );
        new Notice(
          `NoxTTS：跳转到 ${lines[i].replace(/^#+\s*/, "")}`
        );
        return;
      }
    }

    new Notice("NoxTTS：已到达笔记末尾");
  }

  private stopPlayback() {
    this.audioPlayer.stop();
    this.isSynthesizing = false;
    this.synthesisProgress = null;
    this.updateControlView(this.audioPlayer.getInfo());
  }

  // === Core Synthesis and Playback ===

  private async synthesizeAndPlay(
    rawText: string,
    notePath: string,
    noteTitle: string,
    noteModified: number,
    preSynthesizeOnly: boolean = false
  ) {
    try {
      this.isSynthesizing = true;

      // Open the control panel first so user sees progress
      await this.ensureControlView();

      // Step 1: Preprocess text
      const { text, isEmpty } = preprocessText(rawText, this.settings);
      if (isEmpty) {
        new Notice("NoxTTS：当前笔记过滤后无可朗读内容");
        this.isSynthesizing = false;
        return;
      }

      // Check for mostly-code content
      if (rawText.length > 1000 && text.length < rawText.length * 0.1) {
        new Notice("NoxTTS：当前笔记大部分为代码块，朗读内容较少");
      }

      // Check for very large notes
      if (text.length > 30000 && !preSynthesizeOnly) {
        new Notice(
          `NoxTTS：笔记较长（约 ${Math.round(text.length / 1000)} 千字），预计需要 ${Math.round(text.length / 3000 * 5)} 秒合成`
        );
      }

      // Step 2: Segment text
      const segments = segmentText(text);
      const segmentHashes = segments.map((s) => hashSegment(s));
      const totalSegments = segments.length;

      // Set initial synth progress
      this.synthesisProgress = { current: 0, total: totalSegments };
      this.updateControlView({
        state: PlaybackState.LOADING,
        currentTime: 0,
        duration: 0,
        speed: this.settings.defaultSpeed,
        currentSegment: 0,
        totalSegments,
        noteTitle,
      });

      // Step 3: Check cache
      if (this.settings.enableCache) {
        const cachedEntry = await this.audioCache.getCacheEntry(
          notePath,
          noteModified,
          segmentHashes
        );

        if (cachedEntry) {
          // Cache hit!
          this.synthesisProgress = null;
          this.statusBar.setText(`NoxTTS | 缓存命中 | ${noteTitle}`);
          this.isSynthesizing = false;

          if (!preSynthesizeOnly) {
            const audioPaths = cachedEntry.audioFiles.map((f) =>
              this.audioCache.getResourcePath(f)
            );
            await this.audioPlayer.playFromCache(
              audioPaths,
              noteTitle,
              this.settings.defaultSpeed,
              this.app.vault.adapter
            );
          }

          // Push final update
          this.updateControlView(this.audioPlayer.getInfo());
          return;
        }
      }

      // Step 4: Synthesize each segment with progress
      const audioBuffers: ArrayBuffer[] = [];

      for (let i = 0; i < segments.length; i++) {
        // Check if user stopped
        if (
          this.audioPlayer.getInfo().state === PlaybackState.IDLE &&
          audioBuffers.length > 0
        ) {
          this.isSynthesizing = false;
          this.synthesisProgress = null;
          return;
        }

        // Update progress — both status bar and control view
        this.synthesisProgress = { current: i + 1, total: totalSegments };
        this.statusBar.setText(
          `NoxTTS | 合成中 ${i + 1}/${totalSegments}...`
        );
        this.updateControlView(this.audioPlayer.getInfo());

        const result = await this.apiClient.synthesizeWithRetry(segments[i]);

        if (!result.success) {
          new Notice(`NoxTTS：第 ${i + 1} 段合成失败 - ${result.error}`);
          if (audioBuffers.length > 0 && !preSynthesizeOnly) {
            new Notice(
              `NoxTTS：已完成 ${audioBuffers.length}/${totalSegments} 段，将从已合成部分开始播放`
            );
            break;
          }
          this.isSynthesizing = false;
          this.synthesisProgress = null;
          this.updateControlView(this.audioPlayer.getInfo());
          return;
        }

        audioBuffers.push(result.audioData!);
      }

      this.synthesisProgress = null;

      // Step 5: Save to cache and play
      if (this.settings.enableCache && audioBuffers.length > 0) {
        const entry = await this.audioCache.saveCacheEntry(
          notePath,
          noteModified,
          audioBuffers,
          segmentHashes
        );

        if (!preSynthesizeOnly) {
          const audioPaths = entry.audioFiles.map((f) =>
            this.audioCache.getResourcePath(f)
          );
          await this.audioPlayer.playFromCache(
            audioPaths,
            noteTitle,
            this.settings.defaultSpeed,
            this.app.vault.adapter
          );
        } else {
          new Notice(
            `NoxTTS：预合成完成，共 ${entry.segments} 段音频已缓存`
          );
        }
      } else if (!preSynthesizeOnly && audioBuffers.length > 0) {
        await this.audioPlayer.playFromBuffers(
          audioBuffers,
          noteTitle,
          this.settings.defaultSpeed
        );
      }

      this.isSynthesizing = false;

      // PRD 功能4: Embed combined MP3 at top of note
      if (audioBuffers.length > 0 && !preSynthesizeOnly) {
        await this.embedAudioInNote(notePath, noteTitle, audioBuffers);
      }
    } catch (error) {
      console.error("NoxTTS: Synthesis failed", error);
      new Notice(
        `NoxTTS：朗读失败 - ${error instanceof Error ? error.message : String(error)}`
      );
      this.isSynthesizing = false;
      this.synthesisProgress = null;
      this.updateControlView(this.audioPlayer.getInfo());
    }
  }

  // === Helper Methods ===

  /**
   * PRD 功能4: Concatenate all segments into one MP3, save next to the note,
   * and insert an HTML5 audio player at the top of the note.
   */
  private async embedAudioInNote(
    notePath: string,
    noteTitle: string,
    audioBuffers: ArrayBuffer[]
  ) {
    try {
      // 1. Concatenate all MP3 segments
      const totalSize = audioBuffers.reduce((s, b) => s + b.byteLength, 0);
      const combined = new Uint8Array(totalSize);
      let offset = 0;
      for (const buf of audioBuffers) {
        combined.set(new Uint8Array(buf), offset);
        offset += buf.byteLength;
      }

      // 2. Determine mp3 filename: same base name + .tts.mp3
      const noteFile = this.app.vault.getAbstractFileByPath(notePath);
      if (!noteFile || !("basename" in noteFile)) return;

      const baseName = (noteFile as any).basename || noteTitle;
      const mp3Name = `${baseName}.tts.mp3`;
      const noteDir = notePath.substring(0, notePath.lastIndexOf("/") + 1);
      const mp3Path = noteDir + mp3Name;

      // 3. Write binary MP3 to vault
      const adapter = this.app.vault.adapter;
      if (typeof (adapter as any).writeBinary !== "function") {
        console.warn("NoxTTS: writeBinary not available, skip MP3 embed");
        return;
      }
      await (adapter as any).writeBinary(mp3Path, combined.buffer);

      // 4. Build custom audio player embed (no inline JS, driven by plugin event delegation)
      const speedOptions = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5];
      const speedOptsHtml = speedOptions
        .map((v) => `<option value="${v}"${v === 1.0 ? " selected" : ""}>${v}x</option>`)
        .join("");

      const playerId = `nox-tts-${Date.now()}`;
      const embedHtml =
        `\n<div class="nox-tts-embed" style="margin:12px 0;padding:10px;border:1px solid var(--background-modifier-border);border-radius:8px;background:var(--background-secondary)">\n` +
        `<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">NoxTTS: ${noteTitle}</div>\n` +
        `<audio class="nox-tts-audio" src="./${mp3Name}" controls controlsList="nodownload noremoteplayback" preload="metadata" style="width:100%;height:40px"></audio>\n` +
        `<div style="display:flex;align-items:center;gap:8px;margin-top:6px;font-size:12px;color:var(--text-muted)">\n` +
        `<span>Speed:</span>\n` +
        `<select class="nox-tts-speed-select" data-audio-id="${playerId}" style="font-size:12px;padding:2px 6px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal)">\n${speedOptsHtml}\n</select>\n` +
        `<span style="margin-left:auto">NoxTTS</span>\n` +
        `</div>\n</div>\n`;

      // 5. Insert at top of note (after frontmatter if present)
      const content = await adapter.read(notePath);
      const frontmatterMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
      const insertPos = frontmatterMatch
        ? frontmatterMatch[0].length
        : 0;

      // Check if there's already a nox-tts-embed, replace it
      const existingEmbed = /<div class="nox-tts-embed">[\s\S]*?<\/div>\n?/.exec(
        content.substring(insertPos)
      );

      let newContent: string;
      if (existingEmbed) {
        // Replace existing embed
        newContent =
          content.substring(0, insertPos + existingEmbed.index) +
          embedHtml +
          "\n" +
          content.substring(insertPos + existingEmbed.index + existingEmbed[0].length);
      } else {
        // Insert new embed
        newContent =
          content.substring(0, insertPos) +
          embedHtml +
          "\n" +
          content.substring(insertPos);
      }

      await adapter.write(notePath, newContent);
    } catch (e) {
      console.warn("NoxTTS: Failed to embed audio in note:", e);
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      let binaryStr = "";
      for (let j = 0; j < chunk.length; j++) {
        binaryStr += String.fromCharCode(chunk[j]);
      }
      chunks.push(binaryStr);
    }
    return btoa(chunks.join(""));
  }

  private checkDuplicateTrigger(): boolean {
    const now = Date.now();
    if (now - this.lastTriggerTime < 2000) {
      new Notice("NoxTTS：正在朗读中，请先停止当前朗读");
      return false;
    }
    this.lastTriggerTime = now;
    return true;
  }

  private showTagInputModal(): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = new Modal(this.app);
      modal.titleEl.setText("输入标签名");

      const contentEl = modal.contentEl;
      const input = contentEl.createEl("input", {
        type: "text",
        placeholder: "输入标签，如 review",
        cls: "nox-tts-tag-input",
      });
      input.style.width = "100%";
      input.style.padding = "8px";
      input.style.fontSize = "14px";

      const buttonEl = contentEl.createEl("div");
      buttonEl.style.marginTop = "12px";
      buttonEl.style.display = "flex";
      buttonEl.style.justifyContent = "flex-end";
      buttonEl.style.gap = "8px";

      const cancelBtn = buttonEl.createEl("button", { text: "取消" });
      cancelBtn.onclick = () => {
        modal.close();
        resolve(null);
      };

      const confirmBtn = buttonEl.createEl("button", {
        text: "确定",
        cls: "mod-cta",
      });
      confirmBtn.onclick = () => {
        modal.close();
        resolve(input.value.trim() || null);
      };

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          modal.close();
          resolve(input.value.trim() || null);
        }
      });

      modal.open();
      input.focus();
    });
  }

  private async getDueReviewCards(): Promise<
    { front: string; back: string }[]
  > {
    try {
      const srDataPath =
        ".obsidian/plugins/obsidian-spaced-repetition/data.json";
      const exists = await this.app.vault.adapter.exists(srDataPath);
      if (!exists) return [];

      const rawData = await this.app.vault.adapter.read(srDataPath);
      const data = JSON.parse(rawData);

      const cards: { front: string; back: string }[] = [];
      const now = Date.now();

      const items = data?.data?.notes || data?.notes || data?.items || [];

      for (const item of items) {
        const due = item.due || item.nextReview || item.scheduled;
        if (due && new Date(due).getTime() <= now) {
          cards.push({
            front: item.front || item.question || item.text || "",
            back: item.back || item.answer || "",
          });
        }
      }

      cards.sort((a, b) => {
        const aDue = new Date((a as any).due || 0).getTime();
        const bDue = new Date((b as any).due || 0).getTime();
        return aDue - bDue;
      });

      return cards;
    } catch {
      new Notice("NoxTTS：无法读取 Spaced Repetition 插件数据");
      return [];
    }
  }
}

// === Utility Functions ===

function extractParagraphsByTag(content: string, tag: string): string {
  const blocks = content.split(/\n\n+/);
  const tagPattern = new RegExp(
    `#${escapeRegex(tag)}\\b|#${escapeRegex(tag)}/\\w+`,
    "i"
  );
  const matchingBlocks: string[] = [];

  for (const block of blocks) {
    if (tagPattern.test(block)) {
      matchingBlocks.push(block);
    }
  }

  return matchingBlocks.join("\n\n");
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
