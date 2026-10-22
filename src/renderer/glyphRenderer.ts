/**
 * Staff notation drawn with SMuFL glyphs from the bundled music fonts, rather than
 * VexFlow's glyph paths. Used for notation and coupled blocks unless they set
 * `glyphs: vexflow`. Coupled blocks get a tab row under each staff. Tab-only blocks
 * still use VexFlow.
 */
import { NotationScore, ScoreMeasure, ScoreNote, NotePitch } from "../types";
import { applyChordTextStyle } from "./chordGridRenderer";
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
  /** Vertical space in px between systems (default 20). */
  systemGap?: number;
  /** Vertical space in px between the staff and chord symbols above it (default 8). */
  chordDistance?: number;
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
/** Bravura notehead advance widths in em (black/half and whole). */
const HEAD_ADVANCE_BLACK = 0.295;
const HEAD_ADVANCE_WHOLE = 0.422;

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
  const isCoupled = score.mode === "coupled";
  // Tab-only blocks draw just the tab row, with no staff above it.
  const isTabOnly = score.mode === "tab";
  // Room below the staff for notes that drop beneath it (ledger lines and their stems). Zero when none do.
  const staffBelow = !isTabOnly && !isCoupled ? staffDrop(score, clef, lineSpacing) : 0;
  const staffHeight = 4 * lineSpacing + staffBelow;
  const numStrings = score.tuning.length || 6;
  // Tab strings share the staff's line spacing so the two read as one grid, but never tighter
  // than a fret number's height plus a small margin, so stacked chord numbers do not overlap.
  const tabSize = options.tabFontSize ?? 13;
  const tabSpacing = Math.max(lineSpacing, tabSize * 0.72 + 2);
  const tabHeight = (numStrings - 1) * tabSpacing;
  const tabOffset = 4 * lineSpacing + COUPLED_STAFF_TAB_GAP;
  // Chord symbols sit above the staff and lyrics below it. Room is only reserved when the score uses them.
  const hasChords = score.measures.some((m) => m.notes.some((n) => n.chordSymbol));
  const hasLyrics = score.measures.some((m) => m.notes.some((n) => n.lyric || n.lyricHold));
  // Per-note text above and below the notehead, in the same rows as chords and lyrics.
  const hasTextAbove = score.measures.some((m) => m.notes.some((n) => n.textAbove));
  const hasTextBelow = score.measures.some((m) => m.notes.some((n) => n.textBelow));
  const chordDistance = Math.max(0, options.chordDistance ?? CHORD_DISTANCE_DEFAULT) * scale;
  const maxLift = hasChords && !isTabOnly ? maxChordLift(score, clef, lineSpacing) : 0;
  // The room is at least the original chord room, so default layouts keep their height.
  const aboveRoom = hasTextAbove && !isTabOnly ? NOTE_TEXT_ROOM * scale : 0;
  const chordRoom = (hasChords || hasTextAbove) && !isTabOnly ? Math.max(CHORD_ROOM * scale, chordDistance + CHORD_TEXT_HEIGHT * scale + maxLift + aboveRoom) : 0;
  // Below-staff room is reserved for lyrics and for {below:} note text.
  const lyricRoom = (hasLyrics || hasTextBelow) && !isTabOnly ? LYRIC_ROOM * scale : 0;
  const blockHeight = (isTabOnly ? tabHeight + 20 : isCoupled ? tabOffset + tabHeight + 2 : staffHeight) + chordRoom + lyricRoom;
  const tabFont = options.tabFontFamily ?? family;
  const tabNumberOffset = options.tabNumberOffset ?? 0;
  const headScale = options.noteheadScale ?? 1;
  const spacing = Math.max(0, options.spacingScale ?? 1);
  const noteGap = NOTE_GAP * spacing;
  const noteEndInset = NOTE_END_INSET * spacing;
  // SMuFL glyphs are drawn so that one staff space is 0.25 em. Staff lines are 4 spaces apart.
  const glyphSize = lineSpacing * 4 * scale;
  const { starts: systemStarts, widths: measureWidths } = breakSystems(score, containerWidth, measuresPerLine, isTabOnly, clef, glyphSize, noteGap, noteEndInset, tabSize, headScale, isCoupled);
  const totalLines = systemStarts.length;
  const systemGap = Math.max(0, options.systemGap ?? 20);
  const totalHeight = totalLines * (blockHeight + systemGap) + 8;
  // Y of the top staff line in each system, below the chord-symbol room. The room is shared by all
  // systems, so the gap between systems already accounts for chords raised above the staff.
  const staffTop = (lineIndex: number) => 20 + lineIndex * (blockHeight + systemGap) + chordRoom;

  const svg = el("svg", {
    class: "br-notation-svg br-glyph-svg",
    viewBox: `${-PAD} ${-PAD} ${containerWidth + PAD * 2} ${totalHeight + PAD * 2}`,
    width: "100%",
    style: "max-width: 100%; height: auto; display: block;",
  }) as SVGSVGElement;
  wrapper.appendChild(svg);


  // A measure's time signature applies to it and every measure after it until the next change.
  let currentTimeSig = score.timeSignature;
  const staffSpots = new Map<string, Spot>();
  const tabSpots = new Map<string, Spot>();
  for (let mIdx = 0; mIdx < score.measures.length; mIdx++) {
    const measure = score.measures[mIdx];
    if (measure.timeSignature) currentTimeSig = measure.timeSignature;
    const lineIndex = systemStarts.findLastIndex((s) => s <= mIdx);
    const lineStart = systemStarts[lineIndex];
    const lineEnd = lineIndex + 1 < systemStarts.length ? systemStarts[lineIndex + 1] : score.measures.length;
    const measureInLine = mIdx - lineStart;
    // Each measure is sized by its content (see breakSystems). The first measure of a system
    // carries the header (clef, key, time signature) in its box, so later boxes start after it.
    const lineFirst = score.measures[lineStart];
    let xPos = 0;
    for (let k = lineStart; k < mIdx; k++) xPos += measureWidths[k];
    const isLastOnLine = mIdx === lineEnd - 1;
    const thisMeasureWidth = isLastOnLine ? containerWidth - xPos : measureWidths[mIdx];
    const y0 = staffTop(lineIndex);

    if (isTabOnly) {
      const tabNoteStart = xPos + noteGap;
      // No staff: only the tab row, with the system connector and barlines around it.
      const tabY0 = y0;
      if (measureInLine === 0) {
        svg.appendChild(
          el("line", { x1: xPos, x2: xPos, y1: tabY0, y2: tabY0 + tabHeight, style: "stroke: var(--text-normal, #000)", "stroke-width": 1 })
        );
      }
      drawTabMeasure(svg, measure, tabNoteStart, xPos + thisMeasureWidth - noteEndInset - tabNoteStart, tabY0, tabSpacing, numStrings, score.tuning, tabFont, tabSize, xPos, thisMeasureWidth, tabNumberOffset, tabOnlyMinGaps(measure, score.tuning, tabSize), tabSpots);
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
      const clefEnd = xPos + 4 + clefWidth(mClef, glyphSize);
      const key = measure.keySignature || score.keySignature;
      const keyX = clefEnd + CLEF_EXTRA_SPACE;
      const keyEnd = key ? drawKeySignature(svg, key, mClef, keyX, y0, glyphSize, lineSpacing, family) : clefEnd;
      // The score's time signature shows only at the start of the score; later systems show it only
      // where a measure changes it.
      const ts = headerTimeSig(measure, score, lineIndex === 0);
      let headerEnd = keyEnd;
      if (ts) {
        const tsX = timeSigX(clefEnd, key ? keyEnd : undefined, ts, glyphSize);
        headerEnd = drawTimeSignature(svg, ts, tsX, y0, glyphSize, lineSpacing, family);
      }
      noteStartX = headerEnd + noteGap;
    }

    // Barlines follow the VexFlow staff: the first measure of a line gets a left edge, and
    // each measure's right edge uses its closing barline type. In coupled blocks the line
    // start is drawn as one system connector below.
    // A repeat start is drawn at the left edge of its measure even mid-line, where it sits
    // between the previous measure and this one.
    const repeatStart = measure.startBarline === "repeat-begin";
    if (!isCoupled && (measureInLine === 0 || repeatStart)) {
      drawBarlineLeft(svg, xPos, y0, 4 * lineSpacing, repeatStart);
    } else if (isCoupled && repeatStart && measureInLine > 0) {
      drawBarlineLeft(svg, xPos, y0, 4 * lineSpacing, true);
    }
    drawBarlineRight(svg, xPos + thisMeasureWidth, y0, 4 * lineSpacing, measure.barline, isLastOnLine, family, glyphSize);

    const noteXs = layoutMeasureNotes(svg, measure, noteStartX, xPos + thisMeasureWidth - noteEndInset - noteStartX, y0, clef, family, glyphSize, lineSpacing, currentTimeSig, headScale, measureMinGaps(measure, score.tuning, tabSize, isCoupled, headScale, glyphSize), scale, staffSpots);
    // Chord symbols sit above the staff. Lyrics sit below the notation staff (in coupled blocks, above the tab).
    drawNoteTexts(svg, measure.notes, noteXs, y0, lineSpacing, family, scale, chordRoom, lyricRoom, clef, chordDistance, glyphSize * 0.3 * headScale / 2);

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
      drawTabMeasure(svg, measure, noteStartX, xPos + thisMeasureWidth - noteEndInset - noteStartX, tabY0, tabSpacing, numStrings, score.tuning, tabFont, tabSize, xPos, thisMeasureWidth, tabNumberOffset, measureMinGaps(measure, score.tuning, tabSize, true, headScale, glyphSize), tabSpots);
      const tabHeightPx = (numStrings - 1) * tabSpacing;
      drawBarlineRight(svg, xPos + thisMeasureWidth, tabY0, tabHeightPx, measure.barline, isLastOnLine, family, glyphSize);
      if (repeatStart && (measureInLine > 0 || !isCoupled)) {
        drawBarlineLeft(svg, xPos, tabY0, tabHeightPx, true);
      }
    }
  }

  if (!isTabOnly) drawCrossMeasureHammers(svg, score, staffSpots, lineSpacing, HAMMER_LABEL_SIZE, lineSpacing * 0.5 * headScale, false);
  if (isCoupled || isTabOnly) drawCrossMeasureHammers(svg, score, tabSpots, tabSpacing, HAMMER_LABEL_SIZE, tabSize * 0.3, true);

  return wrapper;
}

