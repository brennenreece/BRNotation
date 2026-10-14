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
  /** CSS font stack for tab fret numbers (coupled blocks). */
  tabFontFamily?: string;
  tabFontSize?: number;
  /** Vertical shift in px applied to fret numbers only (negative = up). */
  tabNumberOffset?: number;
  /** Notehead size multiplier per font, matching the VexFlow path. */
  noteheadScale?: number;
  /** Multiplier for the space after barlines and after the time signature (1 = default). */
  spacingScale?: number;
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
  timeSig0: 0xe080,
  barlineDouble: 0xe031,
  barlineFinal: 0xe032,
  repeatLeft: 0xe040,
  repeatRight: 0xe041,
  repeatDots: 0xe043,
  timeSigSlash: 0xe09a,
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
/** Stem weight in px, matching VexFlow's Tables.STEM_WIDTH. */
const STEM_W = 1.5;
/** Ledger overhang past each side of the notehead in px, matching VexFlow's LEDGER_LINE_OFFSET. */
const LEDGER_OVERHANG = 3;

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
  // Tab-only blocks draw just the tab row, with no staff above it.
  const isTabOnly = score.mode === "tab";
  const numStrings = score.tuning.length || 6;
  // Tab strings share the staff's line spacing so the two read as one grid, but never tighter
  // than a fret number's height plus a small margin, so stacked chord numbers do not overlap.
  const tabSize = options.tabFontSize ?? 13;
  const tabSpacing = Math.max(lineSpacing, tabSize * 0.72 + 2);
  const tabHeight = (numStrings - 1) * tabSpacing;
  // Gap between the staff and its tab row in coupled blocks.
  const COUPLED_STAFF_TAB_GAP = 60;
  const tabOffset = 4 * lineSpacing + COUPLED_STAFF_TAB_GAP;
  const blockHeight = isTabOnly ? tabHeight + 20 : isCoupled ? tabOffset + tabHeight + 20 : staffHeight;
  const totalLines = Math.ceil(score.measures.length / measuresPerLine);
  const totalHeight = totalLines * (blockHeight + 20) + 20;
  const tabFont = options.tabFontFamily ?? family;
  const tabNumberOffset = options.tabNumberOffset ?? 0;
  const headScale = options.noteheadScale ?? 1;
  const spacing = Math.max(0, options.spacingScale ?? 1);
  const noteGap = NOTE_GAP * spacing;
  const noteEndInset = NOTE_END_INSET * spacing;

  const svg = el("svg", {
    class: "br-notation-svg br-glyph-svg",
    viewBox: `${-PAD} ${-PAD} ${containerWidth + PAD * 2} ${totalHeight + PAD * 2}`,
    width: "100%",
    style: "max-width: 100%; height: auto; display: block;",
  }) as SVGSVGElement;
  wrapper.appendChild(svg);

  // SMuFL glyphs are drawn so that one staff space is 0.25 em. Staff lines are 4 spaces apart.
  const glyphSize = lineSpacing * 4 * scale;

  // A measure's time signature applies to it and every measure after it until the next change.
  let currentTimeSig = score.timeSignature;
  for (let mIdx = 0; mIdx < score.measures.length; mIdx++) {
    const measure = score.measures[mIdx];
    if (measure.timeSignature) currentTimeSig = measure.timeSignature;
    const lineIndex = Math.floor(mIdx / measuresPerLine);
    const measureInLine = mIdx % measuresPerLine;
    const countOnLine = Math.min(measuresPerLine, score.measures.length - lineIndex * measuresPerLine);
    const measureWidth = Math.floor(containerWidth / countOnLine);
    const xPos = measureInLine * measureWidth;
    const isLastOnLine = measureInLine === countOnLine - 1;
    const thisMeasureWidth = isLastOnLine ? containerWidth - xPos : measureWidth;
    const y0 = 20 + lineIndex * (blockHeight + 20);

    if (isTabOnly) {
      const tabNoteStart = xPos + noteGap;
      // No staff: only the tab row, with the system connector and barlines around it.
      const tabY0 = y0;
      if (measureInLine === 0) {
        svg.appendChild(
          el("line", { x1: xPos, x2: xPos, y1: tabY0, y2: tabY0 + tabHeight, style: "stroke: var(--text-normal, #000)", "stroke-width": 1 })
        );
      }
      drawTabMeasure(svg, measure, tabNoteStart, xPos + thisMeasureWidth - noteEndInset - tabNoteStart, tabY0, tabSpacing, numStrings, score.tuning, tabFont, tabSize, xPos, thisMeasureWidth, tabNumberOffset, tabOnlyMinGaps(measure, score.tuning, tabSize));
      if (!isLastOnLine) {
        // Measure boundary: a single barline between measures, drawn at the right edge.
        svg.appendChild(el("line", { x1: xPos + thisMeasureWidth, x2: xPos + thisMeasureWidth, y1: tabY0, y2: tabY0 + tabHeight, style: "stroke: var(--text-normal, #000)", "stroke-width": 1 }));
      }
      continue;
    }

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

    // Where the notes of this measure start. On the first measure of a line the header
    // (clef, key, time signature) comes first, and notes start a stave-padding gap after it.
    let noteStartX = xPos + noteGap;
    if (measureInLine === 0) {
      const mClef = measure.clef || clef;
      const clefCp = mClef === "bass" ? G.fClef : mClef === "alto" || mClef === "tenor" ? G.cClef : G.gClef;
      glyph(svg, clefCp, xPos + 4, clefBaselineY(mClef, y0, lineSpacing), glyphSize, family);
      const keyX = xPos + 4 + clefWidth(mClef, glyphSize);
      const key = measure.keySignature || score.keySignature;
      const keyEnd = key ? drawKeySignature(svg, key, mClef, keyX, y0, glyphSize, lineSpacing, family) : keyX;
      const ts = measure.timeSignature || score.timeSignature;
      // VexFlow pads each modifier by 10 px, but the clef and key slots take no padding,
      // so the time signature starts 10 px after the last key accidental or the clef.
      let headerEnd = keyEnd;
      if (ts) {
        headerEnd = drawTimeSignature(svg, ts, keyEnd + TIME_SIG_PADDING, y0, glyphSize, lineSpacing, family);
      }
      noteStartX = headerEnd + noteGap;
    }

    // Barlines follow the VexFlow staff: the first measure of a line gets a left edge, and
    // each measure's right edge uses its closing barline type. In coupled blocks the line
    // start is drawn as one system connector below.
    if (measureInLine === 0 && !isCoupled) {
      drawBarlineLeft(svg, xPos, y0, 4 * lineSpacing, measure.startBarline === "repeat-begin");
    }
    drawBarlineRight(svg, xPos + thisMeasureWidth, y0, 4 * lineSpacing, measure.barline, isLastOnLine, family, glyphSize);

    layoutMeasureNotes(svg, measure, noteStartX, xPos + thisMeasureWidth - noteEndInset - noteStartX, y0, clef, family, glyphSize, lineSpacing, currentTimeSig, headScale, measureMinGaps(measure, score.tuning, tabSize, isCoupled, headScale, glyphSize));

    if (isCoupled) {
      const tabY0 = y0 + tabOffset;
      if (measureInLine === 0) {
        // Connects the staff and tab as one system at the start of each line.
        svg.appendChild(
          el("line", {
            x1: xPos,
            x2: xPos,
            y1: y0,
            y2: tabY0 + (numStrings - 1) * tabSpacing,
            style: "stroke: var(--text-normal, #000)",
            "stroke-width": 1,
          })
        );
      }
      drawTabMeasure(svg, measure, noteStartX, xPos + thisMeasureWidth - noteEndInset - noteStartX, tabY0, tabSpacing, numStrings, score.tuning, tabFont, tabSize, xPos, thisMeasureWidth, tabNumberOffset, measureMinGaps(measure, score.tuning, tabSize, true, headScale, glyphSize));
      const tabHeightPx = (numStrings - 1) * tabSpacing;
      drawBarlineRight(svg, xPos + thisMeasureWidth, tabY0, tabHeightPx, measure.barline, isLastOnLine, family, glyphSize);
      if (measureInLine === 0 && measure.startBarline === "repeat-begin") {
        drawBarlineLeft(svg, xPos, tabY0, tabHeightPx, true);
      }
    }
  }

  return wrapper;
}

