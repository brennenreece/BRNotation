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
  GhostNote,
  Renderer,
  Stave,
  Voice,
  StaveConnector,
  StaveModifier,
  StaveNote,
  StaveTie,
  TabNote,
  TabStave,
  MetricsDefaults,
  VexFlow,
} from "vexflow";
import { NotationScore, ScoreMeasure, ScoreNote } from "../types";
import { midiToStringFret, noteToMidi } from "../parser/scales";

export interface VexflowRenderOptions {
  width?: number;
  /** VexFlow font family name for the staff notation font */
  staffFontFamily?: string;
  /** Notehead size multiplier for the staff font, relative to Bravura */
  noteheadScale?: number;
  /** CSS font stack for tab fret numbers */
  tabFontFamily?: string;
  /** Tab fret number size in points */
  tabFontSize?: number;
  scale?: number;
  interactive?: boolean;
  activeMeasureIndex?: number;
  activeNoteIndex?: number;
  onNoteClick?: (measureIndex: number, noteIndex: number) => void;
  maxMeasuresPerLine?: number;
}

// Extra space in px between the tab clef and the first fret number on standalone tab.
const TAB_FIRST_NOTE_GAP = 14;

export function renderVexflowScore(
  containerEl: HTMLElement,
  score: NotationScore,
  options: VexflowRenderOptions = {}
): HTMLElement {
  containerEl.empty();
  const wrapper = containerEl.createDiv({ cls: "br-vexflow-score-container" });
  if (options.staffFontFamily) {
    VexFlow.setFonts(options.staffFontFamily);
  }
  MetricsDefaults.NoteHead.fontScale = options.noteheadScale ?? 1;

  const baseWidth = options.width || containerEl.clientWidth || 700;
  // Ensure we have a reasonable minimum layout coordinate width so notes aren't squished
  const containerWidth = Math.max(baseWidth, 580);
  const scale = options.scale || 1.0;

  // Measures per full line, from the user's setting. A final partial line uses its own
  // count so its measures stretch to fill the width.
  const measuresPerLine = Math.max(1, Math.floor(options.maxMeasuresPerLine ?? 4));
  const isCoupled = score.mode === "coupled";
  const isTab = score.mode === "tab";
  const isNotation = score.mode === "notation";

  // Tab strings use the staff line spacing (10 px), so tab and staff share one grid.
  const tabLineSpacing = 10;
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
  const lineStart = (lineIdx: number) => lineIdx * measuresPerLine;
  const measuresOnLine = (lineIdx: number) =>
    Math.min(measuresPerLine, score.measures.length - lineStart(lineIdx));
  const totalHeight = totalLines * staffSystemHeight + 40;

  // Padding around the drawing so edge barlines aren't clipped by the SVG viewBox
  const PAD = 8;

  const renderer = new Renderer(wrapper, Renderer.Backends.SVG);
  renderer.resize(containerWidth + PAD * 2, totalHeight + PAD * 2);
  const context = renderer.getContext();
  context.scale(scale, scale);

  // Configure SVG attributes for responsive scaling and theme adaptability
  const svgEl = wrapper.querySelector("svg");
  if (svgEl) {
    svgEl.classList.add("br-notation-svg");
    svgEl.setAttribute("viewBox", `${-PAD} ${-PAD} ${containerWidth + PAD * 2} ${totalHeight + PAD * 2}`);
    svgEl.setAttribute("width", "100%");
    svgEl.removeAttribute("height");
    svgEl.style.maxWidth = "100%";
    svgEl.style.height = "auto";
    svgEl.style.display = "block";
  }

  const ties: StaveTie[] = [];
  const tabNoteCenters: number[] = [];

  for (let mIdx = 0; mIdx < score.measures.length; mIdx++) {
    const measure = score.measures[mIdx];
    const lineIndex = Math.floor(mIdx / measuresPerLine);
    const measureInLine = mIdx % measuresPerLine;
    const isFirstInLine = measureInLine === 0;
    const countOnLine = measuresOnLine(lineIndex);
    // Staves span the full container width with no margins; the last measure on a line
    // takes any leftover pixels so the line reaches the right edge exactly.
    const measureWidth = Math.floor(containerWidth / countOnLine);
    const xPos = measureInLine * measureWidth;
    const isLastOnLine = measureInLine === countOnLine - 1;
    const thisMeasureWidth = isLastOnLine ? containerWidth - xPos : measureWidth;
    const yNotation = 18 + lineIndex * staffSystemHeight;
    const yTab = isCoupled ? yNotation + notationStaveHeight + 35 : yNotation;

    let stave: Stave | null = null;
    let tabStave: TabStave | null = null;

    // Build standard notation stave
    if (isNotation || isCoupled) {
      stave = new Stave(xPos, yNotation, thisMeasureWidth);
      if (isFirstInLine) {
        stave.addClef(measure.clef || score.clef || "treble");
        if (measure.timeSignature || score.timeSignature) {
          stave.addTimeSignature(measure.timeSignature || score.timeSignature);
        }
        if (measure.keySignature || score.keySignature) {
          stave.addKeySignature(measure.keySignature || score.keySignature);
        }
      }

      applyBarline(stave, measure);
    }

    // Build tablature stave with legible 16px line spacing
    if (isTab || isCoupled) {
      tabStave = new TabStave(xPos, yTab, thisMeasureWidth, {
        spacingBetweenLinesPx: tabLineSpacing,
        numLines: numStrings,
      });
      tabStave.setNumLines(numStrings);
      applyBarline(tabStave, measure);
    }

    // Coupled: start the tab notes at the same x as the notation notes. The notation stave
    // is pushed right by its clef, key, and time signature, which the tab stave doesn't have.
    if (stave && tabStave) {
      stave.format();
      tabStave.setNoteStartX(stave.getNoteStartX());
    } else if (tabStave) {
      // Standalone tab: widen the gap between the clef and the first fret number.
      tabStave.setNoteStartX(tabStave.getNoteStartX() + TAB_FIRST_NOTE_GAP);
    }

    if (stave) {
      stave.setContext(context).draw();
      drawRightEdgeBarline(stave, measure);
    }
    if (tabStave) {
      tabStave.setContext(context).draw();
      drawRightEdgeBarline(tabStave, measure);
    }

    // Add a simple vertical line connector if coupled
    if (isCoupled && stave && tabStave && isFirstInLine) {
      const lineConnector = new StaveConnector(stave, tabStave);
      lineConnector.setType(StaveConnector.type.SINGLE_LEFT);
      lineConnector.setContext(context).draw();
    }

    // Convert score notes to VexFlow notes
    const staveNotes: StaveNote[] = [];
    const tabNotes: (TabNote | GhostNote)[] = [];

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
            // Tab numbering: string 1 = high E. Tuning index 0 = low E, so invert.
            const strIdx = score.tuning.length - tp.str;
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
          // Rests take their time slot in tab but show no number.
          tabNotes.push(new GhostNote({ duration: note.duration + "r", dots: note.dots }));
          return;
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
              positions.push({ str: score.tuning.length - tf.strIndex, fret: tf.fret });
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
            if (el && typeof el.setFont === "function") {
              // Family falls back to VexFlow's default when no choice is passed.
              el.setFont(options.tabFontFamily ?? el.fontInfo.family, options.tabFontSize ?? 13, "bold");
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
    if (stave && tabStave && staveNotes.length > 0 && tabNotes.length > 0) {
      // Coupled: lay out both voices together so tab numbers share the notes' x positions,
      // even though the notation stave is offset by its clef, key, and time signature.
      const beams = Beam.generateBeams(staveNotes.filter((n) => !n.isRest()));
      const notevoice = new Voice("4/4").setMode(Voice.Mode.SOFT).addTickables(staveNotes);
      const tabvoice = new Voice("4/4").setMode(Voice.Mode.SOFT).addTickables(tabNotes);
      new Formatter()
        .joinVoices([notevoice])
        .joinVoices([tabvoice])
        .formatToStave([notevoice, tabvoice], stave, { alignRests: false });
      notevoice.draw(context, stave);
      tabvoice.draw(context, tabStave);
      beams.forEach((b) => b.setContext(context).draw());
      // Center each fret on the notation head so the numbers sit under the notes.
      staveNotes.forEach((sn, i) => {
        if (!tabNotes[i]) return;
        tabNoteCenters.push(sn.getNoteHeadBeginX() + sn.getGlyphWidth() / 2);
      });
    } else {
      if (stave && staveNotes.length > 0) {
        const beams = Beam.generateBeams(staveNotes.filter((n) => !n.isRest()));
        Formatter.FormatAndDraw(context, stave, staveNotes);
        beams.forEach((b) => b.setContext(context).draw());
      }

      if (tabStave && tabNotes.length > 0) {
        // Same SOFT voice layout as the coupled branch so tab-only spacing matches it.
        const tabvoice = new Voice("4/4").setMode(Voice.Mode.SOFT).addTickables(tabNotes);
        new Formatter().joinVoices([tabvoice]).format([tabvoice], tabStave.getNoteEndX() - tabStave.getNoteStartX());
        tabvoice.draw(context, tabStave);
        tabNotes.forEach((tn) => tabNoteCenters.push(tn.getAbsoluteX()));
      }
    }
  }

  // Convert VexFlow's barline rectangles to SVG lines.
  // This ensures they are styled as lines (using stroke) rather than rectangles (using fill),
  // making them consistent with staff lines and theme-aware.
  const barlineRects = wrapper.querySelectorAll(".vf-stavebarline rect");
  barlineRects.forEach((rect) => {
    const x = parseFloat(rect.getAttribute("x") || "0");
    const y = parseFloat(rect.getAttribute("y") || "0");
    const width = rect.getAttribute("width") || "1";
    const height = parseFloat(rect.getAttribute("height") || "0");

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x.toString());
    line.setAttribute("y1", y.toString());
    line.setAttribute("x2", x.toString());
    line.setAttribute("y2", (y + height).toString());
    line.setAttribute("stroke-width", width);

    rect.parentNode?.replaceChild(line, rect);
  });

  // Strip remaining inline styles and attributes from lines and paths to let the CSS rules take full control.
  const elements = wrapper.querySelectorAll("line, path");
  elements.forEach((el) => {
    el.removeAttribute("stroke");
    el.removeAttribute("fill");
    el.removeAttribute("style");
  });

  // Center each fret number on its note. VexFlow positions text using a regular-weight
  // width, but the bold style renders wider, so the digits drift right. Anchoring at the
  // middle on the note's x keeps them centered on the tab line.
  wrapper.querySelectorAll('g[type="TabNote.text"]').forEach((group, i) => {
    const center = tabNoteCenters[i];
    if (center === undefined) return;
    group.querySelectorAll("text").forEach((textEl) => {
      textEl.setAttribute("text-anchor", "middle");
      textEl.setAttribute("dominant-baseline", "central");
      textEl.setAttribute("x", center.toString());
    });
  });

  return wrapper;
}

