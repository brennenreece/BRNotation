/**
 * Interactive Full-Screen Visual Notation Editor Modal (Soundslice / Dorico inspired)
 */
import { App, Modal, Notice, Setting } from "obsidian";
import { AudioSynthesizer } from "../audio/audioSynthesizer";
import { parseBRNotationBlock } from "../parser/dslParser";
import { midiToNote, noteToMidi, stringFretToMidi, TUNING_PRESETS } from "../parser/scales";
import { renderChordGrid } from "../renderer/chordGridRenderer";
import { renderChordDiagram, renderFretboardScale } from "../renderer/fretboardRenderer";
import { renderVexflowScore } from "../renderer/vexflowRenderer";
import {
  ChordGridScore,
  DurationType,
  NotationScore,
  ParsedBlock,
  ScoreMeasure,
  ScoreNote,
} from "../types";
import { FretboardWidget } from "./fretboardWidget";
import { NoteEntryPalette, NoteEntryState } from "./palette";
import { PianoWidget } from "./pianoWidget";

export class NotationEditorModal extends Modal {
  private rawText: string;
  private onSave: (newContent: string) => void;
  private parsed: ParsedBlock;
  private activeMeasureIndex: number = 0;
  private activeNoteIndex: number = 0;
  private activeStringIndex: number = 1; // 1-based, string 1 is high E
  private activeOctave: number = 4;
  private isPlaying: boolean = false;
  private playbackTimer: any = null;
  private tempoBpm: number = 120;

  private scoreContainerEl!: HTMLElement;
  private palette!: NoteEntryPalette;
  private pianoWidget!: PianoWidget;
  private fretboardWidget!: FretboardWidget;
  private audio: AudioSynthesizer;
  private keyListener!: (e: KeyboardEvent) => void;

  constructor(app: App, rawText: string, onSave: (newContent: string) => void) {
    super(app);
    this.rawText = rawText;
    this.onSave = onSave;
    this.audio = AudioSynthesizer.getInstance();
    this.parsed = parseBRNotationBlock(rawText);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("br-editor-modal-content");

    // Modal Title & Top Actions Bar
    const headerEl = contentEl.createDiv({ cls: "br-editor-header" });
    headerEl.createEl("h2", { text: "BRNotation Visual Editor" });

    const headerActions = headerEl.createDiv({ cls: "br-editor-header-actions" });

    // Mode indicator / selector
    const modeBadge = headerActions.createSpan({
      cls: "br-editor-mode-badge",
      text: `Mode: ${this.parsed.mode.toUpperCase()}`,
    });

    // Playback Transport
    const playBtn = headerActions.createEl("button", {
      cls: "mod-cta br-transport-btn",
      text: "▶ Play",
    });
    playBtn.addEventListener("click", () => this.togglePlayback(playBtn));

    // Save & Close button
    const saveBtn = headerActions.createEl("button", {
      cls: "mod-cta br-save-btn",
      text: "Save to Note",
    });
    saveBtn.addEventListener("click", () => {
      this.saveAndClose();
    });

    // 1. Note Entry Palette (durations, accidentals, modifiers)
    const paletteWrapper = contentEl.createDiv({ cls: "br-editor-palette-wrapper" });
    this.palette = new NoteEntryPalette(paletteWrapper);

    // 2. Main Interactive Score Area
    this.scoreContainerEl = contentEl.createDiv({ cls: "br-editor-score-viewport" });
    this.renderScore();

    // 3. Bottom Dock: Interactive Piano and Guitar Fretboard
    const dockContainer = contentEl.createDiv({ cls: "br-editor-dock-container" });
    const dockTabs = dockContainer.createDiv({ cls: "br-dock-tabs" });
    const pianoTabBtn = dockTabs.createEl("button", { cls: "br-dock-tab is-active", text: "Piano Keyboard" });
    const fretTabBtn = dockTabs.createEl("button", { cls: "br-dock-tab", text: "Guitar Fretboard" });

    const dockContent = dockContainer.createDiv({ cls: "br-dock-content" });
    const pianoPane = dockContent.createDiv({ cls: "br-dock-pane is-active" });
    const fretPane = dockContent.createDiv({ cls: "br-dock-pane" });

    pianoTabBtn.addEventListener("click", () => {
      pianoTabBtn.addClass("is-active");
      fretTabBtn.removeClass("is-active");
      pianoPane.addClass("is-active");
      fretPane.removeClass("is-active");
    });

    fretTabBtn.addEventListener("click", () => {
      fretTabBtn.addClass("is-active");
      pianoTabBtn.removeClass("is-active");
      fretPane.addClass("is-active");
      pianoPane.removeClass("is-active");
    });

    // Initialize Piano Widget
    this.pianoWidget = new PianoWidget(pianoPane);
    this.pianoWidget.onNoteInput((e) => {
      this.insertPitchAtCursor(e.step, e.accidental, e.octave);
    });

    // Initialize Fretboard Widget
    const tuning = this.parsed.notationScore?.tuning || TUNING_PRESETS.standard.notes;
    this.fretboardWidget = new FretboardWidget(fretPane, tuning);
    this.fretboardWidget.onFretInput((e) => {
      this.insertTabAtCursor(e.str, e.fret, e.step, e.accidental, e.octave);
    });

    // Setup direct keyboard typing
    this.setupKeyboardShortcuts();
  }