/**
 * Horizontal share for each note in a measure, following VexFlow's Formatter: a softmax over
 * note durations with factor 10, so longer notes get more room but not in direct proportion.
 */

/**
 * Centre x of each note in a measure, shared by the staff and tab rows so they line up.
 * Follows VexFlow's Formatter: each context takes softmax(ticks) of the justify width, and
 * the last note keeps the end-padding inset (VexFlow Stave.defaultPadding).
 */
/** Per-note minimum gaps, shared by the staff and tab so both rows use one set of positions. */
function measureMinGaps(measure: ScoreMeasure, tuning: string[], tabSize: number, coupled: boolean, headScale: number, size: number): number[] {
  return noteMinGaps(measure.notes, tuning, coupled ? tabSize : 0, headScale, size);
}

/**
 * Minimum centre-to-centre gap each note needs. In tab mode it clears the widest tab label;
 * for any note with an accidental it also reserves room for the accidental to the left of its head.
 */
function noteMinGaps(notes: ScoreNote[], tuning: string[], tabSize: number, headScale: number, size: number): number[] {
  const headHalf = (size * 0.3 * headScale) / 2;
  return notes.map((note, i) => {
    let gap = NOTE_MIN_GAP;
    if (tabSize > 0) {
      const labels = note.isRest ? [] : tabPositionsFor(note, tuning).map((p) => String(p.fret));
      const widest = labels.reduce((m, l) => Math.max(m, l.length), 1);
      gap = Math.max(gap, widest * tabSize * 0.6 + 6);
    }
    const accWidth = accidentalWidth(note, size);
    if (accWidth > 0) {
      // Room for the accidental plus its clearance from the previous note's head.
      gap = Math.max(gap, accWidth + ACC_HEAD_GAP * size + headHalf * 2 + ACC_PREV_GAP * size);
    }
    return gap;
  });
}