/**
 * One hammer-on or pull-off slur from x1 to x2 at the notes' heights y1 and y2. The slur sits
 * above the heads by default and below them when `below` is true, which is the side opposite
 * the stem. The curve bulges away from the notes and the H or P label sits on its apex.
 */
function hammerArc(
  svg: SVGElement,
  x1: number,
  x2: number,
  y1: number,
  y2: number,
  rise: number,
  label: string,
  textSize: number,
  below = false
): void {
  // Height grows with the span but is capped at `rise`, and the control points sit inside the span
  // so the curve leaves each head at a gentle angle rather than straight up.
  const span = x2 - x1;
  const h = Math.min(rise, span * 0.11) * 0.5;
  const dir = below ? 1 : -1;
  const dx = span * 0.3;
  const d = `M ${x1} ${y1} C ${x1 + dx} ${y1 + dir * h} ${x2 - dx} ${y2 + dir * h} ${x2} ${y2}`;
  svg.appendChild(el("path", { d, class: "br-hammer-arc", "stroke-width": STEM_W, "stroke-linecap": "round" }));
  const apex = (y1 + y2) / 2 + dir * h * 0.75;
  if (label) svg.appendChild(noteText((x1 + x2) / 2, apex + (below ? textSize : -textSize * 0.5), label, textSize));
}

/**
 * Draws hammer-on and pull-off arcs whose start note is in an earlier measure. The arc
 * joins the two recorded note positions, so it runs across the barline.
 */
function drawCrossMeasureHammers(
  svg: SVGElement,
  score: NotationScore,
  spots: Map<string, Spot>,
  unit: number,
  textSize: number,
  headHalf: number,
  showLabel: boolean
): void {
  for (const measure of score.measures) {
    measure.notes.forEach((note, i) => {
      if (!note.hammerPull || note.isRest || !note.hammerFrom) return;
      if (note.hammerFrom.measure === measure.number) return;
      const from = spots.get(spotKey(note.hammerFrom.measure, note.hammerFrom.index));
      const to = spots.get(spotKey(measure.number, i));
      if (!from || !to) return;
      // Arcs leave the destination's stem side: above the top head when the stem points down, below the bottom head when it points up.
      const below = to.stemUp === true;
      const y1 = below ? from.bottom + unit * 0.4 : from.y - unit * 0.4;
      const y2 = below ? to.bottom + unit * 0.4 : to.y - unit * 0.4;
      hammerArc(svg, from.x + headHalf, to.x - headHalf, y1, y2, unit * 1.2, showLabel ? (note.hammerPull === "h" ? "H" : "P") : "", textSize, below);
    });
  }
}

/** Per-note minimum gaps, shared by the staff and tab so both rows use one set of positions. */
function measureMinGaps(measure: ScoreMeasure, tuning: string[], tabSize: number, coupled: boolean, headScale: number, size: number): number[] {
  return partAwareGaps(measure.notes, noteMinGaps(measure.notes, tuning, coupled ? tabSize : 0, headScale, size));
}

