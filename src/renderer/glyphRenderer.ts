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
  // Tab-only blocks draw just the tab row, with no staff above it.
  const isTabOnly = score.mode === "tab";
  const numStrings = score.tuning.length || 6;
  const tabSpacing = Math.max(8, options.tabLineSpacing ?? 16);
  const tabHeight = (numStrings - 1) * tabSpacing;
  // Gap between the staff and its tab row in coupled blocks.
  const COUPLED_STAFF_TAB_GAP = 60;
  const tabOffset = 4 * lineSpacing + COUPLED_STAFF_TAB_GAP;
  const blockHeight = isTabOnly ? tabHeight + 20 : isCoupled ? tabOffset + tabHeight + 20 : staffHeight;
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
      // No staff: only the tab row, with the system connector and barlines around it.
      const tabY0 = y0;
      if (measureInLine === 0) {
        svg.appendChild(
          el("line", { x1: xPos, x2: xPos, y1: tabY0, y2: tabY0 + tabHeight, style: "stroke: var(--text-normal, #000)", "stroke-width": 1 })
        );
      }
      drawTabMeasure(svg, measure, xPos + 30, thisMeasureWidth - 40, tabY0, tabSpacing, numStrings, score.tuning, tabFont, tabSize, xPos, thisMeasureWidth);
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

    if (measureInLine === 0) {
      const mClef = measure.clef || clef;
      const clefCp = mClef === "bass" ? G.fClef : mClef === "alto" || mClef === "tenor" ? G.cClef : G.gClef;
      glyph(svg, clefCp, xPos + 4, clefBaselineY(mClef, y0, lineSpacing), glyphSize, family);
    }

    // Left edge barline is drawn where VexFlow would
    // In coupled blocks the line start is drawn as one system connector below.
    if ((measureInLine === 0 && !isCoupled) || isLastOnLine || measure.barline) {
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

    layoutMeasureNotes(svg, measure, xPos + 30, thisMeasureWidth - 40, y0, clef, family, glyphSize, lineSpacing, currentTimeSig);

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
      drawTabMeasure(svg, measure, xPos + 30, thisMeasureWidth - 40, tabY0, tabSpacing, numStrings, score.tuning, tabFont, tabSize, xPos, thisMeasureWidth);
    }
  }

  return wrapper;
}

/** Slot centre x for note `i` of `n`, matching `layoutMeasureNotes`. */
function slotX(i: number, n: number, xStart: number, width: number): number {
  return xStart + (width / n) * i + width / n / 2;
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

  const n = measure.notes.length;
  if (!n) return;
  // Same slots as the staff notes, so each fret number sits under its notehead.
  measure.notes.forEach((note, i) => {
    const x = slotX(i, n, xStart, width);
    const positions = tabPositionsFor(note, tuning);
    for (const { str, fret } of positions) {
      const y = tabY0 + (str - 1) * tabSpacing;
      const label = String(fret);
      // Break the string line behind the number, as VexFlow tab does.
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
  timeSig: string
): void {
  const notes = measure.notes;
  if (!notes.length) return;
  const slot = width / notes.length;
  const bottomStep = BOTTOM_LINE_STEP[clef] ?? BOTTOM_LINE_STEP.treble;
  const bottomY = y0 + 4 * lineSpacing;
  const middleY = bottomY - 2 * lineSpacing;
  const stemLen = 3.5 * lineSpacing;
  const xs = notes.map((_, i) => xStart + slot * i + slot / 2);
  const headYs = notes.map((note) =>
    note.isRest ? [] : (note.pitches ?? []).map((p) => bottomY - ((stepOf(p) - bottomStep) * lineSpacing) / 2)
  );

  // All notes in a group share one stem direction, set by the group's average pitch.
  const beamed = new Map<number, BeamStem>();
  const groups = beamGroups(notes, timeSig);
  for (const g of groups) {
    const all = g.flatMap((i) => headYs[i]);
    if (!all.length) continue;
    const avgY = all.reduce((a, b) => a + b, 0) / all.length;
    const up = avgY > middleY;
    // One beam height for the whole group, so every stem reaches the same line.
    const tipY = up ? Math.min(...all) - stemLen : Math.max(...all) + stemLen;
    for (const i of g) beamed.set(i, { up, tipY });
  }

  notes.forEach((note, i) => {
    drawNote(svg, note, xs[i], bottomY, bottomStep, family, size, lineSpacing, beamed.get(i));
  });
  for (const g of groups) {
    drawBeamGroup(svg, notes, g, xs, beamed, size, lineSpacing);
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
  ls: number
): void {
  const first = beamed.get(group[0]);
  if (!first) return;
  const { up, tipY } = first;
  const headW = size * 0.3;
  const sx = (k: number) => xs[group[k]] + (up ? headW / 2 - 1 : -headW / 2 + 1);
  const beamH = Math.max(1.5, ls * 0.5);
  const step = beamH + ls * 0.25;
  const stubLen = ls * 1.2;
  const maxLevel = Math.max(...group.map((i) => beamCount(notes[i])));

  for (let level = 1; level <= maxLevel; level++) {
    const off = (level - 1) * step;
    // Stacked beams move toward the notehead, away from the beam's outer edge.
    const yTop = up ? tipY + off : tipY - off - beamH;
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
        const x1 = sx(k);
        const x2 = sx(end);
        svg.appendChild(
          el("polygon", {
            points: `${x1},${yTop} ${x2},${yTop} ${x2},${yTop + beamH} ${x1},${yTop + beamH}`,
            style: "fill: var(--text-normal, #000)",
          })
        );
      } else {
        const x1 = sx(k);
        const x2 = k === 0 ? x1 + stubLen : x1 - stubLen;
        const xa = Math.min(x1, x2);
        const xb = Math.max(x1, x2);
        svg.appendChild(
          el("polygon", {
            points: `${xa},${yTop} ${xb},${yTop} ${xb},${yTop + beamH} ${xa},${yTop + beamH}`,
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
  beam?: BeamStem
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
    const stemUp = beam ? beam.up : avgY > middleY;
    const stemLen = 3.5 * ls;
    const extreme = stemUp ? Math.min(...ys) : Math.max(...ys);
    const sx = stemUp ? x + headW / 2 - 1 : x - headW / 2 + 1;
    // Beamed stems start at the notehead farthest from the beam and end at the beam.
    const sy1 = beam ? (stemUp ? Math.max(...ys) : Math.min(...ys)) : extreme;
    const sy2 = beam ? beam.tipY : stemUp ? extreme - stemLen : extreme + stemLen;
    svg.appendChild(
      el("line", { x1: sx, x2: sx, y1: sy1, y2: sy2, style: "stroke: var(--text-normal, #000)", "stroke-width": Math.max(1.5, ls * 0.15) })
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
function drawLedgers(svg: SVGElement, x: number, yHead: number, bottomY: number, ls: number): void {
  const topY = bottomY - 4 * ls;
  const half = ls * 1.0;
  const lineAt = (y: number) =>
    svg.appendChild(
      el("line", { x1: x - half, x2: x + half, y1: y, y2: y, style: "stroke: var(--text-normal, #000)", "stroke-width": Math.max(1.2, ls * 0.2) })
    );
  if (yHead > bottomY + ls / 2) {
    for (let y = bottomY + ls; y <= yHead + 0.01; y += ls) lineAt(y);
  } else if (yHead < topY - ls / 2) {
    for (let y = topY - ls; y >= yHead - 0.01; y -= ls) lineAt(y);
  }
}
