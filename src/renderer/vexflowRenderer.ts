/**
 * VexFlow 5 SVG Renderer for Standard Notation & Tablature
 */
import {
  Accidental,
  Articulation,
  Beam,
  Barline,
  Dot,
  Formatter,
  Renderer,
  Stave,
  StaveConnector,
  StaveModifier,
  StaveNote,
  StaveTie,
  TabNote,
  TabStave,
} from "vexflow";
import { NotationScore, ScoreMeasure, ScoreNote } from "../types";
import { midiToStringFret, noteToMidi } from "../parser/scales";

export interface VexflowRenderOptions {
  width?: number;
  scale?: number;
  interactive?: boolean;
  activeMeasureIndex?: number;
  activeNoteIndex?: number;
  onNoteClick?: (measureIndex: number, noteIndex: number) => void;
}

export function renderVexflowScore(
  containerEl: HTMLElement,
  score: NotationScore,
  options: VexflowRenderOptions = {}
): HTMLElement {
  containerEl.empty();
  const wrapper = containerEl.createDiv({ cls: "br-vexflow-score-container" });

  const baseWidth = options.width || containerEl.clientWidth || 700;
  // Ensure we have a reasonable minimum layout coordinate width so notes aren't squished
  const containerWidth = Math.max(baseWidth, 580);
  const scale = options.scale || 1.0;

  // Adaptive measures per system:
  // If container is narrow (< 600px), 1 measure per row
  // If 600px - 880px, 2 measures per row
  // Otherwise up to 3 measures per row
  const measuresPerLine = containerWidth < 600 ? 1 : containerWidth < 880 ? 2 : 3;
  const isCoupled = score.mode === "coupled";
  const isTab = score.mode === "tab";
  const isNotation = score.mode === "notation";

  // Generous stave spacing for comfortable tab line height (16px per string)
  const tabLineSpacing = 16;
  const numStrings = score.tuning.length || 6;
  const tabStaveHeight = (numStrings - 1) * tabLineSpacing;
  const notationStaveHeight = 85;

  // Stave line heights
  const staffSystemHeight = isCoupled
    ? notationStaveHeight + tabStaveHeight + 90
    : isTab
    ? tabStaveHeight + 75
    : notationStaveHeight + 50;

  const totalLines = Math.ceil(score.measures.length / measuresPerLine);
  const totalHeight = totalLines * staffSystemHeight + 40;

  const renderer = new Renderer(wrapper, Renderer.Backends.SVG);
  renderer.resize(containerWidth, totalHeight);
  const context = renderer.getContext();
  context.scale(scale, scale);

  // Configure SVG attributes for responsive scaling and theme adaptability
  const svgEl = wrapper.querySelector("svg");
  if (svgEl) {
    svgEl.classList.add("br-notation-svg");
    svgEl.setAttribute("viewBox", `0 0 ${containerWidth} ${totalHeight}`);
    svgEl.setAttribute("width", "100%");
    svgEl.removeAttribute("height");
    svgEl.style.maxWidth = "100%";
    svgEl.style.height = "auto";
    svgEl.style.display = "block";
  }

  const ties: StaveTie[] = [];

  for (let mIdx = 0; mIdx < score.measures.length; mIdx++) {
    const measure = score.measures[mIdx];
    const lineIndex = Math.floor(mIdx / measuresPerLine);
    const measureInLine = mIdx % measuresPerLine;
    const isFirstInLine = measureInLine === 0;
    const isLastInLine = measureInLine === measuresPerLine - 1 || mIdx === score.measures.length - 1;

    const measureWidth = Math.floor((containerWidth - 30) / measuresPerLine);
    const xPos = 15 + measureInLine * measureWidth;
    const yNotation = 18 + lineIndex * staffSystemHeight;
    const yTab = isCoupled ? yNotation + notationStaveHeight + 35 : yNotation;

    let stave: Stave | null = null;
    let tabStave: TabStave | null = null;

    // Build standard notation stave
    if (isNotation || isCoupled) {
      stave = new Stave(xPos, yNotation, measureWidth);
      if (isFirstInLine) {
        stave.addClef(measure.clef || score.clef || "treble");
        if (measure.timeSignature || score.timeSignature) {
          stave.addTimeSignature(measure.timeSignature || score.timeSignature);
        }
        if (measure.keySignature || score.keySignature) {
          stave.addKeySignature(measure.keySignature || score.keySignature);
        }
      }
      stave.setContext(context).draw();

      // Add end barline as modifier before drawing
      const barlineType = mIdx === score.measures.length - 1 ? Barline.type.END : Barline.type.SINGLE;
      const barline = new Barline(barlineType);
      barline.setPosition(StaveModifier.Position.END);
      barline.setStyle({ strokeStyle: "var(--text-normal)" });
      stave.addModifier(barline);
      stave.setContext(context).draw();
    }

    // Build tablature stave with legible 16px line spacing
    if (isTab || isCoupled) {
      tabStave = new TabStave(xPos, yTab, measureWidth, {
        spacingBetweenLinesPx: tabLineSpacing,
        numLines: numStrings,
      });
      tabStave.setNumLines(numStrings);
      if (isFirstInLine) {
        tabStave.addClef("tab");
      }

      // Add end barline as modifier before drawing
      const barlineType = mIdx === score.measures.length - 1 ? Barline.type.END : Barline.type.SINGLE;
      const barline = new Barline(barlineType);
      barline.setPosition(StaveModifier.Position.END);
      barline.setStyle({ strokeStyle: "var(--text-normal)" });
      tabStave.addModifier(barline);
      tabStave.setContext(context).draw();
    }

    // Add brace / bracket connector if coupled
    if (isCoupled && stave && tabStave && isFirstInLine) {
      const connector = new StaveConnector(stave, tabStave);
      connector.setType(StaveConnector.type.BRACKET);
      connector.setContext(context).draw();
      const lineConnector = new StaveConnector(stave, tabStave);
      lineConnector.setType(StaveConnector.type.SINGLE_LEFT);
      lineConnector.setContext(context).draw();
    }

    // Convert score notes to VexFlow notes
    const staveNotes: StaveNote[] = [];
    const tabNotes: TabNote[] = [];

    measure.notes.forEach((note, nIdx) => {
      const isSelected =
        options.activeMeasureIndex === mIdx && options.activeNoteIndex === nIdx;

      // 1. Build standard notation StaveNote
      if (stave) {
        const keys: string[] = [];
        const accidentals: { index: number; acc: string }[] = [];

        if (note.isRest) {
          keys.push("b/4"); // default rest position
        } else if (note.pitches && note.pitches.length > 0) {
          note.pitches.forEach((p, pIdx) => {
            const keyStr = `${p.step}/${p.octave}`;
            keys.push(keyStr);
            if (p.accidental) {
              accidentals.push({ index: pIdx, acc: p.accidental });
            }
          });
        } else if (note.tabPositions && note.tabPositions.length > 0) {
          // Derive pitch from tab string/fret and tuning
          note.tabPositions.forEach((tp, pIdx) => {
            const strIdx = tp.str - 1; // 1-based string
            const openNote = score.tuning[strIdx] || "E2";
            const midi = noteToMidi(openNote) + tp.fret;
            const noteName = midiToVexKey(midi);
            keys.push(noteName.key);
            if (noteName.acc) {
              accidentals.push({ index: pIdx, acc: noteName.acc });
            }
          });
        } else {
          keys.push("b/4");
        }

        const vfNote = new StaveNote({
          keys,
          duration: note.duration + (note.isRest ? "r" : ""),
          dots: note.dots,
          clef: measure.clef || score.clef || "treble",
        });

        // Accidentals
        accidentals.forEach(({ index, acc }) => {
          vfNote.addModifier(new Accidental(acc), index);
        });

        // Dots
        for (let d = 0; d < note.dots; d++) {
          vfNote.addModifier(new Dot(), 0);
        }

        // Articulations
        if (note.articulations) {
          note.articulations.forEach((art) => {
            const artType =
              art === "staccato"
                ? "a."
                : art === "accent"
                ? "a>"
                : art === "tenuto"
                ? "a-"
                : "a@a";
            vfNote.addModifier(new Articulation(artType));
          });
        }

        if (isSelected) {
          vfNote.setStyle({ fillStyle: "var(--interactive-accent, #7c3aed)", strokeStyle: "var(--interactive-accent, #7c3aed)" });
        }

        staveNotes.push(vfNote);
      }

      // 2. Build TabNote
      if (tabStave) {
        const positions: { str: number; fret: number | string }[] = [];

        if (note.isRest) {
          positions.push({ str: 3, fret: "X" });
        } else if (note.tabPositions && note.tabPositions.length > 0) {
          note.tabPositions.forEach((tp) => {
            positions.push({ str: tp.str, fret: tp.fret });
          });
        } else if (note.pitches && note.pitches.length > 0) {
          // Derive tab position from pitch
          note.pitches.forEach((p) => {
            const midi = noteToMidi(`${p.step}${p.accidental || ""}${p.octave}`);
            const tf = midiToStringFret(midi, score.tuning);
            if (tf) {
              positions.push({ str: tf.strIndex + 1, fret: tf.fret });
            } else {
              positions.push({ str: 1, fret: 0 });
            }
          });
        } else {
          positions.push({ str: 1, fret: 0 });
        }

        const vfTabNote = new TabNote({
          positions,
          duration: note.duration + (note.isRest ? "r" : ""),
          dots: note.dots,
        });

        // Enlarge and bolden fret numbers for clear readability
        const tabNoteAny = vfTabNote as any;
        if (tabNoteAny.fretElement && Array.isArray(tabNoteAny.fretElement)) {
          tabNoteAny.fretElement.forEach((el: any) => {
            if (el && typeof el.setFontSize === "function") {
              el.setFontSize(13); // 13pt bold font
            }
          });
        }

        if (isSelected) {
          vfTabNote.setStyle({ fillStyle: "var(--interactive-accent, #7c3aed)", strokeStyle: "var(--interactive-accent, #7c3aed)" });
        }

        tabNotes.push(vfTabNote);
      }
    });

    // Format and draw notes
    if (stave && staveNotes.length > 0) {
      const beams = Beam.generateBeams(staveNotes.filter((n) => !n.isRest()));
      Formatter.FormatAndDraw(context, stave, staveNotes);
      beams.forEach((b) => b.setContext(context).draw());
    }

    if (tabStave && tabNotes.length > 0) {
      Formatter.FormatAndDraw(context, tabStave, tabNotes);
    }
  }

  // Draw end barlines
  return wrapper;
}

/** Convert MIDI number to VexFlow key format (e.g. 60 -> { key: "c/4", acc: undefined }) */
function midiToVexKey(midi: number): { key: string; acc?: string } {
  const noteNames = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
  const semitone = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const raw = noteNames[semitone];
  if (raw.includes("#")) {
    return { key: `${raw[0]}/${octave}`, acc: "#" };
  }
  return { key: `${raw}/${octave}` };
}
