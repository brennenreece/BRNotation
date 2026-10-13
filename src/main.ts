import {
  App,
  MarkdownPostProcessorContext,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";

interface BRNotationSettings {
  defaultNotationType: string;
  enableLineNumbers: boolean;
  fontSize: number;
}

const DEFAULT_SETTINGS: BRNotationSettings = {
  defaultNotationType: "standard",
  enableLineNumbers: false,
  fontSize: 14,
};

export default class BRNotationPlugin extends Plugin {
  settings: BRNotationSettings;

  async onload() {
    await this.loadSettings();

    // Register custom markdown code block processor for ```brnotation
    this.registerMarkdownCodeBlockProcessor(
      "brnotation",
      (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        this.renderNotationBlock(source, el, ctx);
      }
    );

    // Register ribbon icon
    this.addRibbonIcon("pencil", "BRNotation", () => {
      new Notice("BRNotation is active!");
    });

    // Add command to insert sample notation block
    this.addCommand({
      id: "insert-brnotation-block",
      name: "Insert notation block",
      editorCallback: (editor) => {
        const sampleBlock = "```brnotation\n// Write notation here\n```\n";
        editor.replaceSelection(sampleBlock);
      },
    });

    // Add settings tab
    this.addSettingTab(new BRNotationSettingTab(this.app, this));
  }

  onunload() {
    // Cleanup if needed
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private renderNotationBlock(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ) {
    const container = el.createDiv({ cls: "br-notation-container" });
    const header = container.createDiv({ cls: "br-notation-header" });
    header.createSpan({ cls: "br-notation-title", text: "BRNotation" });

    const body = container.createDiv({ cls: "br-notation-body" });
    body.style.fontSize = `${this.settings.fontSize}px`;

    const lines = source.trim().split("\n");
    lines.forEach((line, index) => {
      const lineEl = body.createDiv({ cls: "br-notation-line" });
      if (this.settings.enableLineNumbers) {
        lineEl.createSpan({ cls: "br-notation-line-num", text: `${index + 1} ` });
      }
      lineEl.createSpan({ cls: "br-notation-content", text: line });
    });
  }
}

class BRNotationSettingTab extends PluginSettingTab {
  plugin: BRNotationPlugin;

  constructor(app: App, plugin: BRNotationPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "BRNotation Settings" });

    new Setting(containerEl)
      .setName("Default notation type")
      .setDesc("The default notation style to apply to notation blocks.")
      .addText((text) =>
        text
          .setPlaceholder("standard")
          .setValue(this.plugin.settings.defaultNotationType)
          .onChange(async (value) => {
            this.plugin.settings.defaultNotationType = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Line numbers")
      .setDesc("Display line numbers next to notation lines.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableLineNumbers)
          .onChange(async (value) => {
            this.plugin.settings.enableLineNumbers = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Font size")
      .setDesc("Font size for rendered notation blocks in pixels.")
      .addSlider((slider) =>
        slider
          .setLimits(10, 24, 1)
          .setValue(this.plugin.settings.fontSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.fontSize = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
