import {
  App,
  Editor,
  MarkdownPostProcessorContext,
  MarkdownRenderer,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";
import { AudioSynthesizer } from "./audio/audioSynthesizer";
import helpMarkdown from "../HELP.md";
import { parseBRNotationBlock } from "./parser/dslParser";
import type { DiagramDotStyle } from "./types";
import { TUNING_PRESETS } from "./parser/scales";
import { renderChordGrid } from "./renderer/chordGridRenderer";
import { renderChordDiagram,
  renderChordBoxes, renderFretboardScale } from "./renderer/fretboardRenderer";
import { renderVexflowScore } from "./renderer/vexflowRenderer";
import { renderGlyphScore } from "./renderer/glyphRenderer";
import { VexFlow } from "vexflow";
import { CHORD_FONT_OPTIONS, STAFF_FONT_OPTIONS, TAB_FONT_OPTIONS, applyChordFont, loadBundledFonts, resolveFontFamily } from "./fonts/musicFonts";
import { MetricsDefaults } from "vexflow";

interface BRNotationPluginSettings {
  defaultTuning: string;
  defaultClef: string;
  enableAudio: boolean;
  defaultScaleFrets: number;
  maxMeasuresPerLine: number;
  chordFont: string;
  chordFontSize: number;
  staffFont: string;
  tabFont: string;
  tabFontSize: number;
  tabNumberOffset: number;
  spacingScale: number;
  systemGap: number;
  chordDistance: number;
  diagramStyle: DiagramDotStyle;
}

const DEFAULT_SETTINGS: BRNotationPluginSettings = {
  defaultTuning: "standard",
  defaultClef: "treble",
  enableAudio: true,
  defaultScaleFrets: 12,
  maxMeasuresPerLine: 4,
  chordFont: "system",
  chordFontSize: 16,
  staffFont: "bravura",
  tabFont: "system",
  tabFontSize: 13,
  tabNumberOffset: 0,
  spacingScale: 1,
  systemGap: 20,
  chordDistance: 8,
  diagramStyle: "classic",
};

export default class BRNotationPlugin extends Plugin {
  settings: BRNotationPluginSettings;

  async onload() {
    await this.loadSettings();
    await loadBundledFonts();

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
        const sample = "```brnotation\nmode: tab\ntuning: standard\n\n| :q 1/1 2/1 3/1 5/1 | :h 2/1 0/2 |\n```\n";
        editor.replaceSelection(sample);
      },
    });

    // Command: Insert coupled notation + tab
    this.addCommand({
      id: "insert-coupled-notation-tab",
      name: "Insert coupled notation and tab block",
      editorCallback: (editor: Editor) => {
        const sample = "```brnotation\nmode: coupled\ntitle: Autumn Leaves Theme\ntime: 4/4\nkey: G\n\n| :q e4(1/1) f#4(2/1) g4(3/1) a4(5/1) | :h f#4(2/1) d4(0/2) |\n```\n";
        editor.replaceSelection(sample);
      },
    });

    // Command: Insert chord grid
    this.addCommand({
      id: "insert-chord-grid",
      name: "Insert chord chart",
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
    if (this.settings.chordFont === "jazz") this.settings.chordFont = "julesjazz";
    AudioSynthesizer.getInstance().setMuted(!this.settings.enableAudio);
    this.applyFontSettings();
  }

  async saveSettings() {
    await this.saveData(this.settings);
    AudioSynthesizer.getInstance().setMuted(!this.settings.enableAudio);
    this.applyFontSettings();
    // Re-render open notes so the new font shows immediately.
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) leaf.view.previewMode?.rerender(true);
    });
  }

  /** Applies the chord and staff font choices to the document and VexFlow. */
  applyFontSettings() {
    applyChordFont(this.settings.chordFont, this.settings.chordFontSize);
    const staff = STAFF_FONT_OPTIONS[this.settings.staffFont] ?? STAFF_FONT_OPTIONS.bravura;
    VexFlow.setFonts(staff.vexflow);
    MetricsDefaults.NoteHead.fontScale = staff.noteheadScale;
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

    // Show the title for notation, tab, and coupled blocks. Other modes keep the header hidden.
    const isStaffMode = !!parsed.notationScore;
    const hasStaffTitle = isStaffMode && !!parsed.notationScore?.title;
    if (hasStaffTitle) {
      header.createEl("h3", { text: titleText, cls: "br-notation-title" });
    } else {
      header.style.display = "none";
    }

    // Body
    const body = container.createDiv({ cls: "br-notation-body" });

    // Show tokens the parser could not read, so typos are visible instead of silently dropped.
    if (parsed.errors && parsed.errors.length > 0) {
      const warn = container.createDiv({ cls: "br-notation-errors" });
      for (const msg of parsed.errors) warn.createDiv({ text: msg });
    }

    try {
      if (parsed.mode === "chordgrid" && parsed.chordGridScore) {
        renderChordGrid(body, parsed.chordGridScore);
      } else if (parsed.mode === "chord" && parsed.chordDiagram) {
        const boxes = (parsed.chordDiagrams ?? [parsed.chordDiagram]).map((box) => ({
          ...box,
          dotStyle: box.dotStyle ?? this.settings.diagramStyle,
        }));
        renderChordBoxes(body, boxes, parsed.chordColumns, parsed.chordSize, parsed.chordAlign);
        const fontKey = parsed.chordFont ?? this.settings.chordFont;
        const fontFamily = CHORD_FONT_OPTIONS[fontKey]?.family ?? CHORD_FONT_OPTIONS.system.family;
        body.style.setProperty("--br-chord-box-font", fontFamily);
      } else if (parsed.mode === "fretboard" && parsed.fretboardScale) {
        renderFretboardScale(body, { ...parsed.fretboardScale, dotStyle: parsed.fretboardScale.dotStyle ?? this.settings.diagramStyle });
      } else if (parsed.notationScore?.render === "font") {
        renderGlyphScore(body, parsed.notationScore, {
          maxMeasuresPerLine: this.settings.maxMeasuresPerLine,
          fontFamily: STAFF_FONT_OPTIONS[this.settings.staffFont]?.vexflow ?? "Bravura",
          tabFontFamily: resolveFontFamily(TAB_FONT_OPTIONS[this.settings.tabFont]?.family ?? TAB_FONT_OPTIONS.system.family),
          tabFontSize: this.settings.tabFontSize,
          tabNumberOffset: this.settings.tabNumberOffset,
          spacingScale: this.settings.spacingScale,
          systemGap: this.settings.systemGap,
          chordDistance: this.settings.chordDistance,
        });
      } else if (parsed.notationScore) {
        renderVexflowScore(body, parsed.notationScore, {
          maxMeasuresPerLine: this.settings.maxMeasuresPerLine,
          staffFontFamily: STAFF_FONT_OPTIONS[this.settings.staffFont]?.vexflow ?? "Bravura",
          noteheadScale: STAFF_FONT_OPTIONS[this.settings.staffFont]?.noteheadScale ?? 1,
          tabFontFamily: resolveFontFamily(TAB_FONT_OPTIONS[this.settings.tabFont]?.family ?? TAB_FONT_OPTIONS.system.family),
          tabFontSize: this.settings.tabFontSize,
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
      .setName("Chord symbol font")
      .setDesc("Font used for chord names in chord charts and chord grids.")
      .addDropdown((dd) => {
        for (const [key, opt] of Object.entries(CHORD_FONT_OPTIONS)) dd.addOption(key, opt.label);
        dd.setValue(this.plugin.settings.chordFont).onChange(async (val) => {
          this.plugin.settings.chordFont = val;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Diagram dot style")
      .setDesc("Default dot style for chord boxes and fretboard maps. A block's style: line or a note's {style} overrides this.")
      .addDropdown((dd) => {
        dd.addOption("classic", "Classic (root filled, others outlined)");
        dd.addOption("filled", "Filled");
        dd.addOption("outlined", "Outlined");
        dd.addOption("ghost", "Ghost (dashed)");
        dd.addOption("accent-outline", "Accent outline");
        dd.addOption("tone-ring", "Tone ring (thick outline)");
        dd.addOption("muted", "Muted (low contrast)");
        dd.addOption("square", "Square");
        dd.addOption("diamond", "Diamond");
        dd.addOption("numbered-role", "Numbered role (degree labels)");
        dd.addOption("inverted", "Inverted (dark dot, light label)");
        dd.setValue(this.plugin.settings.diagramStyle).onChange(async (val) => {
          this.plugin.settings.diagramStyle = val as DiagramDotStyle;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Chord symbol font size")
      .setDesc("Base size in pixels for chord names. Jazz fonts are scaled up from this value automatically.")
      .addSlider((slider) => {
        slider
          .setLimits(10, 32, 1)
          .setValue(this.plugin.settings.chordFontSize)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.chordFontSize = val;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Staff notation font")
      .setDesc("Music font used for staff and tablature notation. Changes apply to newly rendered blocks.")
      .addDropdown((dd) => {
        for (const [key, opt] of Object.entries(STAFF_FONT_OPTIONS)) dd.addOption(key, opt.label);
        dd.setValue(this.plugin.settings.staffFont).onChange(async (val) => {
          this.plugin.settings.staffFont = val;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Tab number font")
      .setDesc("Font for fret numbers on tablature. Changes apply to newly rendered blocks.")
      .addDropdown((dd) => {
        for (const [key, opt] of Object.entries(TAB_FONT_OPTIONS)) dd.addOption(key, opt.label);
        dd.setValue(this.plugin.settings.tabFont).onChange(async (val) => {
          this.plugin.settings.tabFont = val;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Tab number font size")
      .setDesc("Size in points for fret numbers on tablature (default 13). Tab lines widen automatically when the numbers are large enough to overlap in chords.")
      .addSlider((sl) =>
        sl
          .setLimits(8, 24, 1)
          .setValue(this.plugin.settings.tabFontSize)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.tabFontSize = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Tab number vertical offset")
      .setDesc("Shift fret numbers up (negative) or down (positive), in px. Use 0 to centre them on the string lines (default).")
      .addSlider((sl) =>
        sl
          .setLimits(-6, 6, 0.5)
          .setValue(this.plugin.settings.tabNumberOffset)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.tabNumberOffset = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Spacing after barlines and time signature")
      .setDesc("Scales the space after barlines and after the time signature in staff notation. 1 is the default; raise it for more room.")
      .addSlider((sl) =>
        sl
          .setLimits(0.5, 3, 0.1)
          .setValue(this.plugin.settings.spacingScale)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.spacingScale = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Space between systems")
      .setDesc("Vertical space in pixels between staff systems (lines) in staff notation. Raise it to separate lines more after breaks.")
      .addSlider((sl) =>
        sl
          .setLimits(0, 120, 2)
          .setValue(this.plugin.settings.systemGap)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.systemGap = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Chord symbol distance")
      .setDesc("Vertical space in pixels between the top staff line and chord symbols above it in staff notation.")
      .addSlider((sl) =>
        sl
          .setLimits(0, 40, 1)
          .setValue(this.plugin.settings.chordDistance)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.chordDistance = val;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h2", { text: "User Guide" });
    const helpEl = containerEl.createDiv({ cls: "br-settings-help" });
    void MarkdownRenderer.render(this.app, helpMarkdown, helpEl, "", this.plugin);
  }
}
