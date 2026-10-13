/**
 * Staff notation drawn with SMuFL glyphs from the bundled music fonts, rather than
 * VexFlow's glyph paths. Used for notation and coupled blocks unless they set
 * `glyphs: vexflow`. Coupled blocks get a tab row under each staff. Tab-only blocks
 * still use VexFlow.
 */
import { NotationScore, ScoreMeasure, ScoreNote, NotePitch } from "../types";
import { midiToStringFret, noteToMidi } from "../parser/scales";

export interface GlyphRenderOptions {
  width?: number;
  /** CSS font-family for the glyphs, e.g. `"Bravura"`. */
  fontFamily: string;
  /** Multiplier on the staff space, matching the VexFlow staff font sizing. */
  scale?: number;
  maxMeasuresPerLine?: number;
  /** Vertical space in px between tab strings (coupled blocks). */
  tabLineSpacing?: number;
  /** CSS font stack for tab fret numbers (coupled blocks). */
  tabFontFamily?: string;
  tabFontSize?: number;
}

/** SMuFL codepoints used here. Bravura, Leland, Gootville, Petaluma, and the jazz fonts all carry these. */
const G = {
  noteheadWhole: 0xe0a2,
  noteheadHalf: 0xe0a3,
  noteheadBlack: 0xe0a4,
  gClef: 0xe050,
  fClef: 0xe062,
  cClef: 0xe05c,
  flag8thUp: 0xe240,
  flag8thDown: 0xe241,
  flag16thUp: 0xe242,
  flag16thDown: 0xe243,
  flag32ndUp: 0xe244,
  flag32ndDown: 0xe245,
  restWhole: 0xe4e3,
  restHalf: 0xe4e4,
  restQuarter: 0xe4e5,
  rest8th: 0xe4e6,
  rest16th: 0xe4e7,
  rest32nd: 0xe4e8,
  accidentalSharp: 0xe262,
  accidentalFlat: 0xe260,
  accidentalNatural: 0xe261,
  augmentationDot: 0xe1e7,
  articAccentAbove: 0xe4a0,
  articTenutoAbove: 0xe4a4,
  articStaccatoAbove: 0xe4a6,
  fermataAbove: 0xe4c0,
};

const STAFF_LINE_COUNT = 5;

/** Diatonic step index: c=0 … b=6. Used to place notes on the staff. */
const STEP_INDEX: Record<string, number> = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };

/** Vertical position of the bottom staff line (E4 on treble) in diatonic steps. */
const BOTTOM_LINE_STEP: Record<string, number> = {
  treble: 2 + 7 * 4, // E4
  bass: 4 + 7 * 2, // G2
  alto: 0 + 7 * 3, // C3
  tenor: 0 + 7 * 3, // C3
};

function stepOf(p: NotePitch): number {
  return STEP_INDEX[p.step] + 7 * p.octave;
}

/** Baseline for a clef glyph, placed on the line that defines its pitch. */
function clefBaselineY(clef: string, y0: number, lineSpacing: number): number {
  // Staff lines run top (y0) to bottom (y0 + 4 * lineSpacing).
  if (clef === "bass") return y0 + 1 * lineSpacing; // F line, 2nd from top
  if (clef === "alto" || clef === "tenor") return y0 + 2 * lineSpacing; // C line, middle
  return y0 + 3 * lineSpacing; // G line, 2nd from bottom
}

const SVG_NS = "http://www.w3.org/2000/svg";