/** Tab-only blocks draw no staff, so they only need room for the tab labels. */
function tabOnlyMinGaps(measure: ScoreMeasure, tuning: string[], tabSize: number): number[] {
  return measure.notes.map((note) => {
    const labels = note.isRest ? [] : tabPositionsFor(note, tuning).map((p) => String(p.fret));
    const widest = labels.reduce((m, l) => Math.max(m, l.length), 1);
    return Math.max(NOTE_MIN_GAP, widest * tabSize * 0.6 + 6);
  });
}

/** Widest accidental on a note, or 0 when it has none. Accidental advances are Bravura em widths. */
function accidentalWidth(note: ScoreNote, size: number): number {
  if (note.isRest || !note.pitches) return 0;
  let widest = 0;
  for (const p of note.pitches) {
    if (!p.accidental) continue;
    const em = p.accidental.includes("#") ? ACC_EM.sharp : p.accidental.includes("b") ? ACC_EM.flat : ACC_EM.natural;
    widest = Math.max(widest, em * size);
  }
  return widest;
}

function noteCentres(notes: ScoreNote[], xStart: number, width: number, minGaps?: number[]): number[] {
  if (!notes.length) return [];
  const justify = Math.max(0, width);
  const onsets: number[] = [];
  let t = 0;
  for (const n of notes) {
    onsets.push(t);
    t += noteQuarters(n);
  }
  // The last note's own duration is not spread across the bar, so the grid runs from the first
  // onset to the last one and the last note sits near the right edge instead of leaving a blank slot.
  const lastOnset = onsets[onsets.length - 1];
  const lastRoom = (minGaps?.[notes.length - 1] ?? NOTE_MIN_GAP) / 2;
  const pxPerQuarter = lastOnset > 0 ? Math.max(0, justify - lastRoom) / lastOnset : 0;
  // Place each note on its beat. If a note is closer to the previous one than its minimum gap,
  // push it right so labels never overlap, and carry the shift forward.
  const xs: number[] = [];
  let prev = -Infinity;
  for (let i = 0; i < notes.length; i++) {
    const minGap = minGaps?.[i] ?? NOTE_MIN_GAP;
    const beatX = xStart + onsets[i] * pxPerQuarter;
    const x = i === 0 ? beatX : Math.max(beatX, prev + minGap);
    xs.push(x);
    prev = x;
  }
  return xs;
}

/** Vertical lines and repeat dots, drawn with the same geometry as the VexFlow staff. */
const THIN_BAR = 1;
const THICK_BAR = 4.5;
const BAR_GAP = 3;
const REPEAT_DOT_R = 2;

/**
 * A vertical bar spanning `height` px from y0. Staff barlines span 4 spaces; coupled tab
 * barlines pass the tab's own height so both systems get the same barline types.
 */
function barLine(svg: SVGSVGElement, x: number, y0: number, height: number, width: number): void {
  svg.appendChild(
    el("rect", {
      x: x - width / 2,
      y: y0,
      width,
      height,
      style: "fill: var(--text-normal, #000)",
    })
  );
}

