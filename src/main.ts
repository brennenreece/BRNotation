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
import { NotationEditorModal } from "./editor/editorModal";
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
}

const DEFAULT_SETTINGS: BRNotationPluginSettings = {
  defaultTuning: "standard",
  defaultClef: "treble",
  enableAudio: true,
  defaultScaleFrets: 12,
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

    // Register ribbon icon
    this.addRibbonIcon("music", "BRNotation: Insert Notation", () => {
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView) {
        this.openEditorModalForSource(activeView.editor, "");
      } else {
        new Notice("Open a markdown note to insert notation.");
      }
    });

    // Command: Open visual notation editor
    this.addCommand({
      id: "open-notation-editor",
      name: "Open visual notation editor",
      editorCallback: (editor: Editor) => {
        this.openEditorModalForSource(editor, "");
      },
    });

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

    // Header bar with Edit button
    const header = container.createDiv({ cls: "br-notation-header" });
    const parsed = parseBRNotationBlock(source);

    const titleText =
      parsed.notationScore?.title ||
      parsed.chordGridScore?.title ||
      parsed.fretboardScale?.title ||
      (parsed.mode === "chord" ? parsed.chordDiagram?.name : null) ||
      `BRNotation [${parsed.mode.toUpperCase()}]`;
    header.createSpan({ cls: "br-notation-title", text: titleText });

    const actions = header.createDiv({ cls: "br-notation-actions" });

    // Edit button to launch full interactive visual editor
    const editBtn = actions.createEl("button", {
      cls: "br-edit-action-btn",
      text: "✏ Edit",
    });
    editBtn.addEventListener("click", () => {
      new NotationEditorModal(this.app, source, (newContent) => {
        this.updateBlockInFile(ctx, source, newContent);
      }).open();
    });

    // Body
    const body = container.createDiv({ cls: "br-notation-body" });

    try {
      if (parsed.mode === "chordgrid" && parsed.chordGridScore) {
        renderChordGrid(body, parsed.chordGridScore);
      } else if (parsed.mode === "chord" && parsed.chordDiagram) {
        renderChordDiagram(body, parsed.chordDiagram);
      } else if (parsed.mode === "fretboard" && parsed.fretboardScale) {
        renderFretboardScale(body, parsed.fretboardScale);
      } else if (parsed.notationScore) {
        renderVexflowScore(body, parsed.notationScore);
      }
    } catch (err) {
      body.createDiv({
        cls: "br-notation-error",
        text: `Error rendering notation: ${err}`,
      });
    }
  }

  /** Open visual editor modal and insert new block into note */
  private openEditorModalForSource(editor: Editor, initialSource: string) {
    const defaultBlock =
      initialSource ||
      "mode: coupled\ntime: 4/4\nkey: C\n\n| c4(0:2)/q d4(2:2)/q e4(0:1)/q f4(1:1)/q | g4(3:1)/h g4(3:1)/h |\n";

    new NotationEditorModal(this.app, defaultBlock, (newContent) => {
      const wrapped = `\`\`\`brnotation\n${newContent.trim()}\n\`\`\`\n`;
      editor.replaceSelection(wrapped);
    }).open();
  }

  /** Replace updated block content inside note file */
  private async updateBlockInFile(
    ctx: MarkdownPostProcessorContext,
    oldSource: string,
    newContent: string
  ) {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!file || !("extension" in file)) return;

    try {
      const fileData = await this.app.vault.read(file as any);
      const targetOld = `\`\`\`brnotation\n${oldSource.trim()}\n\`\`\``;
      const targetNew = `\`\`\`brnotation\n${newContent.trim()}\n\`\`\``;

      if (fileData.includes(targetOld)) {
        const updated = fileData.replace(targetOld, targetNew);
        await this.app.vault.modify(file as any, updated);
      } else {
        const innerOld = oldSource.trim();
        if (fileData.includes(innerOld)) {
          const updated = fileData.replace(innerOld, newContent.trim());
          await this.app.vault.modify(file as any, updated);
        }
      }
    } catch (e) {
      new Notice(`Failed to update note: ${e}`);
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
  }
}