  onClose() {
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
    window.removeEventListener("keydown", this.keyListener);
    this.contentEl.empty();
  }

  /** Render the active score in the modal */
  private renderScore() {
    this.scoreContainerEl.empty();

    if (this.parsed.mode === "chordgrid" && this.parsed.chordGridScore) {
      renderChordGrid(this.scoreContainerEl, this.parsed.chordGridScore, {
        interactive: true,
        activeMeasureIndex: this.activeMeasureIndex,
        onMeasureClick: (mIdx) => {
          this.activeMeasureIndex = mIdx;
          this.renderScore();
        },
      });
    } else if (this.parsed.mode === "chord" && this.parsed.chordDiagram) {
      renderChordDiagram(this.scoreContainerEl, this.parsed.chordDiagram);
    } else if (this.parsed.mode === "fretboard" && this.parsed.fretboardScale) {
      renderFretboardScale(this.scoreContainerEl, this.parsed.fretboardScale, {
        onNoteClick: (s, f) => {
          const tuning = this.parsed.fretboardScale?.tuning || TUNING_PRESETS.standard.notes;
          const openNote = tuning[s];
          const midi = stringFretToMidi(openNote, f);
          this.audio.playNote(midi);
        },
      });
    } else if (this.parsed.notationScore) {
      renderVexflowScore(this.scoreContainerEl, this.parsed.notationScore, {
        interactive: true,
        activeMeasureIndex: this.activeMeasureIndex,
        activeNoteIndex: this.activeNoteIndex,
        onNoteClick: (mIdx, nIdx) => {
          this.activeMeasureIndex = mIdx;
          this.activeNoteIndex = nIdx;
          this.renderScore();
        },
      });
    }
  }

  /** Insert pitch at current cursor position */
  private insertPitchAtCursor(
    step: "c" | "d" | "e" | "f" | "g" | "a" | "b",
    accidental: "#" | "b" | "n" | undefined,
    octave: number
  ) {
    if (!this.parsed.notationScore) return;
    const pState = this.palette.getState();
    const measures = this.parsed.notationScore.measures;
    if (measures.length === 0) return;

    const measure = measures[this.activeMeasureIndex] || measures[0];
    const newNote: ScoreNote = {
      id: "note-" + Math.random().toString(36).substring(2, 9),
      duration: pState.duration,
      isRest: pState.isRest,
      dots: pState.dots,
      tied: pState.tied,
      pitches: [{ step, accidental: accidental || (pState.accidental as any), octave }],
      articulations: pState.articulation ? [pState.articulation] : undefined,
    };

    // Insert or replace at activeNoteIndex
    if (measure.notes.length > 0 && this.activeNoteIndex < measure.notes.length) {
      measure.notes[this.activeNoteIndex] = newNote;
    } else {
      measure.notes.push(newNote);
    }

    // Move cursor right
    this.advanceCursor();
    this.renderScore();
  }