/**
 * With parts, notes that start together share one onset, so each onset needs only its widest gap.
 * The first note at an onset keeps that gap and the others get zero, so summing the gaps counts each onset once.
 */
function partAwareGaps(notes: ScoreNote[], gaps: number[]): number[] {
  if (!notes.some((n) => n.voice !== undefined)) return gaps;
  const { onsetOf, onsetCount } = partCentres(notes, 0, 0, gaps);
  const onsetGap = new Array(onsetCount).fill(0);
  const seen = new Array(onsetCount).fill(false);
  notes.forEach((_, i) => {
    onsetGap[onsetOf[i]] = Math.max(onsetGap[onsetOf[i]], gaps[i]);
  });
  return notes.map((_, i) => {
    const k = onsetOf[i];
    if (seen[k]) return 0;
    seen[k] = true;
    return onsetGap[k];
  });
}

/**
 * Minimum centre-to-centre gap each note needs. In tab mode it clears the widest tab label;
 * for any note with an accidental it also reserves room for the accidental to the left of its head.
 */
function noteMinGaps(notes: ScoreNote[], tuning: string[], tabSize: number, headScale: number, size: number): number[] {
  const headHalf = (size * 0.3 * headScale) / 2;
  return notes.map((note, i) => {
    // Beamed notes need a wider gap so the beam's slope and the stems stay clear of neighbours.
    let gap = beamCount(note) > 0 ? NOTE_MIN_GAP + 6 : NOTE_MIN_GAP;
    if (tabSize > 0) {
      const labels = note.isRest ? [] : tabPositionsFor(note, tuning).map((p) => String(p.fret));
      const widest = labels.reduce((m, l) => Math.max(m, l.length), 1);
      gap = Math.max(gap, widest * tabSize * 0.6 + 6);
    }
    const accWidth = note.isRest || !note.pitches ? 0 : accidentalLayout(note.pitches, size).total;
    if (accWidth > 0) {
      // Room for the accidental plus its clearance from the previous note's head.
      gap = Math.max(gap, accWidth + ACC_HEAD_GAP * size + headHalf * 2 + ACC_PREV_GAP * size);
    }
    return gap;
  });
}

/** Tab-only blocks draw no staff, so they only need room for the tab labels. */
function tabOnlyMinGaps(measure: ScoreMeasure, tuning: string[], tabSize: number): number[] {
  const gaps = measure.notes.map((note) => {
    const labels = note.isRest ? [] : tabPositionsFor(note, tuning).map((p) => String(p.fret));
    const widest = labels.reduce((m, l) => Math.max(m, l.length), 1);
    return Math.max(NOTE_MIN_GAP, widest * tabSize * 0.6 + 6);
  });
  return partAwareGaps(measure.notes, gaps);
}

/** Drawn width of one accidental. Accidental advances are Bravura em widths. */
function accidentalDrawnWidth(p: NotePitch, size: number): number {
  const em = p.accidental!.includes("#") ? ACC_EM.sharp : p.accidental!.includes("b") ? ACC_EM.flat : ACC_EM.natural;
  return em * size * ACC_SCALE;
}

/**
 * Horizontal placement of a chord's accidentals. Accidentals whose notes sit within a fourth of
 * each other would overlap, so each one moves to the first column (further left) that is clear.
 * `shifts[i]` is how far left pitch i's accidental sits beyond the notehead clearance; `total` is
 * the full width the accidentals occupy to the left of the notehead.
 */
function accidentalLayout(pitches: NotePitch[], size: number): { shifts: number[]; total: number } {
  const shifts = pitches.map(() => 0);
  const order = pitches
    .map((p, i) => i)
    .filter((i) => pitches[i].accidental)
    .sort((a, b) => stepOf(pitches[b]) - stepOf(pitches[a]));
  const cols: { steps: number[]; width: number }[] = [];
  const colOf: number[] = [];
  for (const i of order) {
    const s = stepOf(pitches[i]);
    let k = 0;
    while (cols[k] && cols[k].steps.some((t) => Math.abs(t - s) < ACC_STAGGER_STEPS)) k++;
    if (!cols[k]) cols[k] = { steps: [], width: 0 };
    cols[k].steps.push(s);
    cols[k].width = Math.max(cols[k].width, accidentalDrawnWidth(pitches[i], size));
    colOf[i] = k;
  }
  const colShift: number[] = [];
  let total = 0;
  for (let k = 0; k < cols.length; k++) {
    colShift[k] = total;
    total += cols[k].width + ACC_PREV_GAP * size;
  }
  for (const i of order) shifts[i] = colShift[colOf[i]];
  return { shifts, total: total > 0 ? total - ACC_PREV_GAP * size : 0 };
}

/**
 * Centre x of each note in a measure, shared by the staff and tab rows so they line up.
 *
 * Uses a LilyPond-style spring model. Each note gets a spring whose stiffness grows with the
 * logarithm of its duration, so doubling a note adds the same space rather than doubling it.
 * The base is the shortest duration in the bar, capped at an eighth note. Every note's spring
 * also covers the space after it, so the last note's spring is its trailing space before the
 * barline. Equal notes therefore sit evenly across the bar: two half-note chords put the second
 * chord at beat 3. Each spring is at least that note's minimum gap, and one scale factor is
 * solved so the springs fill the bar. If the minimum gaps alone overflow, the notes keep their
 * minimums and the bar is simply tighter.
 */
const SPACING_BASE_MAX = 0.5; // quarter-note units; an eighth note is the largest base

function noteCentres(notes: ScoreNote[], xStart: number, width: number, minGaps?: number[]): number[] {
  const n = notes.length;
  if (!n) return [];
  const xs = [xStart];
  if (n === 1) return xs;

  const minGapAt = (i: number) => minGaps?.[i] ?? NOTE_MIN_GAP;
  const ticks = notes.map(noteQuarters);
  const base = Math.min(SPACING_BASE_MAX, Math.min(...ticks));
  const springs = ticks.map((t) => 1 + Math.log2(t / base));

  // Gap j is the space after note j. Its minimum is the next note's min gap, or half the
  // last note's min gap for the trailing space, which avoids an empty slot before the barline.
  const minAfter = (j: number) => (j < n - 1 ? minGapAt(j + 1) : minGapAt(n - 1) / 2);
  // The springs include the trailing gap, so together they fill the whole bar.
  const span = width;
  const gapsFor = (scale: number) => springs.map((w, j) => Math.max(minAfter(j), scale * w));
  const sumFor = (scale: number) => gapsFor(scale).reduce((a, b) => a + b, 0);

  let scale = 0;
  if (sumFor(0) < span) {
    let lo = 0;
    let hi = Math.max(span, 1);
    while (sumFor(hi) < span) hi *= 2;
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2;
      if (sumFor(mid) < span) lo = mid;
      else hi = mid;
    }
    scale = hi;
  }

  // Note i sits after the gaps of notes 0..i-1.
  const gaps = gapsFor(scale);
  for (let i = 1; i < n; i++) xs.push(xs[i - 1] + gaps[i - 1]);
  return xs;
}

