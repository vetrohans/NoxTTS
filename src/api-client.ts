import { requestUrl } from "obsidian";
import { NoxTTSSettings } from "./settings";

export interface SynthesisResult {
  success: boolean;
  audioData?: ArrayBuffer;
  error?: string;
  errorCode?: number;
  retryAfter?: number;
}

export class ApiClient {
  private settings: NoxTTSSettings;

  constructor(settings: NoxTTSSettings) {
    this.settings = settings;
  }

  updateSettings(settings: NoxTTSSettings) {
    this.settings = settings;
  }

  /** Current provider name for display */
  getProviderName(): string {
    return this.settings.ttsProvider === "edge-tts"
      ? "Edge-TTS"
      : "硅基流动 CosyVoice2";
  }

  /** Check if API is configured for the current provider */
  isConfigured(): boolean {
    if (this.settings.ttsProvider === "edge-tts") {
      return !!this.settings.edgeTtsUrl;
    }
    return !!this.settings.siliconflowKey;
  }

  /**
   * Build the request body based on the selected provider.
   */
  private buildRequestBody(text: string): object {
    if (this.settings.ttsProvider === "edge-tts") {
      // openai-edge-tts format (matches OpenAI TTS API)
      return {
        input: text,
        voice: this.settings.edgeTtsVoice,
        response_format: "mp3",
        speed: this.settings.defaultSpeed,
      };
    }

    // SiliconFlow CosyVoice2 format
    return {
      model: this.settings.siliconflowModel,
      input: text,
      voice: this.settings.siliconflowVoice,
      response_format: "mp3",
      speed: this.settings.defaultSpeed,
      sample_rate: this.settings.siliconflowSampleRate || 32000,
    };
  }

  /**
   * Build request options based on provider.
   */
  private getRequestOptions(text: string) {
    if (this.settings.ttsProvider === "edge-tts") {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      // Cloudflare Worker requires "abc" as default API key
      headers["Authorization"] = `Bearer ${this.settings.edgeTtsKey || "abc"}`;

      return {
        url: this.settings.edgeTtsUrl,
        method: "POST" as const,
        headers,
        body: JSON.stringify(this.buildRequestBody(text)),
        throw: false as const,
      };
    }

    return {
      url: this.settings.siliconflowUrl,
      method: "POST" as const,
      headers: {
        Authorization: `Bearer ${this.settings.siliconflowKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(this.buildRequestBody(text)),
      throw: false as const,
    };
  }

  /**
   * Synthesize a single segment of text to speech.
   */
  async synthesize(text: string): Promise<SynthesisResult> {
    if (!this.isConfigured()) {
      const msg =
        this.settings.ttsProvider === "edge-tts"
          ? "Edge-TTS 地址未配置，请先启动 openai-edge-tts 服务并填写地址"
          : "API Key 未配置，请在设置中配置硅基流动 API Key";
      return { success: false, error: msg };
    }

    if (!text.trim()) {
      return { success: false, error: "文本为空，跳过合成" };
    }

    try {
      const opts = this.getRequestOptions(text);
      const response = await requestUrl(opts);

      if (response.status === 200) {
        const audioData = response.arrayBuffer;

        if (!audioData || audioData.byteLength === 0) {
          return {
            success: false,
            error: "API 返回了空的音频数据，将重试",
            errorCode: 200,
          };
        }

        if (audioData.byteLength < 100) {
          return {
            success: false,
            error: "API 返回的音频数据异常短（可能损坏），将重试",
            errorCode: 200,
          };
        }

        return { success: true, audioData };
      }

      const errorResult: SynthesisResult = {
        success: false,
        errorCode: response.status,
      };

      switch (response.status) {
        case 400:
          errorResult.error = `请求参数错误：${text.substring(0, 50)}...（长度 ${text.length} 字）`;
          break;
        case 401:
          errorResult.error = "API Key 无效，请检查设置";
          break;
        case 429:
          errorResult.error = "请求频率超限，请稍后重试";
          errorResult.retryAfter = parseRetryAfter(
            response.headers["retry-after"]
          );
          break;
        case 500:
          errorResult.error = "服务器内部错误，请稍后重试";
          break;
        case 503:
          errorResult.error = "服务暂时不可用，请稍后重试";
          break;
        default:
          errorResult.error = `API 请求失败 (HTTP ${response.status})`;
      }

      return errorResult;
    } catch (error) {
      return {
        success: false,
        error: `网络请求失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async synthesizeWithRetry(text: string): Promise<SynthesisResult> {
    const maxRetries = 3;
    const baseDelay = 1000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await sleep(delay);
      }

      const result = await this.synthesize(text);
      if (result.success) return result;

      if (result.errorCode === 401) return result;
      if (result.errorCode === 400) return result;

      if (result.errorCode === 429 && result.retryAfter) {
        await sleep(result.retryAfter * 1000);
      }

      if (attempt === maxRetries) {
        return {
          ...result,
          error: `${result.error}（已重试 ${maxRetries} 次）`,
        };
      }
    }

    return { success: false, error: "合成失败" };
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const result = await this.synthesize("测试连接");
    if (result.success) {
      return { success: true, message: "连接成功！API 工作正常。" };
    }
    return { success: false, message: result.error || "连接失败" };
  }
}

function parseRetryAfter(header: string | undefined | null): number {
  if (!header) return 5;
  const seconds = parseInt(header, 10);
  return isNaN(seconds) ? 5 : Math.min(seconds, 60);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
