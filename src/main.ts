import {
  App,
  Editor,
  MarkdownPostProcessorContext,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";
import { AudioSynthesizer } from "./audio/audioSynthesizer";
import { parseBRNotationBlock } from "./parser/dslParser";
import { TUNING_PRESETS } from "./parser/scales";
import { renderChordGrid } from "./renderer/chordGridRenderer";
import { renderChordDiagram, renderFretboardScale } from "./renderer/fretboardRenderer";
import { renderVexflowScore } from "./renderer/vexflowRenderer";

interface BRNotationPluginSettings {
  defaultTuning: string;
  defaultClef: string;
  enableAudio: boolean;
  defaultScaleFrets: number;
  maxMeasuresPerLine: number;
  tabLineSpacing: number;
}

const DEFAULT_SETTINGS: BRNotationPluginSettings = {
  defaultTuning: "standard",
  defaultClef: "treble",
  enableAudio: true,
  defaultScaleFrets: 12,
  maxMeasuresPerLine: 4,
  tabLineSpacing: 16,
};

export default class BRNotationPlugin extends Plugin {
  settings: BRNotationPluginSettings;

  async onload() {
    await this.loadSettings();

    // Register Markdown Code Block Processor for ```brnotation
    this.registerMarkdownCodeBlockProcessor(
      "brnotation",
      (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        this.renderNotationBlock(source, el, ctx);
      }
    );

    // Command: Insert standard notation
    this.addCommand({
      id: "insert-standard-notation",
      name: "Insert standard notation block",
      editorCallback: (editor: Editor) => {
        const sample = "```brnotation\nmode: notation\ntime: 4/4\nkey: C\n\n| c4/q d4/q e4/q f4/q | g4/h g4/h |\n```\n";
        editor.replaceSelection(sample);
      },
    });

    // Command: Insert tablature
    this.addCommand({
      id: "insert-tablature",
      name: "Insert guitar tablature block",
      editorCallback: (editor: Editor) => {
        const sample = "```brnotation\nmode: tab\ntuning: standard\n\n| 0:1/q 2:1/q 3:1/q 5:1/q | 2:1/h 0:2/h |\n```\n";
        editor.replaceSelection(sample);
      },
    });

    // Command: Insert coupled notation + tab
    this.addCommand({
      id: "insert-coupled-notation-tab",
      name: "Insert coupled notation and tab block",
      editorCallback: (editor: Editor) => {
        const sample = "```brnotation\nmode: coupled\ntitle: Autumn Leaves Theme\ntime: 4/4\nkey: G\n\n| e4(0:1)/q f#4(2:1)/q g4(3:1)/q a4(5:1)/q | f#4(2:1)/h d4(0:2)/h |\n```\n";
        editor.replaceSelection(sample);
      },
    });

    // Command: Insert chord grid
    this.addCommand({
      id: "insert-chord-grid",
      name: "Insert lead-sheet chord grid",
      editorCallback: (editor: Editor) => {
        const sample = "```brnotation\ntype: chordgrid\ntitle: 12-Bar Blues\ntime: 4/4\nper-row: 4\n\n[Blues]\n|: C7 | F7 | C7 | C7 :|\n| F7 | F7 | C7 | A7 |\n| Dm7 | G7 | C7 A7 | Dm7 G7 |\n```\n";
        editor.replaceSelection(sample);
      },
    });

    // Command: Insert chord diagram
    this.addCommand({
      id: "insert-chord-diagram",
      name: "Insert chord diagram",
      editorCallback: (editor: Editor) => {
        const sample = "```brnotation\ntype: chord\nname: Am7\nfrets: x 0 2 0 1 0\nfingers: - - 2 - 1 -\nbase-fret: 1\n```\n";
        editor.replaceSelection(sample);
      },
    });

    // Command: Insert fretboard scale map
    this.addCommand({
      id: "insert-fretboard-scale",
      name: "Insert fretboard scale diagram",
      editorCallback: (editor: Editor) => {
        const sample = "```brnotation\ntype: fretboard\ntitle: A Minor Pentatonic\nroot: A\nscale: minor-pentatonic\nfrets: 0-12\nshow: degrees\n```\n";
        editor.replaceSelection(sample);
      },
    });

    // Settings tab
    this.addSettingTab(new BRNotationSettingTab(this.app, this));
  }

  onunload() {
    // Teardown
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    AudioSynthesizer.getInstance().setMuted(!this.settings.enableAudio);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    AudioSynthesizer.getInstance().setMuted(!this.settings.enableAudio);
  }

  /** Render the parsed block into the note document */
  private renderNotationBlock(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ) {
    el.empty();
    const container = el.createDiv({ cls: "br-notation-container" });

    // Header bar
    const header = container.createDiv({ cls: "br-notation-header" });
    const parsed = parseBRNotationBlock(source);

    const titleText =
      parsed.notationScore?.title ||
      parsed.chordGridScore?.title ||
      parsed.fretboardScale?.title ||
      (parsed.mode === "chord" ? parsed.chordDiagram?.name : null) ||
      `BRNotation [${parsed.mode.toUpperCase()}]`;

    // Create h3 element for the title
    const titleEl = header.createEl("h3", { text: titleText });
    titleEl.style.margin = "0";

    // Body
    const body = container.createDiv({ cls: "br-notation-body" });

    // Hide header if not needed or just remove it to maximize space
    header.style.display = "none";

    try {
      if (parsed.mode === "chordgrid" && parsed.chordGridScore) {
        renderChordGrid(body, parsed.chordGridScore);
      } else if (parsed.mode === "chord" && parsed.chordDiagram) {
        renderChordDiagram(body, parsed.chordDiagram);
      } else if (parsed.mode === "fretboard" && parsed.fretboardScale) {
        renderFretboardScale(body, parsed.fretboardScale);
      } else if (parsed.notationScore) {
        renderVexflowScore(body, parsed.notationScore, {
          maxMeasuresPerLine: this.settings.maxMeasuresPerLine,
          tabLineSpacing: this.settings.tabLineSpacing,
        });
      }
    } catch (err) {
      body.createDiv({
        cls: "br-notation-error",
        text: `Error rendering notation: ${err}`,
      });
    }
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
      .setName("Default Instrument Tuning")
      .setDesc("Default string tuning for tablature and fretboard diagrams.")
      .addDropdown((dd) => {
        dd.addOption("standard", "Guitar Standard (E A D G B E)");
        dd.addOption("drop-d", "Guitar Drop D (D A D G B E)");
        dd.addOption("dadgad", "Guitar DADGAD (D A D G A D)");
        dd.addOption("bass-4", "Bass 4-string (E A D G)");
        dd.addOption("bass-5", "Bass 5-string (B E A D G)");
        dd.addOption("ukulele", "Ukulele Standard (G C E A)");
        dd.setValue(this.plugin.settings.defaultTuning);
        dd.onChange(async (val) => {
          this.plugin.settings.defaultTuning = val;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Audio Auditioning & Playback")
      .setDesc("Enable real-time audio playback when clicking keys, frets, and notes in the editor.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableAudio);
        toggle.onChange(async (val) => {
          this.plugin.settings.enableAudio = val;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Default Clef")
      .setDesc("Default musical clef for standard notation.")
      .addDropdown((dd) => {
        dd.addOption("treble", "Treble (G Clef)");
        dd.addOption("bass", "Bass (F Clef)");
        dd.addOption("alto", "Alto (C Clef)");
        dd.setValue(this.plugin.settings.defaultClef);
        dd.onChange(async (val) => {
          this.plugin.settings.defaultClef = val;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Maximum measures per line")
      .setDesc("Most measures placed on one system. Narrow windows still show fewer per line so measures stay legible.")
      .addSlider((slider) => {
        slider
          .setLimits(1, 8, 1)
          .setValue(this.plugin.settings.maxMeasuresPerLine)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.maxMeasuresPerLine = val;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Tab line spacing")
      .setDesc("Vertical distance in pixels between tablature string lines. Default is 16.")
      .addSlider((slider) => {
        slider
          .setLimits(10, 24, 1)
          .setValue(this.plugin.settings.tabLineSpacing)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.tabLineSpacing = val;
            await this.plugin.saveSettings();
          });
      });
  }
}