/** Repeat dots at the given fractions of `height` (staff: middle two spaces). */
function repeatDots(svg: SVGSVGElement, x: number, y0: number, height: number, fractions: number[] = [3 / 8, 5 / 8]): void {
  for (const f of fractions) {
    svg.appendChild(
      el("circle", {
        cx: x,
        cy: y0 + f * height,
        r: REPEAT_DOT_R,
        style: "fill: var(--text-normal, #000)",
      })
    );
  }
}

/** Left edge of a line: a thin system bar, or a thick and thin pair for a repeat-begin. */
function drawBarlineLeft(svg: SVGSVGElement, x: number, y0: number, height: number, repeatBegin: boolean): void {
  if (repeatBegin) {
    barLine(svg, x + THICK_BAR / 2, y0, height, THICK_BAR);
    barLine(svg, x + THICK_BAR + BAR_GAP + THIN_BAR / 2, y0, height, THIN_BAR);
    repeatDots(svg, x + THICK_BAR + BAR_GAP + THIN_BAR + 4, y0, height);
  } else {
    barLine(svg, x, y0, height, THIN_BAR);
  }
}

/** Right edge of a measure, from the closing barline type. */
function drawBarlineRight(
  svg: SVGSVGElement,
  x: number,
  y0: number,
  height: number,
  type: string | undefined,
  _isLastOnLine: boolean,
  _family: string,
  _glyphSize: number
): void {
  if (type === "double") {
    barLine(svg, x - BAR_GAP - THIN_BAR / 2, y0, height, THIN_BAR);
    barLine(svg, x - THIN_BAR / 2, y0, height, THIN_BAR);
  } else if (type === "end") {
    barLine(svg, x - THICK_BAR / 2 - BAR_GAP - THIN_BAR, y0, height, THIN_BAR);
    barLine(svg, x - THICK_BAR / 2, y0, height, THICK_BAR);
  } else if (type === "repeat-end") {
    repeatDots(svg, x - THICK_BAR / 2 - BAR_GAP - THIN_BAR - 4, y0, height);
    barLine(svg, x - THICK_BAR / 2 - BAR_GAP - THIN_BAR / 2, y0, height, THIN_BAR);
    barLine(svg, x - THICK_BAR / 2, y0, height, THICK_BAR);
  } else {
    barLine(svg, x, y0, height, THIN_BAR);
  }
}

// Key signatures: accidentals in circle-of-fifths order, placed at their standard staff steps.
const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];
const KEY_COUNTS: Record<string, { sharps: number } | { flats: number }> = {
  C: { sharps: 0 }, G: { sharps: 1 }, D: { sharps: 2 }, A: { sharps: 3 }, E: { sharps: 4 }, B: { sharps: 5 }, "F#": { sharps: 6 }, "C#": { sharps: 7 },
  F: { flats: 1 }, Bb: { flats: 2 }, Eb: { flats: 3 }, Ab: { flats: 4 }, Db: { flats: 5 }, Gb: { flats: 6 }, Cb: { flats: 7 },
};
// Octave of each letter for sharps and flats, following standard key-signature placement.
const SHARP_OCTAVE_OFFSET: Record<string, number> = { F: 1, C: 1, G: 1, D: 1, A: 0, E: 0, B: 0 };
const FLAT_OCTAVE_OFFSET: Record<string, number> = { B: 0, E: 1, A: 0, D: 1, G: 0, C: 1, F: 0 };

function drawKeySignature(
  svg: SVGSVGElement,
  key: string,
  clef: string,
  x: number,
  y0: number,
  glyphSize: number,
  lineSpacing: number,
  family: string
): number {
  const root = key.replace(/\s*(major|minor)$/i, "").trim();
  const counts = KEY_COUNTS[root] ?? KEY_COUNTS[root.charAt(0).toUpperCase() + root.slice(1)];
  if (!counts) return x;
  const isSharp = "sharps" in counts;
  const n = isSharp ? counts.sharps : counts.flats;
  if (n === 0) return x;
  const order = isSharp ? SHARP_ORDER : FLAT_ORDER;
  const offsets = isSharp ? SHARP_OCTAVE_OFFSET : FLAT_OCTAVE_OFFSET;
  const bottom = BOTTOM_LINE_STEP[clef] ?? BOTTOM_LINE_STEP.treble;
  const bottomY = y0 + 4 * lineSpacing;
  const cp = isSharp ? G.accidentalSharp : G.accidentalFlat;
  const step = (letter: string) => {
    // Absolute index of this letter's position in its standard key-signature octave.
    const octave = Math.floor(bottom / 7) + offsets[letter];
    return octave * 7 + STEP_INDEX[letter.toLowerCase()];
  };
  let cx = x;
  for (let i = 0; i < n; i++) {
    const letter = order[i];
    // Same placement as note accidentals: one diatonic step is half a staff space.
    const yHead = bottomY - ((step(letter) - bottom) * lineSpacing) / 2;
    glyph(svg, cp, cx, yHead, glyphSize, family);
    cx += glyphSize * 0.25;
  }
  return cx;
}