/**
 * Lays out the notes of a measure that has parts (`V1:` / `V2:`). Notes that start at the same
 * time in each part share one x position, so the parts line up like a score. Returns the x of each
 * note by its index in `measure.notes`, plus the onset list used for spacing.
 */
function partCentres(
  notes: ScoreNote[],
  xStart: number,
  width: number,
  minGaps?: number[]
): { xs: number[]; onsetOf: number[]; onsetCount: number } {
  const onsetTimes: number[] = [];
  const onsetOf: number[] = [];
  const onsetGap: number[] = [];
  const cursor: Record<number, number> = { 1: 0, 2: 0 };
  notes.forEach((note, i) => {
    const part = note.voice ?? 1;
    const t = cursor[part];
    let k = onsetTimes.findIndex((o) => Math.abs(o - t) < 1e-9);
    if (k < 0) {
      onsetTimes.push(t);
      onsetGap.push(0);
      k = onsetTimes.length - 1;
    }
    onsetOf[i] = k;
    onsetGap[k] = Math.max(onsetGap[k], minGaps?.[i] ?? NOTE_MIN_GAP);
    cursor[part] = t + noteQuarters(note);
  });
  // Space the shared onsets with the same rules as one part, using the shortest note at each onset as the spring
  const onsetNotes = onsetTimes.map((t, k) => {
    const at = notes.filter((_, i) => onsetOf[i] === k);
    const shortest = at.reduce((a, b) => (noteQuarters(b) < noteQuarters(a) ? b : a));
    return { ...shortest, duration: shortest.duration };
  });
  const xs = noteCentres(onsetNotes, xStart, width, onsetGap);
  return { xs: notes.map((_, i) => xs[onsetOf[i]]), onsetOf, onsetCount: onsetTimes.length };
}

/**
 * Natural width of one measure: the room its notes need at their minimum gaps, plus the end
 * inset and the gap before the barline. Measures are sized from this, so a dense bar gets
 * more width than a sparse one instead of an equal share of the line.
 */
function measureNaturalWidth(gaps: number[], noteEndInset: number, noteGap: number): number {
  return gaps.reduce((a, b) => a + b, 0) + noteEndInset + noteGap;
}

/**
 * Breaks the score into systems and sizes each measure within its system. A system takes as
 * many measures as fit at their natural widths, capped by `maxPerLine`. The spare width is
 * shared out in proportion to each measure's natural width, so a line is justified without
 * crowding its dense bars.
 */
