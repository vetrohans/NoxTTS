export interface NoxTTSSettings {
  // TTS provider
  ttsProvider: "siliconflow" | "edge-tts";

  // SiliconFlow (CosyVoice2) API settings
  siliconflowUrl: string;
  siliconflowKey: string;
  siliconflowModel: string;
  siliconflowVoice: string;
  siliconflowSampleRate: number;

  // Edge-TTS (openai-edge-tts server) settings
  edgeTtsUrl: string;
  edgeTtsVoice: string;
  edgeTtsKey: string;

  // Voice settings
  defaultSpeed: number;
  defaultVolume: number;
  previewText: string;

  // Text preprocessing settings
  filterEmoji: boolean;
  smartTableReading: boolean;
  skipCodeBlocks: boolean;
  skipFrontmatter: boolean;
  skipImageSyntax: boolean;
  skipUrl: boolean;
  skipLatex: boolean;
  quotePrefix: boolean;

  // Cache settings
  enableCache: boolean;
  cacheMaxSize: number; // MB
}

export const DEFAULT_SETTINGS: NoxTTSSettings = {
  ttsProvider: "siliconflow",

  siliconflowUrl: "https://api.siliconflow.cn/v1/audio/speech",
  siliconflowKey: "",
  siliconflowModel: "FunAudioLLM/CosyVoice2-0.5B",
  siliconflowVoice: "FunAudioLLM/CosyVoice2-0.5B:anna",
  siliconflowSampleRate: 32000,

  edgeTtsUrl: "https://tts-worker.zhaoyunsheng6215.workers.dev/v1/audio/speech",
  edgeTtsVoice: "zh-CN-XiaoxiaoNeural",
  edgeTtsKey: "abc",

  defaultSpeed: 1.0,
  defaultVolume: 1.0,
  previewText: "你永远无法叫醒一个装睡的人",

  filterEmoji: true,
  smartTableReading: true,
  skipCodeBlocks: true,
  skipFrontmatter: true,
  skipImageSyntax: true,
  skipUrl: true,
  skipLatex: true,
  quotePrefix: false,

  enableCache: true,
  cacheMaxSize: 500,
};

// SiliconFlow voices
export const SILICONFLOW_VOICES: Record<string, string> = {
  "FunAudioLLM/CosyVoice2-0.5B:anna": "Anna (女声)",
  "FunAudioLLM/CosyVoice2-0.5B:alex": "Alex (男声)",
  "FunAudioLLM/CosyVoice2-0.5B:bella": "Bella (女声)",
  "FunAudioLLM/CosyVoice2-0.5B:benjamin": "Benjamin (男声)",
  "FunAudioLLM/CosyVoice2-0.5B:charles": "Charles (男声)",
  "FunAudioLLM/CosyVoice2-0.5B:claire": "Claire (女声)",
  "FunAudioLLM/CosyVoice2-0.5B:david": "David (男声)",
  "FunAudioLLM/CosyVoice2-0.5B:diana": "Diana (女声)",
};

// Edge-TTS Chinese voices (most popular, ~200 total available)
export const EDGE_TTS_VOICES: Record<string, string> = {
  "zh-CN-XiaoxiaoNeural": "晓晓 (女声·标准)",
  "zh-CN-XiaoyiNeural": "晓伊 (女声·温柔)",
  "zh-CN-YunjianNeural": "云健 (男声·运动)",
  "zh-CN-YunxiNeural": "云希 (男声·故事)",
  "zh-CN-YunxiaNeural": "云夏 (男声·少年)",
  "zh-CN-YunyangNeural": "云扬 (男声·新闻)",
  "zh-CN-liaoning-XiaobeiNeural": "晓北 (女声·东北话)",
  "zh-CN-shaanxi-XiaoniNeural": "小妮 (女声·陕西话)",
  "zh-TW-HsiaoChenNeural": "晓辰 (女声·台湾)",
  "zh-TW-YunJheNeural": "云哲 (男声·台湾)",
  "zh-HK-HiuGaaiNeural": "晓佳 (女声·粤语)",
  "zh-HK-HiuMaanNeural": "晓曼 (女声·粤语)",
  "zh-HK-WanLungNeural": "云龙 (男声·粤语)",
};