/** Advance width of a clef glyph in em, measured from Bravura. */
function clefWidth(clef: string, size: number): number {
  if (clef === "bass") return size * 0.684;
  if (clef === "alto" || clef === "tenor") return size * 0.699;
  return size * 0.671;
}

/**
 * Gap between the header (clef, key, time signature) and the first note, and the inset of
 * every measure's notes from its left barline. VexFlow's Stave.padding is 12 px.
 */
const NOTE_GAP = 12;
/** Space kept before each measure's right barline. VexFlow reserves 22 px (12 + 10). */
const NOTE_END_INSET = 22;
/** Minimum horizontal space per note, so dense measures still fit. */
const NOTE_MIN_GAP = 14;
/** Bravura accidental advance widths in em, and the clearances used around them. */
const ACC_EM = { sharp: 0.249, flat: 0.226, natural: 0.168 };
const ACC_HEAD_GAP = 0.03;
const ACC_PREV_GAP = 0.06;

/** Gap before the time signature. VexFlow's TimeSignature defaults customPadding to 15. */
const TIME_SIG_PADDING = 15;

/** Advance width of each time-signature digit in em, measured from Bravura. */
const TIME_DIGIT_EM = [0.47, 0.334, 0.446, 0.421, 0.47, 0.44, 0.436, 0.436, 0.436, 0.434];
/** Baseline offset (em) that centres a digit's measured ink vertically on its anchor. */
const TIME_DIGIT_CENTRE_EM = 0.0075;

/**
 * Draws a numerator and denominator stacked on the staff, centred on the top and bottom halves.
 * Returns the x where the time signature ends.
 */
function drawTimeSignature(
  svg: SVGElement,
  ts: string,
  x: number,
  y0: number,
  size: number,
  ls: number,
  family: string
): number {
  const [num, den] = ts.split("/");
  if (!num || !den) return x;
  // Numerator and denominator are centred in a column as wide as the longer of the two,
  // using each digit's measured advance.
  const textWidth = (text: string) =>
    [...text].reduce((w, ch) => w + TIME_DIGIT_EM[parseInt(ch, 10)] * size, 0);
  const colW = Math.max(textWidth(num), textWidth(den));
  const drawNumber = (text: string, baseline: number) => {
    let cx = x + (colW - textWidth(text)) / 2;
    for (const ch of text) {
      const d = parseInt(ch, 10);
      glyph(svg, G.timeSig0 + d, cx, baseline, size, family);
      cx += TIME_DIGIT_EM[d] * size;
    }
  };
  // Each digit's ink is centred on its half of the staff (ink spans about 0.26 em above
  // and 0.245 em below the baseline, so the visual centre sits roughly on the baseline).
  drawNumber(num, y0 + ls + TIME_DIGIT_CENTRE_EM * size);
  drawNumber(den, y0 + 3 * ls + TIME_DIGIT_CENTRE_EM * size);
  return x + colW;
}

/**
 * Draws one measure of a tab row: string lines and fret numbers centred on each note's slot.
 * Used by both coupled blocks (under the staff) and tab-only blocks.
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
  xPos: number,
  measureWidth: number,
  numberOffset = 0,
  minGaps?: number[]
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

  if (!measure.notes.length) return;
  // Same note positions as the staff, so each fret number sits under its notehead.
  const centres = noteCentres(measure.notes, xStart, width, minGaps);
  measure.notes.forEach((note, i) => {
    const x = centres[i];
    const positions = tabPositionsFor(note, tuning);
    for (const { str, fret } of positions) {
      const y = tabY0 + (str - 1) * tabSpacing;
      const label = String(fret);
      // Break the string line behind the number, as VexFlow tab does. The gap is only as tall as
      // the digit, so it cannot cover the number on the next string in a chord.
      const w = label.length * size * 0.6 + 4;
      const h = size * 0.72;
      svg.appendChild(
        el("rect", { x: x - w / 2, y: y + numberOffset - h / 2, width: w, height: h, style: "fill: var(--background-primary, #fff)" })
      );
      const t = el("text", {
        x,
        y: y + numberOffset,
        "dominant-baseline": "central",
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

/** Stem direction and beam height shared by every note in a beam group. */
interface BeamStem {
  up: boolean;
  tipY: number;
}

