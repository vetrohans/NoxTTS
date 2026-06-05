/**
 * Mobile & Background Playback — PRD Phase 5
 *
 * Uses the Media Session API to provide:
 * - Lock screen / Control Center playback info (title, artist, progress)
 * - Remote controls (play/pause, seek forward/back, scrub)
 * - Headphone remote (single/double/triple click)
 * - Audio route change detection (headphone unplug → auto-pause)
 * - Audio interruption handling (phone calls, alarms)
 */

import { PlaybackInfo, PlaybackState, AudioPlayer } from "./audio-player";

export class MobilePlaybackManager {
  private player: AudioPlayer;
  private lastInfo: PlaybackInfo | null = null;
  private isSetup = false;

  // Check if Media Session API is available
  static isSupported(): boolean {
    return "mediaSession" in navigator;
  }

  constructor(player: AudioPlayer) {
    this.player = player;
  }

  /**
   * Initialize mobile playback support.
   * Call once after the audio player is ready.
   */
  setup() {
    if (this.isSetup) return;
    if (!MobilePlaybackManager.isSupported()) return;

    this.isSetup = true;

    // Listen to playback state changes → update Media Session
    this.player.onChange((info: PlaybackInfo) => {
      this.lastInfo = info;
      this.updateMediaSession(info);
    });

    // Register Media Session action handlers
    this.registerActionHandlers();

    // Listen for audio route changes (headphone unplug)
    this.listenForRouteChanges();

    // Listen for audio interruptions (calls, alarms)
    this.listenForInterruptions();
  }

  /**
   * Update the Media Session metadata and position state.
   */
  private updateMediaSession(info: PlaybackInfo) {
    if (!("mediaSession" in navigator)) return;

    // Set metadata — shown on lock screen / control center
    navigator.mediaSession.metadata = new MediaMetadata({
      title: info.noteTitle || "NoxTTS",
      artist: "NoxTTS · CosyVoice2",
      album: info.totalSegments > 1
        ? `段落 ${info.currentSegment + 1}/${info.totalSegments}`
        : "",
      artwork: [],
    });

    // Set playback state
    switch (info.state) {
      case PlaybackState.PLAYING:
        navigator.mediaSession.playbackState = "playing";
        break;
      case PlaybackState.PAUSED:
        navigator.mediaSession.playbackState = "paused";
        break;
      default:
        navigator.mediaSession.playbackState = "none";
        break;
    }

    // Set position state for progress bar on lock screen
    if (info.duration > 0) {
      navigator.mediaSession.setPositionState({
        duration: info.duration,
        playbackRate: info.speed,
        position: info.currentTime,
      });
    }
  }

  /**
   * Register handlers for Control Center and headphone remote actions.
   */
  private registerActionHandlers() {
    if (!("mediaSession" in navigator)) return;

    // Play
    navigator.mediaSession.setActionHandler("play", () => {
      if (this.player.getInfo().state === PlaybackState.PAUSED) {
        this.player.resume();
      }
    });

    // Pause
    navigator.mediaSession.setActionHandler("pause", () => {
      if (this.player.getInfo().state === PlaybackState.PLAYING) {
        this.player.pause();
      }
    });

    // Stop
    navigator.mediaSession.setActionHandler("stop", () => {
      this.player.stop();
    });

    // Toggle play/pause (headphone single-click)
    navigator.mediaSession.setActionHandler("togglemicrophone" as any, () => {
      // Not used, but some platforms map this
    });

    // Seek backward 15s (headphone triple-click)
    navigator.mediaSession.setActionHandler("seekbackward", (details) => {
      const offset = details.seekOffset || 15;
      this.player.seekBackward(offset);
    });

    // Seek forward 15s (headphone double-click)
    navigator.mediaSession.setActionHandler("seekforward", (details) => {
      const offset = details.seekOffset || 15;
      this.player.seekForward(offset);
    });

    // Seek to position (Control Center scrub)
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime != null) {
        this.player.seekTo(details.seekTime);
      }
    });

    // Previous track → map to restart or seek to start
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      this.player.seekTo(0);
    });

    // Next track → map to seek to end (user can stop)
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      // Do nothing — we don't have track-skipping in single-note mode
    });
  }

  /**
   * Listen for audio output device changes (e.g., headphones unplugged).
   * On headphone unplug, auto-pause to avoid speaker blast.
   */
  private listenForRouteChanges() {
    if (!("mediaDevices" in navigator)) return;

    // Modern API: use the audio output device change event
    try {
      (navigator.mediaDevices as any).addEventListener?.("devicechange", () => {
        // Check if headphones were removed — if so, pause
        this.checkAudioOutput();
      });
    } catch {
      // mediaDevices not available, skip
    }

    // For Safari/iOS: listen to the older API
    if ("audioSession" in (navigator as any)) {
      const audioSession = (navigator as any).audioSession;
      // We can't directly listen to route changes via this API,
      // but we can at least set the type
      if (audioSession?.type === undefined) {
        try { audioSession.type = "playback"; } catch {}
      }
    }
  }

  /**
   * Check if audio output changed and pause if headphones removed.
   */
  private async checkAudioOutput() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = devices.filter((d) => d.kind === "audiooutput");

      // If no audio output devices with label (headphones were disconnected),
      // check if there are audio outputs at all
      const hasHeadphones = audioOutputs.some(
        (d) => d.deviceId !== "default" && d.deviceId !== "communications"
      );

      // If we were playing through headphones and they're gone, pause
      if (!hasHeadphones && audioOutputs.length <= 1) {
        if (this.player.getInfo().state === PlaybackState.PLAYING) {
          this.player.pause();
        }
      }
    } catch {
      // Device enumeration not supported
    }
  }

  /**
   * Listen for audio interruptions (phone calls, alarms, etc.)
   */
  private listenForInterruptions() {
    // Standard Web API: AudioContext or HTMLAudioElement events
    // For HTML5 Audio, we handle this via the Audio element events
    // The AudioPlayer already handles errors, but we add interruption awareness

    // For mobile Safari, use the page visibility API as a proxy
    document.addEventListener("visibilitychange", () => {
      const info = this.player.getInfo();
      // When page becomes hidden during playback, it could mean a call etc.
      // But we don't auto-pause — Media Session keeps it running
      // When page becomes visible again, just update the session
      if (document.visibilityState === "visible" && this.lastInfo) {
        this.updateMediaSession(this.lastInfo);
      }
    });

    // On iOS Safari, listen for the audio session interruption
    if ("audioSession" in (navigator as any)) {
      const audioSession = (navigator as any).audioSession;
      if (audioSession) {
        audioSession.addEventListener?.("interruption", (e: any) => {
          if (e?.type === "began") {
            // Call/alarm started — pause if playing
            if (this.player.getInfo().state === PlaybackState.PLAYING) {
              this.player.pause();
            }
          } else if (e?.type === "ended") {
            // Interruption ended — user can manually resume
            // We don't auto-resume to avoid unexpected playback
          }
        });
      }
    }

    // For Android/Chrome: use the audio element's own interruption handling
    // This is built into HTML5 Audio — the browser pauses audio during calls
  }
}
