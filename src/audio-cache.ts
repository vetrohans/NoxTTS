import { Plugin, Notice, normalizePath } from "obsidian";
import { NoxTTSSettings } from "./settings";

interface CacheEntry {
  notePath: string;
  sourceModified: number; // mtime of note when cached
  segments: number;
  audioFiles: string[]; // relative paths from vault root
  createdAt: number; // timestamp
  segmentHashes: string[]; // content hash per segment
}

interface CacheManifest {
  entries: Record<string, CacheEntry>; // key = note path
}

export class AudioCache {
  private plugin: Plugin;
  private manifest: CacheManifest = { entries: {} };
  private cacheDir: string;
  private manifestPath: string;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.cacheDir = normalizePath(
      this.plugin.app.vault.configDir + "/plugins/nox-tts/tts_cache"
    );
    this.manifestPath = normalizePath(this.cacheDir + "/manifest.json");
  }

  async initialize() {
    try {
      await this.plugin.app.vault.adapter.mkdir(
        normalizePath(this.cacheDir)
      );
    } catch {
      // Directory may already exist
    }

    try {
      const content = await this.plugin.app.vault.adapter.read(
        this.manifestPath
      );
      this.manifest = JSON.parse(content);
    } catch {
      this.manifest = { entries: {} };
    }

    // Mark cache dir as no-sync for iCloud
    try {
      await this.plugin.app.vault.adapter.write(
        normalizePath(this.cacheDir + "/.nosync"),
        ""
      );
    } catch {
      // May fail on some platforms, not critical
    }
  }

  /**
   * Generate a cache key from note path and modification time.
   */
  private getCacheKey(notePath: string): string {
    return notePath;
  }

  /**
   * Check if a valid cache entry exists for a note.
   */
  async getCacheEntry(
    notePath: string,
    noteModified: number,
    segmentHashes: string[]
  ): Promise<CacheEntry | null> {
    const entry = this.manifest.entries[this.getCacheKey(notePath)];
    if (!entry) return null;

    // Check modification time matches
    if (entry.sourceModified !== noteModified) return null;

    // Check segment count matches
    if (entry.segments !== segmentHashes.length) return null;

    // Check segment hashes match
    if (
      entry.segmentHashes.length !== segmentHashes.length ||
      !entry.segmentHashes.every((h, i) => h === segmentHashes[i])
    ) {
      return null;
    }

    // Check all audio files exist
    for (const file of entry.audioFiles) {
      const fullPath = normalizePath(this.cacheDir + "/" + file);
      if (!(await this.plugin.app.vault.adapter.exists(fullPath))) {
        return null;
      }
    }

    // Check not expired (30 days)
    if (Date.now() - entry.createdAt > 30 * 24 * 3600 * 1000) {
      await this.removeEntry(notePath);
      return null;
    }

    return entry;
  }

  /**
   * Get the absolute file system path for a cached audio file.
   */
  getAudioFilePath(relativePath: string): string {
    const adapter = this.plugin.app.vault.adapter;
    // On desktop, getBasePath gives us the vault path
    const basePath = (adapter as any).getBasePath
      ? (adapter as any).getBasePath()
      : "";
    return normalizePath(basePath + "/" + this.cacheDir + "/" + relativePath);
  }

  /**
   * Get the full URL/path that can be used to read the audio file.
   */
  getResourcePath(relativePath: string): string {
    // We need to use vault adapter to read binary data
    return normalizePath(this.cacheDir + "/" + relativePath);
  }

  /**
   * Check if a manifest entry exists and return it for reading.
   */
  hasEntry(notePath: string): boolean {
    return !!this.manifest.entries[this.getCacheKey(notePath)];
  }

  /**
   * Save a cache entry with audio data for each segment.
   */
  async saveCacheEntry(
    notePath: string,
    noteModified: number,
    segmentAudios: ArrayBuffer[],
    segmentHashes: string[]
  ): Promise<CacheEntry> {
    const key = this.getCacheKey(notePath);

    // Remove old entry if exists
    if (this.manifest.entries[key]) {
      await this.removeEntry(notePath);
    }

    const audioFiles: string[] = [];

    // Save each audio segment
    for (let i = 0; i < segmentAudios.length; i++) {
      const fileName = `${sanitizeFileName(notePath)}_${noteModified}_${i}.mp3`;
      const filePath = normalizePath(this.cacheDir + "/" + fileName);

      // Write audio data using vault adapter
      // The adapter's writeBinary is available for writing binary data
      await this.writeBinary(filePath, segmentAudios[i]);
      audioFiles.push(fileName);
    }

    const entry: CacheEntry = {
      notePath,
      sourceModified: noteModified,
      segments: segmentAudios.length,
      audioFiles,
      createdAt: Date.now(),
      segmentHashes,
    };

    this.manifest.entries[key] = entry;
    await this.saveManifest();
    await this.enforceSizeLimit();

    return entry;
  }

  /**
   * Remove a cache entry and its audio files.
   */
  async removeEntry(notePath: string) {
    const key = this.getCacheKey(notePath);
    const entry = this.manifest.entries[key];
    if (!entry) return;

    for (const file of entry.audioFiles) {
      const filePath = normalizePath(this.cacheDir + "/" + file);
      try {
        await this.plugin.app.vault.adapter.remove(filePath);
      } catch {
        // File may already be gone
      }
    }

    delete this.manifest.entries[key];
    await this.saveManifest();
  }

  /**
   * Clear all cache entries and files.
   */
  async clearAll() {
    const entries = Object.values(this.manifest.entries);

    for (const entry of entries) {
      for (const file of entry.audioFiles) {
        try {
          await this.plugin.app.vault.adapter.remove(
            normalizePath(this.cacheDir + "/" + file)
          );
        } catch {
          // ignore
        }
      }
    }

    this.manifest = { entries: {} };
    await this.saveManifest();
  }

  /**
   * Get current cache size in bytes (approximate).
   */
  async getCacheSize(): Promise<number> {
    let totalSize = 0;
    const entries = Object.values(this.manifest.entries);

    for (const entry of entries) {
      for (const file of entry.audioFiles) {
        const filePath = normalizePath(this.cacheDir + "/" + file);
        try {
          const stat = await this.plugin.app.vault.adapter.stat(filePath);
          if (stat) {
            totalSize += stat.size;
          }
        } catch {
          // File may not exist
        }
      }
    }

    return totalSize;
  }

  /**
   * Get formatted cache size string.
   */
  async getCacheSizeFormatted(): Promise<string> {
    const bytes = await this.getCacheSize();
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Entries count.
   */
  getEntryCount(): number {
    return Object.keys(this.manifest.entries).length;
  }

  private async saveManifest() {
    try {
      await this.plugin.app.vault.adapter.write(
        this.manifestPath,
        JSON.stringify(this.manifest, null, 2)
      );
    } catch {
      // Retry with mkdir
      try {
        await this.plugin.app.vault.adapter.mkdir(
          normalizePath(this.cacheDir)
        );
        await this.plugin.app.vault.adapter.write(
          this.manifestPath,
          JSON.stringify(this.manifest, null, 2)
        );
      } catch {
        // Give up silently
      }
    }
  }

  private async enforceSizeLimit() {
    const maxSize = (this.plugin as any).settings?.cacheMaxSize
      ? (this.plugin as any).settings.cacheMaxSize * 1024 * 1024
      : 500 * 1024 * 1024;

    let currentSize = await this.getCacheSize();

    if (currentSize <= maxSize) return;

    // Sort entries by creation time (oldest first = LRU)
    const sortedEntries = Object.entries(this.manifest.entries).sort(
      ([, a], [, b]) => a.createdAt - b.createdAt
    );

    for (const [key] of sortedEntries) {
      if (currentSize <= maxSize * 0.8) break; // Clear until 80% of limit
      const entry = this.manifest.entries[key];
      let entrySize = 0;
      for (const file of entry.audioFiles) {
        try {
          const stat = await this.plugin.app.vault.adapter.stat(
            normalizePath(this.cacheDir + "/" + file)
          );
          if (stat) entrySize += stat.size;
        } catch {
          // ignore
        }
      }
      await this.removeEntry(entry.notePath);
      currentSize -= entrySize;
    }
  }

  private async writeBinary(
    filePath: string,
    data: ArrayBuffer
  ): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;

    if (typeof (adapter as any).writeBinary === "function") {
      await (adapter as any).writeBinary(filePath, data);
    } else {
      // Convert ArrayBuffer to base64 in chunks to avoid stack overflow
      const base64 = arrayBufferToBase64(data);
      await adapter.write(filePath, base64);
    }
  }

  /**
   * Read a cached audio file as ArrayBuffer.
   */
  async readAudioFile(relativePath: string): Promise<ArrayBuffer | null> {
    const filePath = normalizePath(this.cacheDir + "/" + relativePath);
    try {
      const adapter = this.plugin.app.vault.adapter;
      if (typeof (adapter as any).readBinary === "function") {
        return await (adapter as any).readBinary(filePath);
      } else {
        const base64 = await adapter.read(filePath);
        return base64ToArrayBuffer(base64);
      }
    } catch {
      return null;
    }
  }
}

function sanitizeFileName(path: string): string {
  return path.replace(/[^a-zA-Z0-9一-鿿\-_]/g, "_");
}

/**
 * Simple hash function for segment content comparison.
 */
export function hashSegment(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(36);
}

/**
 * Convert ArrayBuffer to base64 string using chunked conversion
 * to avoid stack overflow with large buffers.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32KB chunks
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

/**
 * Convert base64 string back to ArrayBuffer.
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes.buffer;
}