  /** Insert tab position at cursor position */
  private insertTabAtCursor(
    str: number,
    fret: number,
    step: "c" | "d" | "e" | "f" | "g" | "a" | "b",
    accidental: "#" | "b" | "n" | undefined,
    octave: number
  ) {
    if (!this.parsed.notationScore) return;
    const pState = this.palette.getState();
    const measures = this.parsed.notationScore.measures;
    if (measures.length === 0) return;

    const measure = measures[this.activeMeasureIndex] || measures[0];
    const newNote: ScoreNote = {
      id: "note-" + Math.random().toString(36).substring(2, 9),
      duration: pState.duration,
      isRest: pState.isRest,
      dots: pState.dots,
      tied: pState.tied,
      pitches: [{ step, accidental: accidental || (pState.accidental as any), octave }],
      tabPositions: [{ str, fret, technique: pState.technique || undefined }],
      articulations: pState.articulation ? [pState.articulation] : undefined,
    };

    if (measure.notes.length > 0 && this.activeNoteIndex < measure.notes.length) {
      measure.notes[this.activeNoteIndex] = newNote;
    } else {
      measure.notes.push(newNote);
    }

    this.advanceCursor();
    this.renderScore();
  }

  /** Advance cursor forward across notes / measures */
  private advanceCursor() {
    if (!this.parsed.notationScore) return;
    const measures = this.parsed.notationScore.measures;
    const currentM = measures[this.activeMeasureIndex];
    if (this.activeNoteIndex < currentM.notes.length) {
      this.activeNoteIndex++;
    } else if (this.activeMeasureIndex < measures.length - 1) {
      this.activeMeasureIndex++;
      this.activeNoteIndex = 0;
    }
  }

  /** Setup direct keyboard typing (Sibelius / Dorico style) */
  private setupKeyboardShortcuts() {
    this.keyListener = (e: KeyboardEvent) => {
      // Ignore if user is typing into an input or textarea
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const key = e.key.toLowerCase();

      // 1. Durations (1-6)
      if (key === "1") {
        this.palette.setState({ duration: "w" });
        return;
      }
      if (key === "2") {
        this.palette.setState({ duration: "h" });
        return;
      }
      if (key === "3") {
        this.palette.setState({ duration: "q" });
        return;
      }
      if (key === "4") {
        this.palette.setState({ duration: "8" });
        return;
      }
      if (key === "5") {
        this.palette.setState({ duration: "16" });
        return;
      }
      if (key === "6") {
        this.palette.setState({ duration: "32" });
        return;
      }

      // 2. Modifiers: R (rest), . (dot), T (tie)
      if (key === "r") {
        const cur = this.palette.getState().isRest;
        this.palette.setState({ isRest: !cur });
        return;
      }
      if (key === ".") {
        const cur = this.palette.getState().dots;
        this.palette.setState({ dots: cur > 0 ? 0 : 1 });
        return;
      }
      if (key === "t") {
        const cur = this.palette.getState().tied;
        this.palette.setState({ tied: !cur });
        return;
      }

      // 3. Navigation: Arrows
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (this.activeNoteIndex > 0) {
          this.activeNoteIndex--;
        } else if (this.activeMeasureIndex > 0) {
          this.activeMeasureIndex--;
          const prevM = this.parsed.notationScore?.measures[this.activeMeasureIndex];
          this.activeNoteIndex = prevM ? Math.max(0, prevM.notes.length - 1) : 0;
        }
        this.renderScore();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        this.advanceCursor();
        this.renderScore();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        // On tab, move string up (e.g. 2 -> 1)
        if (this.activeStringIndex > 1) this.activeStringIndex--;
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        // On tab, move string down (e.g. 1 -> 2)
        if (this.activeStringIndex < 6) this.activeStringIndex++;
        return;
      }

      // 4. Pitch entry (A-G)
      if (["a", "b", "c", "d", "e", "f", "g"].includes(key)) {
        e.preventDefault();
        const step = key as any;
        const pState = this.palette.getState();
        const noteStr = `${step.toUpperCase()}${pState.accidental || ""}${this.activeOctave}`;
        const midi = noteToMidi(noteStr);
        this.audio.playNote(midi);
        this.insertPitchAtCursor(step, pState.accidental || undefined, this.activeOctave);
        return;
      }

      // 5. Fret numeric entry on tab (0-9)
      if (key >= "0" && key <= "9") {
        e.preventDefault();
        const fret = parseInt(key, 10);
        const tuning = this.parsed.notationScore?.tuning || TUNING_PRESETS.standard.notes;
        const numStrings = tuning.length;
        const tuningIdx = numStrings - this.activeStringIndex;
        const openNote = tuning[tuningIdx] || "E2";
        const midi = stringFretToMidi(openNote, fret);
        const noteName = midiToNote(midi);
        const step = noteName[0].toLowerCase() as any;
        const acc = noteName.includes("#") ? "#" : undefined;
        const oct = parseInt(noteName.replace(/[^0-9-]/g, ""), 10);

        this.audio.playNote(midi);
        this.insertTabAtCursor(this.activeStringIndex, fret, step, acc, oct);
        return;
      }

      // 6. Delete / Backspace
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        this.deleteAtCursor();
        return;
      }