/** Lays out notes across the measure in equal horizontal slots, with beamed groups for 8th and shorter notes. */
function layoutMeasureNotes(
  svg: SVGElement,
  measure: ScoreMeasure,
  xStart: number,
  width: number,
  y0: number,
  clef: string,
  family: string,
  size: number,
  lineSpacing: number,
  timeSig: string,
  headScale: number,
  minGaps?: number[]
): void {
  const notes = measure.notes;
  if (!notes.length) return;
  const bottomStep = BOTTOM_LINE_STEP[clef] ?? BOTTOM_LINE_STEP.treble;
  const bottomY = y0 + 4 * lineSpacing;
  const middleY = bottomY - 2 * lineSpacing;
  const xs = noteCentres(notes, xStart, width, minGaps);
  const headYs = notes.map((note) =>
    note.isRest ? [] : (note.pitches ?? []).map((p) => bottomY - ((stepOf(p) - bottomStep) * lineSpacing) / 2)
  );

  // All notes in a group share one stem direction, set by the group's average pitch.
  const beamed = new Map<number, BeamStem>();
  const groups = beamGroups(notes, timeSig);
  const headW = size * 0.3 * headScale;
  for (const g of groups) {
    const all = g.flatMap((i) => headYs[i]);
    if (!all.length) continue;
    const avgY = all.reduce((a, b) => a + b, 0) / all.length;
    const up = avgY > middleY;
    // Beamed stems run 3 staff spaces from the notehead farthest from the beam, then the beam is fitted to them.
    const groupExtreme = up ? Math.max(...all) : Math.min(...all);
    const natural = g.map((i) => {
      const ys = headYs[i];
      const farthest = ys.length ? (up ? Math.max(...ys) : Math.min(...ys)) : groupExtreme;
      return up ? farthest - 3 * lineSpacing : farthest + 3 * lineSpacing;
    });
    const stemXs = g.map((i) => xs[i] + (up ? headW / 2 - STEM_W / 2 : -(headW / 2 - STEM_W / 2)));
    const tips = fitBeamTips(stemXs, natural, up ? 1 : -1);
    g.forEach((i, k) => beamed.set(i, { up, tipY: tips[k] }));
  }

  notes.forEach((note, i) => {
    drawNote(svg, note, xs[i], bottomY, bottomStep, family, size, lineSpacing, beamed.get(i), headScale);
  });
  for (const g of groups) {
    drawBeamGroup(svg, notes, g, xs, beamed, size, lineSpacing, headScale);
  }
}

/** Quarter-note length of a note, including dots. */
function noteQuarters(note: ScoreNote): number {
  const base: Record<string, number> = { w: 4, h: 2, q: 1, "8": 0.5, "16": 0.25, "32": 0.125 };
  const len = base[note.duration] ?? 1;
  // A triplet note takes two-thirds of its written value.
  return (note.tuplet ? (2 / 3) * len : len * (2 - 1 / Math.pow(2, note.dots ?? 0)));
}

/** Number of beams (flags) a note needs. Quarter notes and longer have none. */
function beamCount(note: ScoreNote): number {
  if (note.isRest) return 0;
  return note.duration === "8" ? 1 : note.duration === "16" ? 2 : note.duration === "32" ? 3 : 0;
}

/**
 * Beat length in quarter notes. Simple meters use the denominator's beat. Compound meters
 * (6/8, 9/8, 12/8) use the dotted-quarter beat.
 */
function beatQuarters(timeSig: string): { beat: number; compound: boolean } {
  const [numRaw, denRaw] = timeSig.split("/");
  const num = parseInt(numRaw, 10);
  const den = parseInt(denRaw, 10);
  if (!num || !den) return { beat: 1, compound: false };
  const compound = den === 8 && num % 3 === 0 && num >= 6;
  return { beat: compound ? 1.5 : 4 / den, compound };
}

/**
 * Splits a measure into beam groups of two or more notes. Eighths group every two beats
 * (every beat in compound meters), triplets and 16ths and 32nds group every beat. Rests and longer
 * notes break a group. Single notes keep their flags.
 */
/**
 * Port of VexFlow's Beam.calculateSlope: picks the beam slope and vertical shift that keep every
 * stem at least its natural length, while staying close to the ideal slope. Returns each stem's tip.
 * `dir` is 1 for stems pointing up and -1 for stems pointing down, matching VexFlow's Stem.UP.
 */
