export enum PlaybackState {
  IDLE = "idle",
  LOADING = "loading",
  PLAYING = "playing",
  PAUSED = "paused",
  STOPPED = "stopped",
}

export interface PlaybackInfo {
  state: PlaybackState;
  currentTime: number;   // seconds
  duration: number;      // seconds
  speed: number;
  currentSegment: number;
  totalSegments: number;
  noteTitle: string;
}

export type PlaybackCallback = (info: PlaybackInfo) => void;

export class AudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private state: PlaybackState = PlaybackState.IDLE;
  private speed: number = 1.0;
  private currentTimeSeconds: number = 0;
  private durationSeconds: number = 0;

  // Playlist support
  private playlist: string[] = []; // blob URLs or file paths
  private currentSegmentIndex: number = 0;
  private useAdapter: boolean = false;
  private adapter: any = null;
  private blobUrls: string[] = []; // Track blob URLs for cleanup

  private noteTitle: string = "";

  private listeners: Set<PlaybackCallback> = new Set();
  private timeUpdateInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {}

  /**
   * Play from cached file paths (requires adapter for reading).
   */
  async playFromCache(
    audioFilePaths: string[],
    noteTitle: string,
    speed: number,
    adapter: any,
    startFromSegment: number = 0
  ) {
    this.stop();
    this.playlist = audioFilePaths;
    this.currentSegmentIndex = startFromSegment;
    this.noteTitle = noteTitle;
    this.speed = speed;
    this.useAdapter = true;
    this.adapter = adapter;

    if (this.playlist.length === 0) {
      this.notifyListeners();
      return;
    }

    await this.playNextSegment();
  }

  /**
   * Play directly from AudioBuffer arrays (no file system needed).
   */
  async playFromBuffers(
    audioBuffers: ArrayBuffer[],
    noteTitle: string,
    speed: number,
    startFromSegment: number = 0
  ) {
    this.stop();
    this.blobUrls = [];
    this.playlist = [];

    for (const buffer of audioBuffers) {
      const blob = new Blob([buffer], { type: "audio/mp3" });
      const url = URL.createObjectURL(blob);
      this.blobUrls.push(url);
      this.playlist.push(url);
    }

    this.currentSegmentIndex = startFromSegment;
    this.noteTitle = noteTitle;
    this.speed = speed;
    this.useAdapter = false;

    if (this.playlist.length === 0) {
      this.notifyListeners();
      return;
    }

    await this.playNextSegment();
  }

  private async playNextSegment() {
    if (this.currentSegmentIndex >= this.playlist.length) {
      this.state = PlaybackState.STOPPED;
      this.currentTimeSeconds = this.durationSeconds;
      this.notifyListeners();
      return;
    }

    this.setLoading();

    try {
      let url: string;
      const source = this.playlist[this.currentSegmentIndex];

      if (this.useAdapter) {
        // Read from vault adapter and create blob URL
        let audioData: ArrayBuffer;
        if (typeof this.adapter.readBinary === "function") {
          audioData = await this.adapter.readBinary(source);
        } else {
          const base64 = await this.adapter.read(source);
          const binaryStr = atob(base64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          audioData = bytes.buffer;
        }
        const blob = new Blob([audioData], { type: "audio/mp3" });
        url = URL.createObjectURL(blob);
      } else {
        // Already a blob URL
        url = source;
      }

      // Clean up previous audio element and non-playlist blob URLs
      if (this.audio) {
        const oldSrc = this.audio.src;
        this.audio.remove();
        // Only revoke if it's a blob URL we created for cached playback
        if (this.useAdapter && oldSrc.startsWith("blob:")) {
          URL.revokeObjectURL(oldSrc);
        }
      }

      this.audio = new Audio(url);
      this.audio.playbackRate = this.speed;

      this.audio.addEventListener("loadedmetadata", () => {
        if (this.audio) {
          this.durationSeconds = this.audio.duration;
          this.notifyListeners();
        }
      });

      this.audio.addEventListener("ended", () => {
        this.currentSegmentIndex++;
        this.playNextSegment();
      });

      this.audio.addEventListener("error", (e) => {
        console.error("NoxTTS: Audio playback error", e);
        this.currentSegmentIndex++;
        this.playNextSegment();
      });

      await this.audio.play();
      this.state = PlaybackState.PLAYING;
      this.startTimeUpdates();
      this.notifyListeners();
    } catch (error) {
      console.error("NoxTTS: Failed to play segment", error);
      this.currentSegmentIndex++;
      this.playNextSegment();
    }
  }

  /**
   * Pause playback.
   */
  pause() {
    if (this.audio && this.state === PlaybackState.PLAYING) {
      this.audio.pause();
      this.state = PlaybackState.PAUSED;
      this.stopTimeUpdates();
      this.captureCurrentTime();
      this.notifyListeners();
    }
  }

  /**
   * Resume playback from pause.
   */
  async resume() {
    if (this.audio && this.state === PlaybackState.PAUSED) {
      await this.audio.play();
      this.state = PlaybackState.PLAYING;
      this.startTimeUpdates();
      this.notifyListeners();
    }
  }

  /**
   * Toggle between play and pause.
   */
  async togglePlayPause() {
    if (this.state === PlaybackState.PLAYING) {
      this.pause();
    } else if (this.state === PlaybackState.PAUSED) {
      await this.resume();
    }
  }

  /**
   * Stop playback completely.
   */
  stop() {
    if (this.audio) {
      this.audio.pause();
      if (this.audio.src.startsWith("blob:")) {
        URL.revokeObjectURL(this.audio.src);
      }
      this.audio.remove();
      this.audio = null;
    }
    // Clean up all playlist blob URLs
    for (const url of this.blobUrls) {
      URL.revokeObjectURL(url);
    }
    this.blobUrls = [];
    this.state = PlaybackState.IDLE;
    this.currentTimeSeconds = 0;
    this.durationSeconds = 0;
    this.playlist = [];
    this.currentSegmentIndex = 0;
    this.stopTimeUpdates();
    this.notifyListeners();
  }

  /**
   * Seek forward by a number of seconds.
   */
  seekForward(seconds: number = 15) {
    if (!this.audio) return;
    const newTime = Math.min(
      this.audio.currentTime + seconds,
      this.audio.duration || 0
    );
    this.audio.currentTime = newTime;
    this.captureCurrentTime();
    this.notifyListeners();
  }

  /**
   * Seek backward by a number of seconds.
   */
  seekBackward(seconds: number = 15) {
    if (!this.audio) return;
    const newTime = Math.max(this.audio.currentTime - seconds, 0);
    this.audio.currentTime = newTime;
    this.captureCurrentTime();
    this.notifyListeners();
  }

  /**
   * Seek to a specific position in seconds.
   */
  seekTo(seconds: number) {
    if (!this.audio) return;
    this.audio.currentTime = Math.max(
      0,
      Math.min(seconds, this.audio.duration || 0)
    );
    this.captureCurrentTime();
    this.notifyListeners();
  }

  /**
   * Set playback speed.
   */
  setSpeed(speed: number) {
    this.speed = Math.max(0.5, Math.min(2.5, speed));
    if (this.audio) {
      this.audio.playbackRate = this.speed;
    }
    this.notifyListeners();
  }

  /**
   * Register a callback for playback state changes.
   */
  onChange(callback: PlaybackCallback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Get current playback info.
   */
  getInfo(): PlaybackInfo {
    return {
      state: this.state,
      currentTime: this.currentTimeSeconds,
      duration: this.durationSeconds,
      speed: this.speed,
      currentSegment: this.currentSegmentIndex,
      totalSegments: this.playlist.length,
      noteTitle: this.noteTitle,
    };
  }

  private setLoading() {
    this.state = PlaybackState.LOADING;
    this.notifyListeners();
  }

  private captureCurrentTime() {
    if (this.audio) {
      this.currentTimeSeconds = this.audio.currentTime;
    }
  }

  private startTimeUpdates() {
    this.stopTimeUpdates();
    this.timeUpdateInterval = setInterval(() => {
      if (this.audio && this.state === PlaybackState.PLAYING) {
        this.currentTimeSeconds = this.audio.currentTime;
        this.durationSeconds = this.audio.duration || 0;
        this.notifyListeners();
      }
    }, 250);
  }

  private stopTimeUpdates() {
    if (this.timeUpdateInterval) {
      clearInterval(this.timeUpdateInterval);
      this.timeUpdateInterval = null;
    }
  }

  private notifyListeners() {
    const info = this.getInfo();
    for (const listener of this.listeners) {
      try {
        listener(info);
      } catch {
        // ignore
      }
    }
  }
}