function el(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function glyph(
  parent: SVGElement,
  cp: number,
  x: number,
  y: number,
  size: number,
  family: string,
  extra: Record<string, string | number> = {}
): void {
  const t = el("text", {
    x,
    y,
    "font-family": family,
    "font-size": size,
    "text-anchor": "start",
    ...extra,
  }) as SVGTextElement;
  t.textContent = String.fromCodePoint(cp);
  parent.appendChild(t);
}

/**
 * Renders staff notation (notation and coupled modes) with font glyphs. The layout is a
 * simplified engine: fixed spacing per duration, stems with flags (no beams), and no
 * key or time signatures.
 */
export function renderGlyphScore(
  containerEl: HTMLElement,
  score: NotationScore,
  options: GlyphRenderOptions
): HTMLElement {
  containerEl.empty();
  const wrapper = containerEl.createDiv({ cls: "br-vexflow-score-container br-glyph-score" });
  const scale = options.scale ?? 1;
  const family = options.fontFamily;
  const clef = score.clef || "treble";

  const baseWidth = options.width || containerEl.clientWidth || 700;
  const containerWidth = Math.max(baseWidth, 580);
  const measuresPerLine = Math.max(1, Math.floor(options.maxMeasuresPerLine ?? 4));
  const PAD = 8;

  // One staff space in px. The staff is four spaces tall.
  const lineSpacing = 10 * scale;
  const staffHeight = 4 * lineSpacing + 40;
  const isCoupled = score.mode === "coupled";
  const numStrings = score.tuning.length || 6;
  const tabSpacing = Math.max(8, options.tabLineSpacing ?? 16);
  const tabHeight = (numStrings - 1) * tabSpacing;
  const blockHeight = isCoupled ? staffHeight + tabHeight + 20 : staffHeight;
  const totalLines = Math.ceil(score.measures.length / measuresPerLine);
  const totalHeight = totalLines * (blockHeight + 20) + 20;
  const tabFont = options.tabFontFamily ?? family;
  const tabSize = options.tabFontSize ?? 13;

  const svg = el("svg", {
    class: "br-notation-svg br-glyph-svg",
    viewBox: `${-PAD} ${-PAD} ${containerWidth + PAD * 2} ${totalHeight + PAD * 2}`,
    width: "100%",
    style: "max-width: 100%; height: auto; display: block;",
  }) as SVGSVGElement;
  wrapper.appendChild(svg);

  // SMuFL glyphs are drawn so that one staff space is 0.25 em. Staff lines are 4 spaces apart.
  const glyphSize = lineSpacing * 4 * scale;

  for (let mIdx = 0; mIdx < score.measures.length; mIdx++) {
    const measure = score.measures[mIdx];
    const lineIndex = Math.floor(mIdx / measuresPerLine);
    const measureInLine = mIdx % measuresPerLine;
    const countOnLine = Math.min(measuresPerLine, score.measures.length - lineIndex * measuresPerLine);
    const measureWidth = Math.floor(containerWidth / countOnLine);
    const xPos = measureInLine * measureWidth;
    const isLastOnLine = measureInLine === countOnLine - 1;
    const thisMeasureWidth = isLastOnLine ? containerWidth - xPos : measureWidth;
    const y0 = 20 + lineIndex * (blockHeight + 20);

    // Staff lines
    for (let i = 0; i < STAFF_LINE_COUNT; i++) {
      svg.appendChild(
        el("line", {
          x1: xPos,
          x2: xPos + thisMeasureWidth,
          y1: y0 + i * lineSpacing,
          y2: y0 + i * lineSpacing,
          style: "stroke: var(--text-normal, #000)",
          "stroke-width": 1,
        })
      );
    }

    if (measureInLine === 0) {
      const mClef = measure.clef || clef;
      const clefCp = mClef === "bass" ? G.fClef : mClef === "alto" || mClef === "tenor" ? G.cClef : G.gClef;
      glyph(svg, clefCp, xPos + 4, clefBaselineY(mClef, y0, lineSpacing), glyphSize, family);
    }

    // Left edge barline is drawn where VexFlow would
    if (measureInLine === 0 || isLastOnLine || measure.barline) {
      const xBar = isLastOnLine ? xPos + thisMeasureWidth : xPos;
      svg.appendChild(
        el("line", {
          x1: xBar,
          x2: xBar,
          y1: y0,
          y2: y0 + 4 * lineSpacing,
          style: "stroke: var(--text-normal, #000)",
          "stroke-width": 1,
        })
      );
    }

    layoutMeasureNotes(svg, measure, xPos + 30, thisMeasureWidth - 40, y0, clef, family, glyphSize, lineSpacing);

    if (isCoupled) {
      const tabY0 = y0 + staffHeight;
      drawTabMeasure(svg, measure, xPos + 30, thisMeasureWidth - 40, tabY0, tabSpacing, numStrings, score.tuning, tabFont, tabSize, measureInLine === 0, xPos, thisMeasureWidth);
    }
  }

  return wrapper;
}

/** Slot centre x for note `i` of `n`, matching `layoutMeasureNotes`. */
function slotX(i: number, n: number, xStart: number, width: number): number {
  return xStart + (width / n) * i + width / n / 2;
}

/**
 * Draws one measure of the tab row under the staff: string lines, fret numbers centred
 * on each note's slot, and the TAB clef and connector at the start of a line.
 */
function drawTabMeasure(
  svg: SVGElement,
  measure: ScoreMeasure,
  xStart: number,
  width: number,
  tabY0: number,
  tabSpacing: number,
  numStrings: number,
  tuning: string[],
  family: string,
  size: number,
  isLineStart: boolean,
  xPos: number,
  measureWidth: number
): void {
  const stroke = "stroke: var(--text-normal, #000)";
  const tabBottom = tabY0 + (numStrings - 1) * tabSpacing;
  for (let s = 0; s < numStrings; s++) {
    svg.appendChild(
      el("line", { x1: xPos, x2: xPos + measureWidth, y1: tabY0 + s * tabSpacing, y2: tabY0 + s * tabSpacing, style: stroke, "stroke-width": 1 })
    );
  }
  svg.appendChild(
    el("line", { x1: xPos + measureWidth, x2: xPos + measureWidth, y1: tabY0, y2: tabBottom, style: stroke, "stroke-width": 1 })
  );

  if (isLineStart) {
    svg.appendChild(el("line", { x1: xPos, x2: xPos, y1: tabY0, y2: tabBottom, style: stroke, "stroke-width": 1 }));
    const mid = tabY0 + ((numStrings - 1) * tabSpacing) / 2;
    const label = ["T", "A", "B"];
    label.forEach((ch, i) => {
      const t = el("text", {
        x: xPos + 4,
        y: mid + (i - 1) * size * 1.1 + size * 0.35,
        "font-family": family,
        "font-size": size,
        "font-weight": "bold",
        "text-anchor": "start",
        style: "fill: var(--text-normal, #000)",
      }) as SVGTextElement;
      t.textContent = ch;
      svg.appendChild(t);
    });
  }

  const n = measure.notes.length;
  if (!n) return;
  // Same slots as the staff notes, so each fret number sits under its notehead.
  measure.notes.forEach((note, i) => {
    const x = slotX(i, n, xStart, width);
    const positions = tabPositionsFor(note, tuning);
    for (const { str, fret } of positions) {
      const y = tabY0 + (str - 1) * tabSpacing;
      // Mask the string line behind the number, so the digits read cleanly.
      const label = String(fret);
      const w = label.length * size * 0.6 + 4;
      svg.appendChild(
        el("rect", { x: x - w / 2, y: y - size * 0.55, width: w, height: size * 1.1, style: "fill: var(--background-primary, #fff)" })
      );
      const t = el("text", {
        x,
        y: y + size * 0.35,
        "font-family": family,
        "font-size": size,
        "font-weight": "bold",
        "text-anchor": "middle",
        style: "fill: var(--text-normal, #000)",
      }) as SVGTextElement;
      t.textContent = label;
      svg.appendChild(t);
    }
  });
}

/** Tab string/fret pairs for a note, using the same rules as the VexFlow coupled tab. */
function tabPositionsFor(note: ScoreNote, tuning: string[]): { str: number; fret: number | string }[] {
  if (note.isRest) return [{ str: 3, fret: "X" }];
  if (note.tabPositions && note.tabPositions.length > 0) {
    return note.tabPositions.map((tp) => ({ str: tp.str, fret: tp.fret }));
  }
  if (note.pitches && note.pitches.length > 0) {
    return note.pitches.map((p) => {
      const midi = noteToMidi(`${p.step}${p.accidental || ""}${p.octave}`);
      const tf = midiToStringFret(midi, tuning);
      return tf ? { str: tuning.length - tf.strIndex, fret: tf.fret } : { str: 1, fret: 0 };
    });
  }
  return [{ str: 1, fret: 0 }];
}

/** Lays out notes across the measure in equal horizontal slots. Stems, flags, and beams are simplified. */
function layoutMeasureNotes(
  svg: SVGElement,
  measure: ScoreMeasure,
  xStart: number,
  width: number,
  y0: number,
  clef: string,
  family: string,
  size: number,
  lineSpacing: number
): void {
  const notes = measure.notes;
  if (!notes.length) return;
  const slot = width / notes.length;
  const bottomStep = BOTTOM_LINE_STEP[clef] ?? BOTTOM_LINE_STEP.treble;
  const bottomY = y0 + 4 * lineSpacing;

  notes.forEach((note, i) => {
    const x = xStart + slot * i + slot / 2;
    drawNote(svg, note, x, bottomY, bottomStep, family, size, lineSpacing);
  });
}

function drawNote(
  svg: SVGElement,
  note: ScoreNote,
  x: number,
  bottomY: number,
  bottomStep: number,
  family: string,
  size: number,
  ls: number
): void {
  const middleY = bottomY - 2 * ls;
  if (note.isRest) {
    const rest =
      note.duration === "w" ? G.restWhole
      : note.duration === "h" ? G.restHalf
      : note.duration === "8" ? G.rest8th
      : note.duration === "16" ? G.rest16th
      : note.duration === "32" ? G.rest32nd
      : G.restQuarter;
    // Whole rest hangs from the 4th line; half rest sits on the middle line.
    const restY = note.duration === "w" ? bottomY - ls : note.duration === "h" ? middleY : middleY;
    glyph(svg, rest, x - size * 0.2, restY, size, family);
    drawDots(svg, note, x + size * 0.45, restY, size, family, ls);
    return;
  }

  const pitches = note.pitches ?? [];
  if (!pitches.length) return;
  const head =
    note.duration === "w" ? G.noteheadWhole
    : note.duration === "h" ? G.noteheadHalf
    : G.noteheadBlack;
  const headW = size * 0.3;

  const ys: number[] = [];
  for (const p of pitches) {
    const step = stepOf(p);
    // Each diatonic step is half a staff space.
    const yHead = bottomY - ((step - bottomStep) * ls) / 2;
    ys.push(yHead);
    drawLedgers(svg, x, yHead, bottomY, ls);
    if (p.accidental) {
      const acc =
        p.accidental.includes("#") ? G.accidentalSharp
        : p.accidental.includes("b") ? G.accidentalFlat
        : G.accidentalNatural;
      glyph(svg, acc, x - headW - size * 0.25, yHead, size, family);
    }
    glyph(svg, head, x - headW / 2, yHead, size, family);
  }

  // Stem and flags. Stems go up when the note sits below the middle line.
  if (note.duration !== "w") {
    const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
    const stemUp = avgY > middleY;
    const stemLen = 3.5 * ls;
    const extreme = stemUp ? Math.min(...ys) : Math.max(...ys);
    const sx = stemUp ? x + headW / 2 - 1 : x - headW / 2 + 1;
    const sy1 = stemUp ? extreme : extreme;
    const sy2 = stemUp ? extreme - stemLen : extreme + stemLen;
    svg.appendChild(
      el("line", { x1: sx, x2: sx, y1: sy1, y2: sy2, style: "stroke: var(--text-normal, #000)", "stroke-width": Math.max(1, ls * 0.12) })
    );
    const flag = flagFor(note.duration, stemUp);
    if (flag) glyph(svg, flag, sx, sy2, size, family);
  }

  drawDots(svg, note, x + headW, ys[0], size, family, ls);

  // Articulations go above the top note, or below if the stem is up.
  if (note.articulations?.length) {
    const top = Math.min(...ys);
    for (const a of note.articulations) {
      const cp =
        a === "staccato" ? G.articStaccatoAbove
        : a === "tenuto" ? G.articTenutoAbove
        : a === "accent" ? G.articAccentAbove
        : a === "fermata" ? G.fermataAbove
        : null;
      if (cp) glyph(svg, cp, x - size * 0.15, top - ls * 1.5, size, family);
    }
  }
}

function flagFor(duration: string, stemUp: boolean): number | null {
  if (duration === "8") return stemUp ? G.flag8thUp : G.flag8thDown;
  if (duration === "16") return stemUp ? G.flag16thUp : G.flag16thDown;
  if (duration === "32") return stemUp ? G.flag32ndUp : G.flag32ndDown;
  return null;
}

function drawDots(
  svg: SVGElement,
  note: ScoreNote,
  x: number,
  y: number,
  size: number,
  family: string,
  ls: number
): void {
  for (let d = 0; d < (note.dots ?? 0); d++) {
    glyph(svg, G.augmentationDot, x + d * ls * 1.2, y, size, family);
  }
}

/** Ledger lines for notes above or below the staff. */
function drawLedgers(svg: SVGElement, x: number, yHead: number, bottomY: number, ls: number): void {
  const topY = bottomY - 4 * ls;
  const half = ls * 0.9;
  const lineAt = (y: number) =>
    svg.appendChild(
      el("line", { x1: x - half, x2: x + half, y1: y, y2: y, style: "stroke: var(--text-normal, #000)", "stroke-width": Math.max(1, ls * 0.12) })
    );
  if (yHead > bottomY + ls / 2) {
    for (let y = bottomY + ls; y <= yHead + 0.01; y += ls) lineAt(y);
  } else if (yHead < topY - ls / 2) {
    for (let y = topY - ls; y >= yHead - 0.01; y -= ls) lineAt(y);
  }
}