/**
 * Applies a measure's left and right barlines to a stave.
 * Right-edge end and repeat-end bars are drawn by drawRightEdgeBarline after
 * the stave is drawn, so the thick bar lands exactly on the staff's right edge.
 */
function applyBarline(stave: Stave, measure: ScoreMeasure) {
  if (measure.startBarline === "repeat-begin") {
    stave.setBegBarType(Barline.type.REPEAT_BEGIN);
  }
  switch (measure.barline) {
    case "double":
      stave.setEndBarType(Barline.type.DOUBLE);
      break;
  }
}

/** Draws the right-edge end or repeat-end barline flush with the end of the staff lines */
function drawRightEdgeBarline(stave: Stave, measure: ScoreMeasure) {
  if (measure.barline !== "end" && measure.barline !== "repeat-end") return;
  const ctx = stave.getContext();
  if (!ctx) return;

  const top = stave.getTopLineTopY();
  const bottom = stave.getBottomLineBottomY();
  const height = bottom - top;
  const right = stave.getX() + stave.getWidth();

  // Thick bar is 4.5px (75% of the previous 6px), ending exactly at the staff's right edge
  const thickWidth = 4.5;
  const thickX = right - thickWidth;
  ctx.fillRect(thickX, top, thickWidth, height);

  if (measure.barline === "end") {
    // Thin bar sits 3px to the left of the thick bar
    ctx.fillRect(thickX - 3, top, 1, height);
    return;
  }

  // Repeat-end: thin bar, then two dots, then thick bar, all flush to the right edge
  const thinX = thickX - 3;
  ctx.fillRect(thinX, top, 1, height);
  const dotRadius = 2;
  const dotX = thinX - 4 - dotRadius;
  const spacing = stave.getSpacingBetweenLines();
  const midY = top + height / 2;
  ctx.beginPath();
  ctx.arc(dotX, midY - spacing / 2, dotRadius, 0, Math.PI * 2, false);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(dotX, midY + spacing / 2, dotRadius, 0, Math.PI * 2, false);
  ctx.fill();
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