      // 7. Add Measure: Enter or |
      if (e.key === "Enter" || e.key === "|") {
        e.preventDefault();
        this.addNewMeasure();
        return;
      }
    };

    window.addEventListener("keydown", this.keyListener);
  }

  /** Delete note at current cursor position */
  private deleteAtCursor() {
    if (!this.parsed.notationScore) return;
    const measures = this.parsed.notationScore.measures;
    const m = measures[this.activeMeasureIndex];
    if (m && m.notes.length > 0) {
      if (this.activeNoteIndex < m.notes.length) {
        m.notes.splice(this.activeNoteIndex, 1);
        if (this.activeNoteIndex > 0 && this.activeNoteIndex >= m.notes.length) {
          this.activeNoteIndex--;
        }
      }
      this.renderScore();
    }
  }

  /** Add a new empty measure */
  private addNewMeasure() {
    if (!this.parsed.notationScore) return;
    const measures = this.parsed.notationScore.measures;
    const newNum = measures.length + 1;
    measures.push({
      number: newNum,
      notes: [
        {
          id: "note-" + Math.random().toString(36).substring(2, 9),
          duration: "w",
          isRest: true,
          dots: 0,
        },
      ],
    });
    this.activeMeasureIndex = measures.length - 1;
    this.activeNoteIndex = 0;
    this.renderScore();
  }

  /** Toggle audio score playback */
  private togglePlayback(btn: HTMLButtonElement) {
    if (this.isPlaying) {
      this.isPlaying = false;
      if (this.playbackTimer) clearInterval(this.playbackTimer);
      btn.setText("▶ Play");
      btn.removeClass("mod-warning");
      btn.addClass("mod-cta");
      return;
    }

    if (!this.parsed.notationScore) return;
    this.isPlaying = true;
    btn.setText("⏹ Stop");
    btn.removeClass("mod-cta");
    btn.addClass("mod-warning");

    const allNotes: { mIdx: number; nIdx: number; note: ScoreNote }[] = [];
    this.parsed.notationScore.measures.forEach((m, mIdx) => {
      m.notes.forEach((n, nIdx) => {
        allNotes.push({ mIdx, nIdx, note: n });
      });
    });

    if (allNotes.length === 0) return;

    let currentStep = 0;
    const beatIntervalMs = (60 / this.tempoBpm) * 500; // rough 8th/quarter step

    this.playbackTimer = setInterval(() => {
      if (!this.isPlaying || currentStep >= allNotes.length) {
        this.isPlaying = false;
        clearInterval(this.playbackTimer);
        btn.setText("▶ Play");
        btn.removeClass("mod-warning");
        btn.addClass("mod-cta");
        return;
      }

      const { mIdx, nIdx, note } = allNotes[currentStep];
      this.activeMeasureIndex = mIdx;
      this.activeNoteIndex = nIdx;
      this.renderScore();

      if (!note.isRest) {
        if (note.pitches) {
          note.pitches.forEach((p) => {
            const midi = noteToMidi(`${p.step.toUpperCase()}${p.accidental || ""}${p.octave}`);
            this.audio.playNote(midi, 0.4);
          });
        } else if (note.tabPositions) {
          const tuning = this.parsed.notationScore?.tuning || TUNING_PRESETS.standard.notes;
          note.tabPositions.forEach((tp) => {
            const openNote = tuning[tuning.length - tp.str] || "E2";
            const midi = stringFretToMidi(openNote, tp.fret);
            this.audio.playNote(midi, 0.4);
          });
        }
      }

      currentStep++;
    }, beatIntervalMs);
  }

  /** Serialize back to clean BRNotation DSL and save */
  private saveAndClose() {
    let serialized = "";

    if (this.parsed.mode === "chordgrid" && this.parsed.chordGridScore) {
      serialized = this.serializeChordGrid(this.parsed.chordGridScore);
    } else if (this.parsed.mode === "chord" && this.parsed.chordDiagram) {
      serialized = this.serializeChord(this.parsed.chordDiagram);
    } else if (this.parsed.mode === "fretboard" && this.parsed.fretboardScale) {
      serialized = this.serializeFretboard(this.parsed.fretboardScale);
    } else if (this.parsed.notationScore) {
      serialized = this.serializeNotation(this.parsed.notationScore);
    } else {
      serialized = this.rawText;
    }

    this.onSave(serialized);
    new Notice("BRNotation score saved!");
    this.close();
  }

  private serializeNotation(score: NotationScore): string {
    const lines: string[] = [];
    if (score.title) lines.push(`title: ${score.title}`);
    lines.push(`mode: ${score.mode}`);
    lines.push(`time: ${score.timeSignature || "4/4"}`);
    lines.push(`key: ${score.keySignature || "C"}`);
    lines.push(`clef: ${score.clef || "treble"}`);
    lines.push("");

    const mStrings: string[] = [];
    for (const m of score.measures) {
      const noteTokens: string[] = [];
      for (const n of m.notes) {
        const dot = n.dots > 0 ? "." : "";
        const tie = n.tied ? "~" : "";

        if (n.isRest) {
          noteTokens.push(`r/${n.duration}${dot}`);
        } else if (n.pitches && n.pitches.length === 1) {
          const p = n.pitches[0];
          const acc = p.accidental || "";
          noteTokens.push(`${p.step}${acc}${p.octave}/${n.duration}${dot}${tie}`);
        } else if (n.tabPositions && n.tabPositions.length === 1) {
          const tp = n.tabPositions[0];
          const tech = tp.technique || "";
          noteTokens.push(`${tp.fret}:${tp.str}/${n.duration}${dot}${tie}${tech}`);
        } else if (n.pitches && n.pitches.length > 1) {
          const inner = n.pitches.map((p) => `${p.step}${p.accidental || ""}${p.octave}`).join(",");
          noteTokens.push(`[${inner}]/${n.duration}${dot}${tie}`);
        } else if (n.tabPositions && n.tabPositions.length > 1) {
          const inner = n.tabPositions.map((tp) => `${tp.fret}:${tp.str}`).join(",");
          noteTokens.push(`[${inner}]/${n.duration}${dot}${tie}`);
        }
      }
      mStrings.push(`| ${noteTokens.join(" ")} `);
    }

    lines.push(mStrings.join("") + "|");
    return lines.join("\n");
  }

  private serializeChordGrid(grid: ChordGridScore): string {
    const lines: string[] = [];
    if (grid.title) lines.push(`title: ${grid.title}`);
    lines.push(`type: chordgrid`);
    lines.push(`time: ${grid.timeSignature || "4/4"}`);
    lines.push(`per-row: ${grid.measuresPerRow || 4}`);
    lines.push("");

    for (const m of grid.measures) {
      if (m.section) lines.push(`[${m.section}]`);
      const chords = m.cells[0]?.chords || [];
      const repBeg = m.repeatBegin ? ":" : "";
      const repEnd = m.repeatEnd ? ":" : "";
      lines.push(`|${repBeg} ${chords.join(" ")} ${repEnd}|`);
    }
    return lines.join("\n");
  }

  private serializeChord(chord: any): string {
    const lines: string[] = [];
    lines.push(`type: chord`);
    lines.push(`name: ${chord.name}`);
    lines.push(`frets: ${chord.frets.join(" ")}`);
    if (chord.fingers) lines.push(`fingers: ${chord.fingers.join(" ")}`);
    if (chord.baseFret) lines.push(`base-fret: ${chord.baseFret}`);
    return lines.join("\n");
  }

  private serializeFretboard(scale: any): string {
    const lines: string[] = [];
    lines.push(`type: fretboard`);
    if (scale.title) lines.push(`title: ${scale.title}`);
    lines.push(`root: ${scale.root}`);
    lines.push(`scale: ${scale.scale}`);
    lines.push(`frets: ${scale.minFret}-${scale.maxFret}`);
    lines.push(`show: ${scale.displayMode}`);
    return lines.join("\n");
  }
}