function breakSystems(
  score: NotationScore,
  containerWidth: number,
  maxPerLine: number,
  isTabOnly: boolean,
  clef: string,
  glyphSize: number,
  noteGap: number,
  noteEndInset: number,
  tabSize: number,
  headScale: number,
  isCoupled: boolean
): { starts: number[]; widths: number[] } {
  const starts: number[] = [];
  const widths: number[] = new Array(score.measures.length).fill(0);
  const natural = score.measures.map((m) => {
    const gaps = isTabOnly ? tabOnlyMinGaps(m, score.tuning, tabSize) : measureMinGaps(m, score.tuning, tabSize, isCoupled, headScale, glyphSize);
    return measureNaturalWidth(gaps, noteEndInset, noteGap);
  });
  let i = 0;
  while (i < score.measures.length) {
    starts.push(i);
    const first = score.measures[i];
    const header = isTabOnly
      ? 0
      : headerWidth(first.clef || clef, first.keySignature || score.keySignature, headerTimeSig(first, score, i === 0), glyphSize) + noteGap;
    let used = header;
    const lineStart = i;
    let count = 0;
    while (i < score.measures.length && count < maxPerLine) {
      if (count > 0 && score.measures[i].systemBreak) break;
      if (count > 0 && used + natural[i] > containerWidth) break;
      used += natural[i];
      count++;
      i++;
    }
    // Spread the spare width over the line's measures in proportion to their natural widths.
    // The header sits in the first measure's box, so it is added there and not in the sum.
    const naturalSum = used - header;
    const spare = Math.max(0, containerWidth - used);
    for (let k = lineStart; k < i; k++) {
      widths[k] = natural[k] + (naturalSum > 0 ? (spare * natural[k]) / naturalSum : 0);
    }
    widths[lineStart] += header;
  }
  return { starts, widths };
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
/** Vertical room (px at scale 1) for chord symbols above the staff and lyrics below it. */
const CHORD_ROOM = 26;
const LYRIC_ROOM = 26;
/** Default gap (px at scale 1) between the top staff line and the chord symbol baseline. */
const CHORD_DISTANCE_DEFAULT = 8;

/**
 * How far (px) a note's highest notehead rises above the top staff line, or 0 when it stays within
 * the staff. Chord symbols over such a note are raised by this amount so they do not overlap it.
 */
function chordLift(note: ScoreNote, clef: string, lineSpacing: number): number {
  if (note.isRest || !note.pitches?.length) return 0;
  const bottomStep = BOTTOM_LINE_STEP[clef] ?? BOTTOM_LINE_STEP.treble;
  // Heights are measured from the top staff line (y = 0, growing downward), so a notehead above it
  // has a negative y. The notehead's half-height is half a staff space.
  const bottomRel = 4 * lineSpacing;
  let highestTop = Infinity;
  for (const p of note.pitches) {
    const yHead = bottomRel - ((stepOf(p) - bottomStep) * lineSpacing) / 2;
    highestTop = Math.min(highestTop, yHead - lineSpacing / 2);
  }
  return Math.max(0, -highestTop);
}

/** The largest chord lift of any chord-bearing note in the score. */
function maxChordLift(score: NotationScore, clef: string, lineSpacing: number): number {
  let lift = 0;
  for (const m of score.measures) {
    if (!m.notes.some((n) => n.chordSymbol)) continue;
    for (const n of m.notes) lift = Math.max(lift, chordLift(n, clef, lineSpacing));
  }
  return lift;
}
/**
 * How far (px) notes reach below the bottom staff line, including ledger lines and a stem's tail.
 * Returns 0 when every note sits on or above the staff, so no extra bottom room is reserved.
 */
function staffDrop(score: NotationScore, clef: string, lineSpacing: number): number {
  const bottomStep = BOTTOM_LINE_STEP[clef] ?? BOTTOM_LINE_STEP.treble;
  const bottomRel = 4 * lineSpacing;
  const middleRel = 2 * lineSpacing;
  const stemLength = 3.5 * lineSpacing;
  let lowest = 0;
  for (const m of score.measures) {
    for (const n of m.notes) {
      if (n.isRest || !n.pitches?.length) continue;
      for (const p of n.pitches) {
        const yHead = bottomRel - ((stepOf(p) - bottomStep) * lineSpacing) / 2;
        lowest = Math.max(lowest, yHead + lineSpacing / 2 - bottomRel);
        // Heads above the middle line take stems that hang down from the head.
        if (yHead < middleRel && n.duration !== "w") {
          lowest = Math.max(lowest, yHead + stemLength - bottomRel);
        }
      }
    }
  }
  return lowest > 0 ? Math.ceil(lowest) + 4 : 0;
}
/** Approximate width (px) of a chord symbol drawn at the given scale, from its character count. */
function chordTextWidth(text: string, scale: number): number {
  return text.length * CHORD_CHAR_WIDTH * scale;
}
/** Average advance (px at scale 1) per character of a chord symbol. */
const CHORD_CHAR_WIDTH = 9;
/** Approximate height (px at scale 1) of a chord symbol's text above its baseline. */
const CHORD_TEXT_HEIGHT = 14;
const LYRIC_BASELINE_GAP = 16;
/** Gap between the staff and its tab row in coupled blocks. */
const COUPLED_STAFF_TAB_GAP = 60;
const LYRIC_FONT_SIZE = 13;
/** Font size (px at scale 1) and extra height for `{above:}` text, which is smaller than chord symbols. */
const NOTE_TEXT_FONT_SIZE = 11;
/** H/P label size, the same for staff and tab hammer-on and pull-off arcs. */
const HAMMER_LABEL_SIZE = NOTE_TEXT_FONT_SIZE;
const NOTE_TEXT_ROOM = 14;
/** Gap (in staff spaces) between the notehead's outer edge and the `{circle}` ring. */
const NOTE_CIRCLE_RADIUS = 0.85;

const NOTE_GAP = 12;
/** Space kept before each measure's right barline, about half of VexFlow's 22 px. */
const NOTE_END_INSET = 11;
/** Minimum horizontal space per note, so dense measures still fit. */
const NOTE_MIN_GAP = 14;
/** Bravura accidental advance widths in em, and the clearances used around them. */
const ACC_EM = { sharp: 0.249, flat: 0.226, natural: 0.168 };
const ACC_HEAD_GAP = 0.03;
const ACC_PREV_GAP = 0.06;
/** Accidental size relative to the staff glyph size. */
const ACC_SCALE = 0.7;
/** Chord accidentals whose notes are within a fourth (this many diatonic steps) are staggered into separate columns. */
const ACC_STAGGER_STEPS = 4;

/** Gap before the time signature. VexFlow's TimeSignature defaults customPadding to 15. */
const KEY_TIME_GAP = 6;
/**
 * Fixed space (px at scale 1) after the clef, before the key signature or time signature.
 * Like LilyPond's non-musical column spacing, it does not stretch with the notes.
 */
const CLEF_EXTRA_SPACE = 10;

/** Advance width of each time-signature digit in em, measured from Bravura. */
const TIME_DIGIT_EM = [0.47, 0.334, 0.446, 0.421, 0.47, 0.44, 0.436, 0.436, 0.436, 0.434];
/** Baseline offset (em) that centres a digit's measured ink vertically on its anchor. */
const TIME_DIGIT_CENTRE_EM = 0.0075;

/**
 * Draws a numerator and denominator stacked on the staff, centred on the top and bottom halves.
 * Returns the x where the time signature ends.
 */
/**
 * The time signature shown in a system's header. The score's default is shown only on the first
 * system; later systems show the time signature only when their first measure changes it.
 */
function headerTimeSig(measure: ScoreMeasure, score: NotationScore, firstSystem: boolean): string | undefined {
  if (measure.timeSignature) return measure.timeSignature;
  return firstSystem ? score.timeSignature : undefined;
}

/**
 * Width of the system header that precedes the first notes of a system: clef, key signature,
 * and time signature. Mirrors the positions used when the header is drawn.
 */
function headerWidth(
  clef: string,
  key: string | undefined,
  ts: string | undefined,
  size: number
): number {
  const clefEnd = 4 + clefWidth(clef, size);
  let x = clefEnd;
  let keyEnd: number | undefined;
  if (key) {
    const root = key.replace(/\s*(major|minor)$/i, "").trim();
    const counts = KEY_COUNTS[root] ?? KEY_COUNTS[root.charAt(0).toUpperCase() + root.slice(1)];
    const n = counts ? ("sharps" in counts ? counts.sharps : counts.flats) : 0;
    x = clefEnd + CLEF_EXTRA_SPACE;
    if (n > 0) x += n * size * 0.25;
    keyEnd = x;
  }
  if (ts) {
    const [num, den] = ts.split("/");
    if (num && den) {
      x = timeSigX(clefEnd, keyEnd, ts, size) + timeSigWidth(ts, size);
    }
  }
  return x;
}

/**
 * Width of a time signature: the wider of its numerator and denominator.
 */
function timeSigWidth(ts: string, size: number): number {
  const [num, den] = ts.split("/");
  const textWidth = (text: string) =>
    [...text].reduce((w, ch) => w + TIME_DIGIT_EM[parseInt(ch, 10)] * size, 0);
  return Math.max(textWidth(num), textWidth(den));
}

/**
 * Left edge of the time signature. Without a key signature it sits one time-signature width
 * after the clef; with one, it follows the key signature after a small fixed gap.
 */
function timeSigX(clefEnd: number, keyEnd: number | undefined, ts: string, size: number): number {
  if (keyEnd === undefined) return clefEnd + timeSigWidth(ts, size);
  return keyEnd + KEY_TIME_GAP;
}

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
  minGaps?: number[],
  spots?: Map<string, Spot>
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
  const hasParts = measure.notes.some((n) => n.voice !== undefined);
  const centres = hasParts ? partCentres(measure.notes, xStart, width, minGaps).xs : noteCentres(measure.notes, xStart, width, minGaps);
  if (spots) measure.notes.forEach((note, i) => {
    if (note.isRest) return;
    const top = tabY0 + (Math.min(...tabPositionsFor(note, tuning).map((p) => p.str)) - 1) * tabSpacing;
    spots.set(spotKey(measure.number, i), { x: centres[i], y: top, bottom: top });
  });
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
      if (note.circled) {
        // Same ring as the notehead. The disc is filled with the background so the
        // tab line is hidden inside it, and it sits below the number.
        const r = Math.max(w, h) / 2 + 2;
        svg.appendChild(
          el("circle", { cx: x, cy: y + numberOffset, r, style: "fill: var(--background-primary, #fff); stroke: var(--text-normal, #000)", "stroke-width": STEM_W })
        );
      }
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

  // Tab-note {above:} text sits just over the top string. {below:} is drawn under the staff notehead.
  const textSize = NOTE_TEXT_FONT_SIZE * (size / 13);
  measure.notes.forEach((note, i) => {
    if (note.isRest) return;
    if (note.textAbove) svg.appendChild(noteText(centres[i], tabY0 - size * 0.9, note.textAbove, textSize));
  });

  // Tab hammer-ons and pull-offs: a slur above the fret numbers from the previous note to this one.
  measure.notes.forEach((note, i) => {
    if (!note.hammerPull || i === 0 || note.isRest) return;
    const prev = measure.notes[i - 1];
    if (prev.isRest || (prev.voice ?? 1) !== (note.voice ?? 1)) return;
    const top = (n: ScoreNote) => tabY0 + (Math.min(...tabPositionsFor(n, tuning).map((p) => p.str)) - 1) * tabSpacing;
    hammerArc(svg, centres[i - 1] + size * 0.3, centres[i] - size * 0.3, top(prev) - size * 0.4, top(note) - size * 0.4, size * 1.2, note.hammerPull === "h" ? "H" : "P", HAMMER_LABEL_SIZE);
  });

  // Tab ties join the same string and fret across notes that share a position.
  const tabRight = xPos + measureWidth;
  measure.notes.forEach((note, i) => {
    if (!note.tied || note.isRest) return;
    const x1 = centres[i] + size * 0.3;
    const next = measure.notes[i + 1];
    const sameVoice = next && (next.voice ?? 1) === (note.voice ?? 1);
    const nextPos = sameVoice && !next.isRest ? tabPositionsFor(next, tuning) : [];
    const here = tabPositionsFor(note, tuning);
    const samePos =
      nextPos.length === here.length && here.every((p, k) => nextPos[k]?.str === p.str && nextPos[k]?.fret === p.fret);
    const x2 = samePos ? centres[i + 1] - size * 0.3 : Math.min(x1 + 2 * tabSpacing, tabRight);
    for (const { str } of here) {
      const y = tabY0 + (str - 1) * tabSpacing + numberOffset + size * 0.5;
      const d = `M ${x1} ${y} Q ${(x1 + x2) / 2} ${y + tabSpacing * 0.5} ${x2} ${y}`;
      svg.appendChild(el("path", { d, fill: "none", style: "stroke: var(--text-normal, #000)", "stroke-width": STEM_W }));
    }
  });
}