function fitBeamTips(xs: number[], natural: number[], dir: number): number[] {
  const MAX_SLOPE = 0.25;
  const MIN_SLOPE = -0.25;
  const ITERATIONS = 20;
  const SLOPE_COST = 100;
  const n = xs.length;
  const firstX = xs[0];
  const firstY = natural[0];
  const lastX = xs[n - 1];
  const initialSlope = lastX > firstX ? (natural[n - 1] - firstY) / (lastX - firstX) : 0;
  const idealSlope = initialSlope / 2;
  const increment = (MAX_SLOPE - MIN_SLOPE) / ITERATIONS;
  let minCost = Number.MAX_VALUE;
  let bestSlope = 0;
  let bestShift = 0;
  for (let slope = MIN_SLOPE; slope <= MAX_SLOPE + 1e-9; slope += increment) {
    let extension = 0;
    let shift = 0;
    for (let i = 1; i < n; i++) {
      const adjusted = firstY + (xs[i] - firstX) * slope + shift;
      const tip = natural[i];
      if (tip * dir < adjusted * dir) {
        const diff = Math.abs(tip - adjusted);
        shift += diff * -dir;
        extension += diff * i;
      } else {
        extension += (tip - adjusted) * dir;
      }
    }
    const cost = SLOPE_COST * Math.abs(idealSlope - slope) + Math.abs(extension);
    if (cost < minCost) {
      minCost = cost;
      bestSlope = slope;
      bestShift = shift;
    }
  }
  return xs.map((x) => firstY + (x - firstX) * bestSlope + bestShift);
}

function beamGroups(notes: ScoreNote[], timeSig: string): number[][] {
  const { beat, compound } = beatQuarters(timeSig);
  const groups: number[][] = [];
  let cur: number[] = [];
  let curKey: string | null = null;
  const flush = () => {
    if (cur.length >= 2) groups.push(cur);
    cur = [];
    curKey = null;
  };
  let pos = 0;
  notes.forEach((note, i) => {
    const count = beamCount(note);
    if (count === 0) {
      flush();
    } else {
      // Triplets group every beat like 16ths. Plain 8ths group every two beats (every beat in compound meters).
      const unit = count === 1 && !note.tuplet ? beat * (compound ? 1 : 2) : beat;
      // A group is one unit of one note value and kind, so 16ths, 8ths, and triplets never share a beam.
      const key = `${note.duration}${note.tuplet ? "t" : ""}:${Math.floor((pos + 1e-9) / unit)}`;
      if (key !== curKey) flush();
      curKey = key;
      cur.push(i);
    }
    pos += noteQuarters(note);
  });
  flush();
  return groups;
}

/**
 * Draws the beams for one group. Primary beam runs across the whole group, and secondary beams
 * cover only the runs of notes that need them. A lone note at a secondary level gets a stub.
 */
function drawBeamGroup(
  svg: SVGElement,
  notes: ScoreNote[],
  group: number[],
  xs: number[],
  beamed: Map<number, BeamStem>,
  size: number,
  ls: number,
  headScale: number
): void {
  const first = beamed.get(group[0]);
  if (!first) return;
  const { up } = first;
  const headW = size * 0.3 * headScale;
  const sx = (k: number) => xs[group[k]] + (up ? headW / 2 - STEM_W / 2 : -headW / 2 + STEM_W / 2);
  // VexFlow's beam is 5 px thick at 10 px staff spacing, with 1.5x spacing between levels.
  const beamH = ls * 0.5;
  const step = beamH * 1.5;
  const stubLen = ls * 1.2;
  const maxLevel = Math.max(...group.map((i) => beamCount(notes[i])));
  // Beam slope follows the first and last stem tips, clamped to VexFlow's maxSlope (0.25 px per px).
  const x1 = sx(0);
  const x2 = sx(group.length - 1);
  const tipAt = (k: number) => beamed.get(group[k])!.tipY;
  const slopeRaw = x2 > x1 ? (tipAt(group.length - 1) - tipAt(0)) / (x2 - x1) : 0;
  const slope = Math.max(-0.25, Math.min(0.25, slopeRaw));
  const tipY = tipAt(0);

  for (let level = 1; level <= maxLevel; level++) {
    const off = (level - 1) * step;
    // Stacked beams move toward the notehead, away from the beam's outer edge.
    const yAt = (x: number) => (up ? tipY + slope * (x - x1) + off : tipY + slope * (x - x1) - off - beamH);
    const needs = group.map((i) => beamCount(notes[i]) >= level);
    let k = 0;
    while (k < group.length) {
      if (!needs[k]) {
        k++;
        continue;
      }
      let end = k;
      while (end + 1 < group.length && needs[end + 1]) end++;
      if (end > k) {
        const bx1 = sx(k);
        const bx2 = sx(end);
        const t1 = yAt(bx1);
        const t2 = yAt(bx2);
        svg.appendChild(
          el("polygon", {
            points: `${bx1},${t1} ${bx2},${t2} ${bx2},${t2 + beamH} ${bx1},${t1 + beamH}`,
            style: "fill: var(--text-normal, #000)",
          })
        );
      } else {
        const bx1 = sx(k);
        const bx2 = k === 0 ? bx1 + stubLen : bx1 - stubLen;
        const xa = Math.min(bx1, bx2);
        const xb = Math.max(bx1, bx2);
        const t1 = yAt(xa);
        const t2 = yAt(xb);
        svg.appendChild(
          el("polygon", {
            points: `${xa},${t1} ${xb},${t2} ${xb},${t2 + beamH} ${xa},${t1 + beamH}`,
            style: "fill: var(--text-normal, #000)",
          })
        );
      }
      k = end + 1;
    }
  }
}

