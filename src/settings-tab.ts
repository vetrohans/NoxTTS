import { PluginSettingTab, Setting, Notice, App } from "obsidian";
import { SILICONFLOW_VOICES, EDGE_TTS_VOICES, NoxTTSSettings } from "./settings";
import type NoxTTSPlugin from "../main";

export class NoxTTSSettingTab extends PluginSettingTab {
  plugin: NoxTTSPlugin;

  constructor(app: App, plugin: NoxTTSPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // === TTS Provider ===
    containerEl.createEl("h2", { text: "TTS 引擎" });

    new Setting(containerEl)
      .setName("TTS 引擎")
      .setDesc("选择语音合成服务")
      .addDropdown((dropdown) => {
        dropdown.addOption("siliconflow", "硅基流动 CosyVoice2（云端）");
        dropdown.addOption("edge-tts", "Edge-TTS（本地/免费）");
        dropdown
          .setValue(this.plugin.settings.ttsProvider)
          .onChange(async (value) => {
            this.plugin.settings.ttsProvider = value as "siliconflow" | "edge-tts";
            await this.plugin.saveSettings();
            this.plugin.syncSettings();
            this.display(); // Refresh to show/hide relevant settings
          });
      });

    // === SiliconFlow Settings ===
    if (this.plugin.settings.ttsProvider === "siliconflow") {
      this.renderSiliconFlowSettings();
    }

    // === Edge-TTS Settings ===
    if (this.plugin.settings.ttsProvider === "edge-tts") {
      this.renderEdgeTtsSettings();
    }

    // === Voice preview (shared) ===
    this.renderVoicePreview();

    // === Test connection (shared) ===
    new Setting(containerEl)
      .setName("测试连接")
      .setDesc("发送一句短文本测试当前引擎是否可用")
      .addButton((btn) =>
        btn.setButtonText("测试连接").onClick(async () => {
          btn.setButtonText("测试中...");
          btn.setDisabled(true);
          const result = await this.plugin.apiClient.testConnection();
          btn.setButtonText("测试连接");
          btn.setDisabled(false);
          if (result.success) {
            new Notice("[OK] " + result.message);
          } else {
            new Notice("[ERROR] " + result.message);
          }
        })
      );

    // === Voice Settings ===
    containerEl.createEl("h2", { text: "语音设置" });

    new Setting(containerEl)
      .setName("默认语速")
      .setDesc(`当前：${this.plugin.settings.defaultSpeed.toFixed(1)}x`)
      .addSlider((slider) =>
        slider
          .setLimits(0.5, 2.5, 0.1)
          .setValue(this.plugin.settings.defaultSpeed)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.defaultSpeed = value;
            await this.plugin.saveSettings();
            this.plugin.syncSettings();
            // Update description text
            const descEl = this.containerEl.querySelector(
              ".setting-item-description"
            );
            if (descEl) descEl.textContent = `当前：${value.toFixed(1)}x`;
          })
      );

    new Setting(containerEl)
      .setName("默认音量")
      .setDesc(`当前：${Math.round(this.plugin.settings.defaultVolume * 100)}%`)
      .addSlider((slider) =>
        slider
          .setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.defaultVolume)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.defaultVolume = value;
            await this.plugin.saveSettings();
            this.plugin.syncSettings();
          })
      );

    // === Text Preprocessing Settings ===
    containerEl.createEl("h2", { text: "文本预处理" });

    this.addToggleSetting("过滤 Emoji", "自动跳过无法朗读的表情符号", "filterEmoji");
    this.addToggleSetting("智能表格朗读", "遇到表格时自动为每个单元格添加列头前缀", "smartTableReading");
    this.addToggleSetting("跳过代码块", "不朗读 Markdown 代码块内容", "skipCodeBlocks");
    this.addToggleSetting("跳过 Frontmatter", "不朗读笔记顶部的 YAML 元数据", "skipFrontmatter");
    this.addToggleSetting("跳过图片语法", "不朗读 ![[image.png]] 和 ![alt](url)", "skipImageSyntax");
    this.addToggleSetting("跳过 URL", "跳过纯链接 URL，保留链接的显示文本", "skipUrl");
    this.addToggleSetting("跳过 LaTeX 公式", "不朗读 $ 和 $$ 包裹的数学公式", "skipLatex");
    this.addToggleSetting("引用块前缀", "在引用块前增加 引用 前缀", "quotePrefix");

    // === Cache Settings ===
    containerEl.createEl("h2", { text: "缓存设置" });

    this.addToggleSetting("启用缓存", "笔记未修改时直接播放缓存，省时省钱", "enableCache");

    new Setting(containerEl)
      .setName("缓存最大大小")
      .setDesc("单位 MB，超限后自动清理旧文件")
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.cacheMaxSize))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.cacheMaxSize = num;
              await this.plugin.saveSettings();
              this.plugin.syncSettings();
            }
          });
        text.inputEl.type = "number";
      });

    this.plugin.audioCache.getCacheSizeFormatted().then((size) => {
      const entries = this.plugin.audioCache.getEntryCount();
      new Setting(containerEl)
        .setName("当前缓存大小")
        .setDesc(`${size}，共 ${entries} 个缓存条目`)
        .addButton((btn) =>
          btn.setButtonText("清除全部缓存").onClick(async () => {
            await this.plugin.audioCache.clearAll();
            new Notice("缓存已清除");
            this.display();
          })
        );
    });

    // === Keyboard Shortcut Suggestions ===
    containerEl.createEl("h2", { text: "快捷键建议" });

    const descEl = containerEl.createEl("div", {
      cls: "setting-item-description",
    });
    descEl.innerHTML = `
      <p>在 Obsidian 设置 > 快捷键 中搜索以下命令进行绑定：</p>
      <table>
        <tr><td><strong>朗读当前笔记</strong></td><td>建议：Cmd+Shift+R</td></tr>
        <tr><td><strong>暂停/继续</strong></td><td>建议：Cmd+Shift+P</td></tr>
        <tr><td><strong>停止</strong></td><td>建议：Cmd+Shift+S</td></tr>
      </table>
    `;
  }

  // === Provider-specific sections ===

  private renderSiliconFlowSettings() {
    const { containerEl } = this;

    new Setting(containerEl)
      .setName("API 地址")
      .setDesc("硅基流动 TTS API 端点")
      .addText((text) =>
        text
          .setPlaceholder("https://api.siliconflow.cn/v1/audio/speech")
          .setValue(this.plugin.settings.siliconflowUrl)
          .onChange(async (value) => {
            this.plugin.settings.siliconflowUrl = value;
            await this.plugin.saveSettings();
            this.plugin.syncSettings();
          })
      );

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("在硅基流动平台注册获取（https://siliconflow.cn）")
      .addText((text) => {
        text
          .setPlaceholder("sk-xxxxxxxxxxxxxxxx")
          .setValue(this.plugin.settings.siliconflowKey)
          .onChange(async (value) => {
            this.plugin.settings.siliconflowKey = value;
            await this.plugin.saveSettings();
            this.plugin.syncSettings();
          });
        text.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("模型名称")
      .setDesc("TTS 模型")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.siliconflowModel)
          .onChange(async (value) => {
            this.plugin.settings.siliconflowModel = value;
            await this.plugin.saveSettings();
            this.plugin.syncSettings();
          })
      );

    new Setting(containerEl)
      .setName("默认音色")
      .setDesc("CosyVoice2 支持的音色 / 说话人")
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(SILICONFLOW_VOICES)) {
          dropdown.addOption(value, label);
        }
        dropdown
          .setValue(this.plugin.settings.siliconflowVoice)
          .onChange(async (value) => {
            this.plugin.settings.siliconflowVoice = value;
            await this.plugin.saveSettings();
            this.plugin.syncSettings();
          });
      });
  }

  private renderEdgeTtsSettings() {
    const { containerEl } = this;

    new Setting(containerEl)
      .setName("Edge-TTS 服务地址")
      .setDesc(
        "openai-edge-tts 服务地址。本地运行: docker run -d -p 5050:5050 travisvn/openai-edge-tts"
      )
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:5050/v1/audio/speech")
          .setValue(this.plugin.settings.edgeTtsUrl)
          .onChange(async (value) => {
            this.plugin.settings.edgeTtsUrl = value;
            await this.plugin.saveSettings();
            this.plugin.syncSettings();
          })
      );

    new Setting(containerEl)
      .setName("Edge-TTS 音色")
      .setDesc("Microsoft Edge 免费语音，200+ 可选")
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(EDGE_TTS_VOICES)) {
          dropdown.addOption(value, label);
        }
        dropdown
          .setValue(this.plugin.settings.edgeTtsVoice)
          .onChange(async (value) => {
            this.plugin.settings.edgeTtsVoice = value;
            await this.plugin.saveSettings();
            this.plugin.syncSettings();
          });
      });
  }

  // === Shared preview ===

  private renderVoicePreview() {
    const { containerEl } = this;
    const previewContainer = new Setting(containerEl)
      .setName("音色试听")
      .setDesc("输入试听文本，点击播放按钮预览所选音色");

    let previewInput: HTMLInputElement;
    let previewBtn: HTMLButtonElement;
    let previewAudio: HTMLAudioElement | null = null;

    previewContainer.addText((text) => {
      previewInput = text.inputEl;
      text
        .setValue(this.plugin.settings.previewText)
        .onChange(async (value) => {
          this.plugin.settings.previewText = value;
          await this.plugin.saveSettings();
        });
      text.inputEl.style.width = "220px";
    });

    previewContainer.addButton((btn) => {
      previewBtn = btn.buttonEl;
      btn.setButtonText("> 试听").onClick(async () => {
        const text = (previewInput?.value || "").trim();
        if (!text) {
          new Notice("请先输入试听文本");
          return;
        }
        if (!this.plugin.apiClient.isConfigured()) {
          const msg =
            this.plugin.settings.ttsProvider === "edge-tts"
              ? "请先配置 Edge-TTS 服务地址"
              : "请先填写 API Key";
          new Notice(msg);
          return;
        }

        if (previewAudio) {
          previewAudio.pause();
          previewAudio.remove();
          previewAudio = null;
        }

        btn.setButtonText("合成中...");
        btn.setDisabled(true);

        try {
          const result = await this.plugin.apiClient.synthesize(text);
          if (result.success && result.audioData) {
            const blob = new Blob([result.audioData], { type: "audio/mp3" });
            const url = URL.createObjectURL(blob);
            previewAudio = new Audio(url);
            previewAudio.playbackRate = this.plugin.settings.defaultSpeed;
            previewAudio.addEventListener("ended", () => {
              URL.revokeObjectURL(url);
              previewAudio = null;
              btn.setButtonText("> 试听");
              btn.setDisabled(false);
            });
            previewAudio.addEventListener("error", () => {
              URL.revokeObjectURL(url);
              previewAudio = null;
              btn.setButtonText("> 试听");
              btn.setDisabled(false);
              new Notice("播放失败");
            });
            previewAudio.play();
            btn.setButtonText("|| 播放中...");
            btn.setDisabled(false);
          } else {
            new Notice("[ERROR] " + (result.error || "合成失败"));
            btn.setButtonText("> 试听");
            btn.setDisabled(false);
          }
        } catch (e) {
          new Notice("[ERROR] " + (e instanceof Error ? e.message : "请求失败"));
          btn.setButtonText("> 试听");
          btn.setDisabled(false);
        }
      });
    });
  }

  // === Helpers ===

  private addToggleSetting(name: string, desc: string, key: keyof NoxTTSSettings) {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings[key] as boolean)
          .onChange(async (value) => {
            (this.plugin.settings as any)[key] = value;
            await this.plugin.saveSettings();
            this.plugin.syncSettings();
          })
      );
  }
}