/** Tab string/fret pairs for a note, using the same rules as the VexFlow coupled tab. */
function tabPositionsFor(note: ScoreNote, tuning: string[]): { str: number; fret: number | string }[] {
  if (note.isRest) return [];
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
  minGaps?: number[],
  scale = 1,
  spots?: Map<string, Spot>
): number[] {
  const notes = measure.notes;
  if (!notes.length) return [];
  const bottomStep = BOTTOM_LINE_STEP[clef] ?? BOTTOM_LINE_STEP.treble;
  const bottomY = y0 + 4 * lineSpacing;
  const middleY = bottomY - 2 * lineSpacing;
  const hasParts = notes.some((n) => n.voice !== undefined);
  const xs = hasParts ? partCentres(notes, xStart, width, minGaps).xs : noteCentres(notes, xStart, width, minGaps);
  const headYs = notes.map((note) =>
    note.isRest ? [] : (note.pitches ?? []).map((p) => bottomY - ((stepOf(p) - bottomStep) * lineSpacing) / 2)
  );

  // All notes in a group share one stem direction, set by the group's average pitch.
  const beamed = new Map<number, BeamStem>();
  // Parts are beamed separately, so a beam never joins a note from one part to one from the other.
  // Each note's onset in quarters from the measure start.
  const offsets = noteOffsets(notes);
  const groups = hasParts
    ? [undefined, 1, 2].flatMap((v) => {
        // Notes outside a parts group (undefined) are beamed as their own run, like a normal measure.
        const idx = notes.map((n, i) => (n.voice === v ? i : -1)).filter((i) => i >= 0);
        const local = beamGroups(idx.map((i) => notes[i]), timeSig, idx.map((i) => offsets[i]));
        return local.map((g) => g.map((k) => idx[k]));
      })
    : beamGroups(notes, timeSig);
  const headW = size * 0.3 * headScale;
  const stemUpByNote = new Map<number, boolean>();
  const stemUpOf = (i: number) => stemUpByNote.get(i);
  for (const g of groups) {
    const all = g.flatMap((i) => headYs[i]);
    if (!all.length) continue;
    const avgY = all.reduce((a, b) => a + b, 0) / all.length;
    // Voice 1 stems always go up and voice 2 stems always go down, so the parts stay apart
    const voiceUp = notes[g[0]].voice === 1 ? true : notes[g[0]].voice === 2 ? false : undefined;
    const up = voiceUp ?? avgY > middleY;
    g.forEach((i) => stemUpByNote.set(i, up));
    // Beamed stems run 3 staff spaces past the notehead furthest from the stem's origin, so the beam clears the whole stack.
    const groupExtreme = up ? Math.min(...all) : Math.max(...all);
    const natural = g.map((i) => {
      const ys = headYs[i];
      const extreme = ys.length ? (up ? Math.min(...ys) : Math.max(...ys)) : groupExtreme;
      return up ? extreme - 3 * lineSpacing : extreme + 3 * lineSpacing;
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
  drawTies(svg, notes, xs, headYs, headW, width, xStart, lineSpacing);
  drawHammerPulls(svg, notes, xs, headYs, headW, family, size, lineSpacing, (i) => stemUpOf(i) ?? false);
  if (spots) notes.forEach((n, i) => {
    if (!n.isRest && headYs[i].length) spots.set(spotKey(measure.number, i), { x: xs[i], y: Math.min(...headYs[i]), bottom: Math.max(...headYs[i]), stemUp: stemUpOf(i) });
  });
  drawTupletLabels(svg, notes, xs, groups, beamed, family, LYRIC_FONT_SIZE * scale, lineSpacing, headYs, middleY);
  return xs;
}

/**
 * Labels each tuplet group with a "3" centred over its beam, or over the stem of an unbeamed tuplet
 * note. A group is labelled only when every note in it is a tuplet.
 */
function drawTupletLabels(
  svg: SVGElement,
  notes: ScoreNote[],
  xs: number[],
  groups: number[][],
  beamed: Map<number, BeamStem>,
  family: string,
  labelSize: number,
  ls: number,
  headYs: number[][],
  middleY: number
): void {
  const label = (x: number, y: number) => {
    const t = el("text", {
      x,
      y,
      "dominant-baseline": "auto",
      "font-family": family,
      "font-size": labelSize,
      "font-style": "italic",
      "text-anchor": "middle",
      style: "fill: var(--text-normal, #000)",
    }) as SVGTextElement;
    t.textContent = "3";
    svg.appendChild(t);
  };
  const grouped = new Set<number>();
  for (const g of groups) {
    if (!g.every((i) => notes[i].tuplet)) continue;
    g.forEach((i) => grouped.add(i));
    const first = beamed.get(g[0]);
    if (!first) continue;
    // The beam's outer edge sits at the stem tip, so the label goes just beyond it.
    const midX = (xs[g[0]] + xs[g[g.length - 1]]) / 2;
    const up = first.up;
    const y = up ? first.tipY - ls * 0.6 : first.tipY + labelSize + ls * 0.6;
    label(midX, y);
  }
  // Unbeamed tuplet notes (e.g. quarter-note triplets) get a label above or below the stem tip.
  notes.forEach((note, i) => {
    if (!note.tuplet || note.isRest || grouped.has(i)) return;
    const ys = headYs[i];
    if (!ys.length) return;
    const up = ys.reduce((a, b) => a + b, 0) / ys.length > middleY;
    const extreme = up ? Math.min(...ys) : Math.max(...ys);
    const tip = up ? extreme - 3.5 * ls : extreme + 3.5 * ls;
    label(xs[i], up ? tip - ls * 0.6 : tip + labelSize + ls * 0.6);
  });
}

/**
 * Draws a tie arc for each tied note. The arc runs from the note's head to the next note's head
 * when both share the same pitches; otherwise it runs a short distance off the note's right edge.
 */
function drawTies(
  svg: SVGElement,
  notes: ScoreNote[],
  xs: number[],
  headYs: number[][],
  headW: number,
  width: number,
  xStart: number,
  ls: number
): void {
  const rightLimit = xStart + width;
  notes.forEach((note, i) => {
    if (!note.tied || note.isRest) return;
    const ys = headYs[i];
    if (!ys.length) return;
    const next = notes[i + 1];
    const sameVoice = !!next && (next.voice ?? 1) === (note.voice ?? 1);
    const nextYs = sameVoice && !next.isRest ? headYs[i + 1] : undefined;
    const samePitch =
      !!nextYs && nextYs.length === ys.length && ys.every((y, k) => Math.abs(y - nextYs[k]) < 0.01);
    const x1 = xs[i] + headW / 2;
    const x2 = samePitch ? xs[i + 1] - headW / 2 : Math.min(x1 + 2 * ls, rightLimit);
    // Arcs bow downward, the usual default for ties on the staff.
    const bulge = ls * 0.6;
    for (const y of ys) {
      const sy = y + ls * 0.4;
      const cy = sy + bulge;
      const d = `M ${x1} ${sy} Q ${(x1 + x2) / 2} ${cy} ${x2} ${sy}`;
      svg.appendChild(el("path", { d, fill: "none", style: "stroke: var(--text-normal, #000)", "stroke-width": STEM_W }));
    }
  });
}

/**
 * Draws a slur from each hammer-on or pull-off note back to the note before it, with an H or P
 * label above the arc. The arc sits above the staff noteheads.
 */
function drawHammerPulls(
  svg: SVGElement,
  notes: ScoreNote[],
  xs: number[],
  headYs: number[][],
  headW: number,
  family: string,
  size: number,
  ls: number,
  stemUpAt: (i: number) => boolean
): void {
  notes.forEach((note, i) => {
    if (!note.hammerPull || i === 0 || note.isRest) return;
    const prev = notes[i - 1];
    if (prev.isRest || (prev.voice ?? 1) !== (note.voice ?? 1)) return;
    // The slur sits opposite the destination note's stem: above the heads if the stem points down, below if it points up.
    const below = stemUpAt(i);
    const edge = (ys: number[]) => (ys.length ? (below ? Math.max(...ys) : Math.min(...ys)) : undefined);
    const y1 = edge(headYs[i - 1]);
    const y2 = edge(headYs[i]);
    if (y1 === undefined || y2 === undefined) return;
    const off = below ? ls * 0.4 : -ls * 0.4;
    hammerArc(svg, xs[i - 1] + headW / 2, xs[i] - headW / 2, y1 + off, y2 + off, ls * 1.2, "", HAMMER_LABEL_SIZE, below);
  });
}

/** Where a sounding note was drawn, used to join hammer-ons and pull-offs across barlines. */
type Spot = { x: number; y: number; bottom: number; stemUp?: boolean };
function spotKey(measureNumber: number, noteIndex: number): string {
  return `${measureNumber}:${noteIndex}`;
}

/** A small sans-serif label centered on x, using the system UI font. */
function noteText(x: number, y: number, text: string, size: number): SVGElement {
  const t = el("text", {
    x,
    y,
    "text-anchor": "middle",
    "font-family": "system-ui, -apple-system, sans-serif",
    "font-size": size,
    style: "fill: var(--text-normal, #000)",
  });
  t.textContent = text;
  return t;
}

/**
 * The y of the lowest notehead that could collide with a text label centred on note i: notes whose
 * centre lies within the label's horizontal span. Returns y0 when there are none below the staff.
 */
function lowestNoteheadY(
  notes: ScoreNote[],
  xs: number[],
  i: number,
  y0: number,
  lineSpacing: number,
  clef: string,
  headHalfWidth: number
): number {
  const bottomStep = BOTTOM_LINE_STEP[clef] ?? BOTTOM_LINE_STEP.treble;
  const bottomRel = y0 + 4 * lineSpacing;
  const middleRel = y0 + 2 * lineSpacing;
  const halfSpan = headHalfWidth * 2;
  let lowest = y0;
  notes.forEach((n, j) => {
    if (n.isRest || !n.pitches?.length) return;
    if (Math.abs(xs[j] - xs[i]) > halfSpan) return;
    for (const p of n.pitches) {
      const yHead = bottomRel - ((stepOf(p) - bottomStep) * lineSpacing) / 2;
      lowest = Math.max(lowest, yHead + lineSpacing / 2);
      // A stem hanging from a head above the middle line runs down through the label.
      if (yHead < middleRel && n.duration !== "w") {
        lowest = Math.max(lowest, yHead + 3.5 * lineSpacing);
      }
    }
  });
  return lowest;
}

/** Chord symbols above the staff, and lyric syllables below it, one per note. */
function drawNoteTexts(
  svg: SVGElement,
  notes: ScoreNote[],
  xs: number[],
  y0: number,
  lineSpacing: number,
  family: string,
  scale: number,
  chordRoom: number,
  lyricRoom: number,
  clef: string,
  chordDistance: number,
  headHalfWidth: number
): void {
  const staffBottom = y0 + 4 * lineSpacing;
  const lyricSize = LYRIC_FONT_SIZE * scale;
  const noteTextSize = NOTE_TEXT_FONT_SIZE * scale;
  notes.forEach((note, i) => {
    if (note.textAbove && chordRoom) {
      // Centered over the notehead, above any chord symbol and the note's own lift.
      const lift = chordLift(note, clef, lineSpacing);
      const baseline = y0 - chordDistance - lift - (note.chordSymbol ? CHORD_TEXT_HEIGHT * scale + 2 * scale : 0) - 2 * scale;
      svg.appendChild(noteText(xs[i], baseline, note.textAbove, noteTextSize));
    }
    if (note.textBelow && lyricRoom) {
      // Sits under the note's own lowest point (notehead, ledger lines, or stem tail), not in the lyric row.
      const lowest = lowestNoteheadY(notes, xs, i, y0, lineSpacing, clef, headHalfWidth);
      const baseline = Math.max(lowest, staffBottom) + 2 * scale + noteTextSize * 0.8;
      svg.appendChild(noteText(xs[i], baseline, note.textBelow, noteTextSize));
    }
    if (note.chordSymbol && chordRoom) {
      // Left-aligned at the notehead. The label is raised above the highest notehead under its whole
      // width (up to the next chord symbol), so a higher note to its right cannot collide with it.
      const textEnd = xs[i] - headHalfWidth + chordTextWidth(note.chordSymbol, scale);
      let lift = chordLift(note, clef, lineSpacing);
      for (let j = i + 1; j < notes.length && xs[j] - headHalfWidth < textEnd; j++) {
        if (notes[j].chordSymbol) break;
        lift = Math.max(lift, chordLift(notes[j], clef, lineSpacing));
      }
      const baseline = y0 - chordDistance - lift;
      const t = el("text", { x: xs[i] - headHalfWidth, y: baseline, "text-anchor": "start" });
      applyChordTextStyle(t);
      t.textContent = note.chordSymbol;
      svg.appendChild(t);
    }
    if (!lyricRoom) return;
    if (note.lyric) {
      const t = el("text", {
        x: xs[i],
        y: staffBottom + LYRIC_BASELINE_GAP * scale,
        "text-anchor": "middle",
        "font-family": family,
        "font-size": lyricSize,
      });
      t.textContent = note.lyric;
      svg.appendChild(t);
    }
    if (note.lyricHold) {
      // Melisma: a line that runs from this note toward the next syllable.
      const nextX = i + 1 < xs.length ? xs[i + 1] : xs[i] + lyricSize;
      const yy = staffBottom + LYRIC_BASELINE_GAP * scale - lyricSize * 0.3;
      svg.appendChild(el("line", { x1: xs[i] - lyricSize * 0.3, x2: nextX - lyricSize * 0.3, y1: yy, y2: yy, style: "stroke: var(--text-normal, #000)", "stroke-width": 1 }));
    }
  });
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

/**
 * Each note's onset in quarters from the measure start. A run of voiced notes is one parts group:
 * its parts sound together, so every part starts at the group's start and the group takes the length of one part.
 */
function noteOffsets(notes: ScoreNote[]): number[] {
  const offsets: number[] = new Array(notes.length).fill(0);
  let t = 0;
  let i = 0;
  while (i < notes.length) {
    if (notes[i].voice === undefined) {
      offsets[i] = t;
      t += noteQuarters(notes[i]);
      i++;
      continue;
    }
    let end = i;
    while (end < notes.length && notes[end].voice !== undefined) end++;
    const partEnd = new Map<number, number>();
    for (let k = i; k < end; k++) {
      const v = notes[k].voice as number;
      const start = partEnd.get(v) ?? t;
      offsets[k] = start;
      partEnd.set(v, start + noteQuarters(notes[k]));
    }
    t = Math.max(...partEnd.values());
    i = end;
  }
  return offsets;
}

function beamGroups(notes: ScoreNote[], timeSig: string, starts?: number[]): number[][] {
  const { beat, compound } = beatQuarters(timeSig);
  const groups: number[][] = [];
  // Every beamable note goes through the automatic rules, so an explicit `<...>` boundary never splits
  // an 8th or 16th run. An explicit `<...>` group still beams together, because its notes share a key
  // (same duration, same unit) whenever they are beamed as written.
  let cur: number[] = [];
  let curKey: string | null = null;
  const flush = () => {
    if (cur.length >= 2) groups.push(cur);
    cur = [];
    curKey = null;
  };
  let pos = 0;
  notes.forEach((note, i) => {
    // Sub-lists (one part) carry their notes' real measure offsets, so beat boundaries stay aligned.
    if (starts) pos = starts[i];
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
  const headAdvance = note.duration === "w" ? HEAD_ADVANCE_WHOLE : HEAD_ADVANCE_BLACK;
  const headW = headAdvance * size * headScale;

  const accShifts = accidentalLayout(pitches, size).shifts;
  const ys: number[] = [];
  for (const [pi, p] of pitches.entries()) {
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
      // Accidentals are drawn smaller than the notehead so they don't compete with it.
      const accSize = size * ACC_SCALE;
      // Right edge sits a small clearance left of the notehead's left edge, staggered in chords.
      glyph(svg, acc, x - headW / 2 - ACC_HEAD_GAP * size - accShifts[pi] - accEm * accSize, yHead, accSize, family);
    }
    // Centre the glyph's advance width on x so ledgers line up with the head.
    glyph(svg, head, x - headW / 2, yHead, size * headScale, family);
    if (note.circled) {
      // Ring just outside the head so it encloses the notehead without overlapping it.
      // The head's corners reach about 0.6 staff spaces from its centre.
      const r = NOTE_CIRCLE_RADIUS * ls;
      svg.appendChild(
        el("circle", { cx: x, cy: yHead, r, fill: "none", style: "stroke: var(--text-normal, #000)", "stroke-width": STEM_W })
      );
    }
  }

  // Stem and flags. Stems go up when the note sits below the middle line.
  if (note.duration !== "w") {
    const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
    const stemUp = beam ? beam.up : note.voice === 1 ? true : note.voice === 2 ? false : avgY > middleY;
    const stemLen = 3.5 * ls;
    const extreme = stemUp ? Math.min(...ys) : Math.max(...ys);
    const sx = stemUp ? x + headW / 2 - STEM_W / 2 : x - headW / 2 + STEM_W / 2;
    // The stem starts at the head farthest from its tip so it touches every head in a chord.
    const far = stemUp ? Math.max(...ys) : Math.min(...ys);
    const sy1 = far;
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