function drawNote(
  svg: SVGElement,
  note: ScoreNote,
  x: number,
  bottomY: number,
  bottomStep: number,
  family: string,
  size: number,
  ls: number,
  beam?: BeamStem,
  headScale = 1
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
  const headW = size * 0.3 * headScale;

  const ys: number[] = [];
  for (const p of pitches) {
    const step = stepOf(p);
    // Each diatonic step is half a staff space.
    const yHead = bottomY - ((step - bottomStep) * ls) / 2;
    ys.push(yHead);
    drawLedgers(svg, x, yHead, bottomY, ls, headW);
    if (p.accidental) {
      const acc =
        p.accidental.includes("#") ? G.accidentalSharp
        : p.accidental.includes("b") ? G.accidentalFlat
        : G.accidentalNatural;
      const accEm = p.accidental.includes("#") ? ACC_EM.sharp : p.accidental.includes("b") ? ACC_EM.flat : ACC_EM.natural;
      // Right edge sits a small clearance left of the notehead's left edge.
      glyph(svg, acc, x - headW / 2 - ACC_HEAD_GAP * size - accEm * size, yHead, size, family);
    }
    glyph(svg, head, x - headW / 2, yHead, size * headScale, family);
  }

  // Stem and flags. Stems go up when the note sits below the middle line.
  if (note.duration !== "w") {
    const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
    const stemUp = beam ? beam.up : avgY > middleY;
    const stemLen = 3.5 * ls;
    const extreme = stemUp ? Math.min(...ys) : Math.max(...ys);
    const sx = stemUp ? x + headW / 2 - STEM_W / 2 : x - headW / 2 + STEM_W / 2;
    // Beamed stems start at the notehead farthest from the beam and end at the beam.
    const sy1 = beam ? (stemUp ? Math.max(...ys) : Math.min(...ys)) : extreme;
    const sy2 = beam ? beam.tipY : stemUp ? extreme - stemLen : extreme + stemLen;
    svg.appendChild(
      el("line", { x1: sx, x2: sx, y1: sy1, y2: sy2, style: "stroke: var(--text-normal, #000)", "stroke-width": STEM_W })
    );
    if (!beam) {
      const flag = flagFor(note.duration, stemUp);
      if (flag) glyph(svg, flag, sx, sy2, size, family);
    }
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
function drawLedgers(svg: SVGElement, x: number, yHead: number, bottomY: number, ls: number, headW: number): void {
  const topY = bottomY - 4 * ls;
  // VexFlow's ledger runs 3 px past each side of the notehead glyph.
  const half = headW / 2 + LEDGER_OVERHANG;
  const lineAt = (y: number) =>
    svg.appendChild(
      el("line", { x1: x - half, x2: x + half, y1: y, y2: y, style: "stroke: var(--text-normal, #000)", "stroke-width": 1 })
    );
  if (yHead > bottomY + ls / 2) {
    for (let y = bottomY + ls; y <= yHead + 0.01; y += ls) lineAt(y);
  } else if (yHead < topY - ls / 2) {
    for (let y = topY - ls; y >= yHead - 0.01; y -= ls) lineAt(y);
  }
}
