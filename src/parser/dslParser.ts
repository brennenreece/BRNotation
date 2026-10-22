/**
 * BRNotation DSL Parser
 */
import {
  BlockMode,
  ChordDiagramData,
  ChordGridMeasure,
  ChordGridScore,
  DIAGRAM_COLORS,
  DIAGRAM_DOT_STYLES,
  DiagramColor,
  DiagramDotStyle,
  DiagramNote,
  DurationType,
  FretboardScaleData,
  NotationScore,
  NotePitch,
  ParsedBlock,
  ScoreMeasure,
  ScoreNote,
  TabPosition,
} from "../types";
import { GUITAR_WRITTEN_OCTAVE, TUNING_PRESETS, midiToNote, stringFretToMidi } from "./scales";

interface RawChordBox {
  name: string;
  frets: (number | "x")[];
  fingers: (string | number | null)[];
  dotOverrides: ({ style?: DiagramDotStyle | "root"; color?: DiagramColor } | null)[];
  labels: (string | null)[];
  baseFret: number;
  /** Index of the row this box belongs to; a `row:` line starts a new row. */
  row: number;
}


/**
 * Base fret for a chord box without base-fret:. Starts at the nut when the chord uses an open
 * string or fret 1; otherwise starts one fret above the lowest fretted note, so the chord
 * does not begin on the top fret of the box.
 */
function autoBaseFret(frets: (number | "x")[]): number {
  const fretted = frets.filter((f): f is number => typeof f === "number" && f > 0);
  if (fretted.length === 0) return 1;
  const lowest = Math.min(...fretted);
  const usesNut = lowest === 1 || frets.some((f) => f === 0);
  return usesNut ? 1 : lowest - 1;
}

/**
 * Converts DiagramNote[] to a frets array (6 strings, low E to high E),
 * matching the order of `frets:`. Missing strings become "x". dotOverrides map to the same positions.
 */
function notesToFrets(notes: DiagramNote[]): {
  frets: (number | "x")[];
  dotOverrides: ({ style?: DiagramDotStyle | "root"; color?: DiagramColor } | null)[];
  labels: (string | null)[];
} {
  const fretMap = new Map<number, { fret: number; style?: DiagramDotStyle | "root"; color?: DiagramColor; label?: string }>();
  for (const note of notes) {
    fretMap.set(note.str, { fret: note.fret, style: note.style, color: note.color, label: note.label });
  }
  const frets: (number | "x")[] = [];
  const dotOverrides: ({ style?: DiagramDotStyle | "root"; color?: DiagramColor } | null)[] = [];
  const labels: (string | null)[] = [];
  for (let str = 6; str >= 1; str--) {
    const entry = fretMap.get(str);
    if (entry) {
      frets.push(entry.fret);
      dotOverrides.push(entry.style || entry.color ? { style: entry.style, color: entry.color } : null);
      labels.push(entry.label ?? null);
    } else {
      frets.push("x");
      dotOverrides.push(null);
      labels.push(null);
    }
  }
  return { frets, dotOverrides, labels };
}

/** `defaultTuning` is the global setting; a `tuning:` line in the block overrides it. */
export function parseBRNotationBlock(rawText: string, defaultTuning = "standard"): ParsedBlock {
  const lines = rawText.split(/\r?\n/);
  const errors: string[] = [];

  // Determine mode from header or first line
  let mode: BlockMode = "notation";
  let title: string | undefined = undefined;
  let timeSignature = "4/4";
  let timeSignatureVisible = true;
  let keySignature = "C";
  let clef: any = "treble";
  let tuningPreset = defaultTuning;
  let measuresPerRow = 4;
  let showFunctions = false;
  let showMeasureNumbers = false;
  let gridKey: string | undefined = undefined;
  let staffRender: "vexflow" | "font" = "font";

  // Chord diagram fields
  let chordName = "Chord";
  let chordFrets: (number | "x")[] = [0, 0, 0, 0, 0, 0];
  let chordFingers: (string | number | null)[] = [];
  let chordDotOverrides: ({ style?: DiagramDotStyle | "root"; color?: DiagramColor } | null)[] = [];
  let chordNotes: DiagramNote[] | undefined = undefined; // notes: for chord blocks
  // 0 means base-fret: was not given; chord boxes then use their lowest fretted number
  let baseFret = 0;
  let chordColumns: number | undefined = undefined;
  let chordFont: string | undefined = undefined;
  let chordFretCount: number | undefined = undefined;
  let chordSize: number | undefined = undefined;
  let chordAlign: "left" | "center" | "right" | undefined = undefined;
  // Completed chord boxes. A `name:` line after a box's `frets:` line starts the next box.
  const rawChordBoxes: RawChordBox[] = [];
  let pendingChord: RawChordBox | null = null;
  let chordRow = 0;
  const CHORD_FONT_KEYS = ["system", "julesjazz", "musejazz"];

  // Fretboard scale fields
  let scaleRoot = "A";
  let scaleName = "minor-pentatonic";
  let minFret = 0;
  let maxFret = 12;
  let fretboardBaseFret: number | undefined = undefined;
  let displayMode: "degrees" | "notes" = "degrees";
  let dotStyle: DiagramDotStyle | undefined = undefined;
  let dotColor: DiagramColor | undefined = undefined;
  let customNotes: DiagramNote[] | undefined = undefined;
  let lineWidth: number | undefined = undefined;

  // Check directive headers
  const contentLines: string[] = [];
  const lyricLines: string[] = [];
  const unlabeledLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("# ")) {
      if (trimmed.startsWith("# ")) title = trimmed.replace(/^#\s*/, "");
      continue;
    }

    const lower = trimmed.toLowerCase();

    // Diagram header shared by chord boxes and fretboard maps
    if (lower.startsWith("style:")) {
      const raw = trimmed.slice(6).trim();
      if (DIAGRAM_DOT_STYLES.includes(raw.toLowerCase() as DiagramDotStyle)) {
        dotStyle = raw.toLowerCase() as DiagramDotStyle;
      } else {
        errors.push(`Unknown style "${raw}". Use ${DIAGRAM_DOT_STYLES.join(", ")}.`);
      }
      continue;
    }
    if (lower.startsWith("color:")) {
      const raw = trimmed.slice(6).trim().toLowerCase();
      if (DIAGRAM_COLORS.includes(raw as DiagramColor)) {
        dotColor = raw as DiagramColor;
      } else {
        errors.push(`Unknown color "${raw}". Use ${DIAGRAM_COLORS.join(", ")}.`);
      }
      continue;
    }
    if (lower.startsWith("notes:")) {
      const notesArray: DiagramNote[] = [];
      // A standalone "-" links the note before it to the note after it (fretboard only)
      let linkNext = false;
      for (const token of trimmed.slice(6).trim().split(/\s+/).filter(Boolean)) {
        if (token === "-") {
          if (notesArray.length === 0) errors.push(`A "-" in notes: needs a note before it.`);
          else linkNext = true;
          continue;
        }
        const note = parseDiagramNote(token);
        if (note) {
          if (linkNext) note.linkFromPrevious = true;
          notesArray.push(note);
          linkNext = false;
        } else {
          errors.push(`Could not read note "${token}". Use fret/string, such as 5/6 or 7/5{root}=R.`);
        }
      }
      if (linkNext) errors.push(`A "-" in notes: needs a note after it.`);
      
      // Store for fretboard
      customNotes = notesArray;
      // Store for chord boxes (without linkFromPrevious, which is fretboard-only)
      chordNotes = notesArray.map(n => ({ ...n, linkFromPrevious: undefined }));
      
      // If building a chord, apply notes directly to the pending/current chord
      const { frets: notesFrets, dotOverrides: notesDotOverrides, labels: notesLabels } = notesToFrets(chordNotes);
      if (!pendingChord && chordName) {
        // Create a new chord if notes: comes before frets:
        pendingChord = { name: chordName, frets: notesFrets, fingers: chordFingers, dotOverrides: notesDotOverrides, labels: notesLabels, baseFret, row: chordRow };
      } else if (pendingChord) {
        // Update existing chord
        pendingChord.frets = notesFrets;
        pendingChord.dotOverrides = notesDotOverrides;
        pendingChord.labels = notesLabels;
      }
      continue;
    }
    if (lower.startsWith("line:")) {
      const n = Number(trimmed.slice(5).trim());
      if (Number.isInteger(n) && n >= 1 && n <= 10) {
        lineWidth = n;
      } else {
        errors.push(`Unknown line width "${trimmed.slice(5).trim()}". Use a whole number from 1 to 10.`);
      }
      continue;
    }

    if (lower.startsWith("type:") || lower.startsWith("mode:")) {
      const val = trimmed.split(":")[1].trim().toLowerCase() as BlockMode;
      // "chordchart" is the preferred name; "chordgrid" stays valid for existing blocks.
      const normalized = val === ("chordchart" as string) ? "chordgrid" : val;
      if (["notation", "tab", "coupled", "chordgrid", "chord", "fretboard"].includes(normalized)) {
        mode = normalized as BlockMode;
      }
      continue;
    }
    if (lower.startsWith("title:")) {
      title = trimmed.slice(6).trim();
      continue;
    }
    if (lower.startsWith("time:")) {
      const timeValue = trimmed.slice(5).trim();
      const visibleMatch = timeValue.match(/^(.*?)\s+visible\s*[=:]\s*(true|false)$/i);
      if (visibleMatch) {
        timeSignature = visibleMatch[1].trim();
        timeSignatureVisible = visibleMatch[2].toLowerCase() !== "false";
      } else {
        timeSignature = timeValue;
      }
      continue;
    }
    if (lower.startsWith("key:")) {
      keySignature = trimmed.slice(4).trim();
      gridKey = keySignature;
      continue;
    }
    if (/^chord[\s-]*function\s*[:=]?\s*(true|yes|on)$/i.test(trimmed)) {
      showFunctions = true;
      continue;
    }
    if (/^chord[\s-]*function\s*[:=]?\s*(false|no|off)$/i.test(trimmed)) {
      showFunctions = false;
      continue;
    }
    if (/^measure[\s-]*numbers?\s*[:=]?\s*(true|yes|on)$/i.test(trimmed)) {
      showMeasureNumbers = true;
      continue;
    }
    if (/^measure[\s-]*numbers?\s*[:=]?\s*(false|no|off)$/i.test(trimmed)) {
      showMeasureNumbers = false;
      continue;
    }
    if (lower.startsWith("glyphs:")) {
      const raw = trimmed.slice(7).trim().toLowerCase();
      if (raw === "font" || raw === "vexflow") {
        staffRender = raw;
      } else {
        errors.push(`Unknown glyphs "${raw}". Use font or vexflow.`);
      }
      continue;
    }
    if (lower.startsWith("clef:")) {
      clef = trimmed.slice(5).trim();
      continue;
    }
    if (lower.startsWith("tuning:")) {
      tuningPreset = trimmed.slice(7).trim().toLowerCase();
      continue;
    }
    if (lower.startsWith("per-row:") || lower.startsWith("perrow:")) {
      const num = parseInt(trimmed.split(":")[1].trim(), 10);
      if (!isNaN(num) && num > 0) measuresPerRow = num;
      continue;
    }

    // Chord-specific headers
    if (lower === "row:" || lower.startsWith("row:")) {
      // Boxes after a row: line start a new row. Empty rows are skipped.
      if (pendingChord) {
        rawChordBoxes.push(pendingChord);
        pendingChord = null;
      }
      if (rawChordBoxes.some((b) => b.row === chordRow)) chordRow++;
      continue;
    }
    if (lower.startsWith("name:") || lower.startsWith("chord:")) {
      // A new name starts a new box once the previous box has its frets
      if (pendingChord) {
        rawChordBoxes.push(pendingChord);
        pendingChord = null;
      }
      chordName = trimmed.slice(trimmed.indexOf(":") + 1).trim();
      chordFrets = [0, 0, 0, 0, 0, 0];
      chordFingers = [];
      chordDotOverrides = [];
      baseFret = 0;
      if (!lines.some((l) => l.toLowerCase().startsWith("type:"))) mode = "chord";
      continue;
    }
    if (lower.startsWith("frets:")) {
      const fStr = trimmed.slice(6).trim();
      chordDotOverrides = [];
      chordFrets = fStr.split(/\s+/).map((f) => {
        // `3{square,red}` styles one dot. Plain numbers and x behave as before.
        const om = f.match(/^(\d+)\{([\w-]*)(?:,(\w+))?\}$/);
        if (!om) {
          chordDotOverrides.push(null);
          return f.toLowerCase() === "x" ? "x" : parseInt(f, 10);
        }
        const style = om[2]?.toLowerCase() || undefined;
        const color = om[3]?.toLowerCase();
        const validStyle = !style || style === "root" || DIAGRAM_DOT_STYLES.includes(style as DiagramDotStyle);
        const validColor = !color || DIAGRAM_COLORS.includes(color as DiagramColor);
        if (!validStyle || !validColor) errors.push(`Could not read chord dot "${f}". Use fret{style,color}, such as 3{square,red}.`);
        chordDotOverrides.push({ style: style as DiagramDotStyle | "root" | undefined, color: validColor ? (color as DiagramColor | undefined) : undefined });
        return parseInt(om[1], 10);
      });
      pendingChord = { name: chordName, frets: chordFrets, fingers: chordFingers, dotOverrides: chordDotOverrides, labels: [], baseFret, row: chordRow };
      if (!lines.some((l) => l.toLowerCase().startsWith("type:"))) mode = "chord";
      continue;
    }
    if (lower.startsWith("fingers:")) {
      const fStr = trimmed.slice(8).trim();
      chordFingers = fStr.split(/\s+/).map((f) => (f === "-" || f === "0" ? null : f));
      if (pendingChord) pendingChord.fingers = chordFingers;
      continue;
    }
    if (lower.startsWith("columns:") || lower.startsWith("cols:")) {
      const num = parseInt(trimmed.slice(trimmed.indexOf(":") + 1).trim(), 10);
      if (!isNaN(num) && num > 0) chordColumns = num;
      else errors.push(`Invalid columns value "${trimmed.slice(trimmed.indexOf(":") + 1).trim()}". Use a whole number, e.g. columns: 4.`);
      continue;
    }
    if (lower.startsWith("size:")) {
      const raw = trimmed.slice(5).trim();
      const num = parseInt(raw, 10);
      if (/^\d+$/.test(raw) && num >= 1 && num <= 8) chordSize = num;
      else errors.push(`Invalid size "${raw}". Use a whole number from 1 to 8 (boxes across the pane), e.g. size: 5.`);
      continue;
    }
    if (lower.startsWith("align:")) {
      const raw = trimmed.slice(6).trim().toLowerCase();
      if (raw === "left" || raw === "center" || raw === "right") chordAlign = raw;
      else errors.push(`Invalid align "${raw}". Use left, center, or right, e.g. align: center.`);
      continue;
    }
    if (lower.startsWith("fret-count:") || lower.startsWith("frets-shown:")) {
      const raw = trimmed.slice(trimmed.indexOf(":") + 1).trim();
      const num = parseInt(raw, 10);
      if (/^\d+$/.test(raw) && num >= 3 && num <= 7) chordFretCount = num;
      else errors.push(`Invalid fret-count "${raw}". Use a whole number from 3 to 7, e.g. fret-count: 4.`);
      continue;
    }
    if (lower.startsWith("chord-font:")) {
      const raw = trimmed.slice(trimmed.indexOf(":") + 1).trim();
      if (CHORD_FONT_KEYS.includes(raw)) chordFont = raw;
      else errors.push(`Unknown chord-font "${raw}". Use one of: ${CHORD_FONT_KEYS.join(", ")}.`);
      continue;
    }
    if (lower.startsWith("base-fret:") || lower.startsWith("basefret:")) {
      baseFret = parseInt(trimmed.split(":")[1].trim(), 10) || 1;
      fretboardBaseFret = baseFret;
      if (pendingChord) pendingChord.baseFret = baseFret;
      continue;
    }

    // Fretboard-specific headers
    if (lower.startsWith("root:")) {
      scaleRoot = trimmed.slice(5).trim();
      if (!lines.some((l) => l.toLowerCase().startsWith("type:"))) mode = "fretboard";
      continue;
    }
    if (lower.startsWith("scale:")) {
      scaleName = trimmed.slice(6).trim();
      if (!lines.some((l) => l.toLowerCase().startsWith("type:"))) mode = "fretboard";
      continue;
    }
    if (lower.startsWith("show:")) {
      displayMode = trimmed.slice(5).trim() === "notes" ? "notes" : "degrees";
      continue;
    }

    // ABC-style lyric line (`w:`) attaches to the notation above it
    if (lower.startsWith("w:")) {
      lyricLines.push(trimmed.slice(2).trim());
      continue;
    }

    contentLines.push(trimmed);
    unlabeledLines.push(trimmed);
  }

  // Auto-detect mode if not explicitly set
  if (mode === "notation") {
    if (contentLines.some((l) => l.startsWith("|:") || l.match(/^\|\s*([A-Ga-g][#b]?[a-zA-Z0-9]*\s*)+\|/))) {
      // Check if it looks like chord names in a grid
      const looksLikeGrid = contentLines.some(
        (l) => l.includes("|") && !l.includes("/") && !l.match(/[a-g][0-9]/)
      );
      if (looksLikeGrid) mode = "chordgrid";
    }
  }

  const tuning = TUNING_PRESETS[tuningPreset]?.notes || TUNING_PRESETS.standard.notes;

  // Process mode
  if (mode === "chordgrid") {
    const chordGridScore = parseChordGrid(contentLines, title, timeSignature, measuresPerRow, gridKey, showFunctions, showMeasureNumbers, timeSignatureVisible);
    return { mode, rawText, chordGridScore, errors };
  } else if (mode === "chord") {
    if (pendingChord) rawChordBoxes.push(pendingChord);
    if (rawChordBoxes.length === 0) rawChordBoxes.push({ name: chordName, frets: chordFrets, fingers: chordFingers, dotOverrides: chordDotOverrides, labels: [], baseFret, row: chordRow });
    const chordBoxes: ChordDiagramData[] = rawChordBoxes.map((box) => ({
      name: box.name,
      tuning,
      frets: box.frets,
      fingers: box.fingers,
      dotOverrides: box.dotOverrides,
      labels: box.labels,
      baseFret: box.baseFret || autoBaseFret(box.frets),
      dotStyle,
      dotColor,
      numFrets: chordFretCount,
      row: box.row,
    }));
    return { mode, rawText, chordDiagram: chordBoxes[0], chordDiagrams: chordBoxes, chordColumns, chordSize, chordAlign, chordFont, errors };
  } else if (mode === "fretboard") {
    // base-fret: is the first fret shown; the map keeps a 12-fret span from there.
    const fbMin = fretboardBaseFret ?? minFret;
    const fretboardScale: FretboardScaleData = {
      title,
      root: scaleRoot,
      scale: scaleName,
      tuning,
      minFret: fbMin,
      maxFret: fbMin + (maxFret - minFret),
      displayMode,
      dotStyle,
      dotColor,
      customPositions: customNotes,
      lineWidth,
    };
    return { mode, rawText, fretboardScale, errors };
  } else {
    // notation, tab, or coupled
    const notationScore = parseNotationContent(contentLines, mode, title, timeSignature, keySignature, clef, tuning, errors, lyricLines);
    if (notationScore) {
      // Tab-only blocks have no staff, so they always use the font renderer's tab drawing.
      notationScore.render = mode === "tab" ? "font" : staffRender;
    }
    return { mode, rawText, notationScore, errors };
  }
}

/**
 * Parses one `notes:` entry: `fret/string`, optionally followed by `{style}`, `{style,color}`,
 * `{,color}`, and `=label`.
 * Examples: 5/6, 7/5{root}, 8/4{ghost}=b3, 9/3{square,red}=R
 */
export function parseDiagramNote(token: string): DiagramNote | null {
  const m = token.match(/^(\d+)\/(\d+)(?:\{([\w-]*)(?:,(\w+))?\})?(?:=(.+))?$/);
  if (!m) return null;
  const style = m[3]?.toLowerCase() || undefined;
  const color = m[4]?.toLowerCase();
  if (style && style !== "root" && !DIAGRAM_DOT_STYLES.includes(style as DiagramDotStyle)) return null;
  if (color && !DIAGRAM_COLORS.includes(color as DiagramColor)) return null;
  return {
    fret: parseInt(m[1], 10),
    str: parseInt(m[2], 10),
    style: style as DiagramNote["style"],
    color: color as DiagramColor | undefined,
    label: m[5],
  };
}

/** Parses chord charts. Barline tokens match the staff notation parser (|, ||, |., |:, :|, :|:). */
function parseChordGrid(
  lines: string[],
  title: string | undefined,
  timeSignature: string,
  measuresPerRow: number,
  key: string | undefined,
  showFunctions: boolean,
  showMeasureNumbers: boolean,
  showTimeSignature: boolean
): ChordGridScore {
  const measures: ChordGridMeasure[] = [];
  let measureCount = 1;

  // Each measure is the text between barline tokens. A [Section] header labels the next measure.
  let pendingSection: string | undefined = undefined;
  const flush = (segment: string, closing: ClosingBarline, opening: BarlineType) => {
    const chords = segment.trim().split(/\s+/).filter(Boolean);
    if (chords.length === 0) return;
    measures.push({
      number: measureCount++,
      section: pendingSection,
      cells: [{ chords, simile: chords.includes("%") }],
      startBarline: opening === "repeat-begin" ? "repeat-begin" : undefined,
      barline: closing === "single" ? undefined : closing,
    });
    pendingSection = undefined;
  };

  let openingBar: BarlineType = "single";
  let segment = "";
  for (const line of lines) {
    const text = line.trim();
    const secMatch = text.match(/^\[(.*?)\]$/);
    if (secMatch) {
      pendingSection = secMatch[1];
      continue;
    }
    const parts = text.split(/(:\|:|\|\||\|:|:\||\|\.|\|)/);
    for (const part of parts) {
      if (part === undefined) continue;
      const bar = BARLINE_TOKENS[part];
      if (bar) {
        flush(segment, bar.closing, openingBar);
        segment = "";
        openingBar = bar.opening;
      } else {
        segment += part + " ";
      }
    }
  }
  flush(segment, "single", openingBar);

  return {
    title,
    timeSignature,
    showTimeSignature,
    key,
    showFunctions,
    showMeasureNumbers,
    measuresPerRow,
    measures,
  };
}

/** Length of a note in quarter notes, counting dots and triplets. */
function noteLength(note: ScoreNote): number {
  const base: Record<string, number> = { w: 4, h: 2, q: 1, "8": 0.5, "16": 0.25, "32": 0.125 };
  const len = base[note.duration] ?? 1;
  return note.tuplet ? (2 / 3) * len : len * (2 - 1 / Math.pow(2, note.dots ?? 0));
}

/** Parses standard notation, tab, and coupled staves */
/**
 * Parses one `[V1: ... V2: ...]` measure. Each part is parsed as a single bar, so the parts stack
 * on one staff and tab. Returns the merged notes for that measure, or undefined if the group is malformed.
 */
function parseVoicedGroup(
  inner: string,
  mode: "notation" | "tab" | "coupled",
  timeSignature: string,
  keySignature: string,
  clef: any,
  tuning: string[],
  errors: string[],
  measureNumber: number
): ScoreNote[] | undefined {
  // Split on `V1:` / `V2:` markers, keeping each part's text
  const markers = [...inner.matchAll(/V([12])\s*:/gi)];
  if (markers.length === 0) {
    errors.push(`Measure ${measureNumber} brackets need V1: and V2: parts`);
    return undefined;
  }
  const partText: { 1?: string; 2?: string } = {};
  markers.forEach((m, i) => {
    const voice = Number(m[1]) as 1 | 2;
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < markers.length ? markers[i + 1].index ?? inner.length : inner.length;
    if (partText[voice] !== undefined) {
      errors.push(`Measure ${measureNumber} has more than one V${voice}: part`);
    }
    partText[voice] = inner.slice(start, end).trim();
  });
  const leading = inner.slice(0, markers[0].index ?? 0).trim();
  if (leading) errors.push(`Text before V${markers[0][1]}: in measure ${measureNumber} is ignored`);
  if (partText[1] === undefined || partText[2] === undefined) {
    errors.push(`Measure ${measureNumber} needs both V1: and V2: parts`);
    return undefined;
  }
  const parts: Record<1 | 2, ScoreNote[]> = { 1: [], 2: [] };
  for (const v of [1, 2] as const) {
    const parsed = parseNotationContent([partText[v]!], mode, undefined, timeSignature, keySignature, clef, tuning, errors, []);
    if (parsed.measures.length !== 1 || !parsed.measures[0]) {
      errors.push(`V${v} in measure ${measureNumber} must not contain barlines`);
      return undefined;
    }
    parts[v] = parsed.measures[0].notes;
  }
  // Both parts must add up to the same length, so they end together. Any length works, e.g. one beat each.
  const lengthOf = (ns: ScoreNote[]) => ns.reduce((sum, n) => sum + noteLength(n), 0);
  const len1 = lengthOf(parts[1]);
  const len2 = lengthOf(parts[2]);
  if (Math.abs(len1 - len2) > 1e-9) {
    errors.push(`V1 and V2 in measure ${measureNumber} must be the same length`);
    return undefined;
  }
  return [
    ...parts[1].map((n) => ({ ...n, voice: 1 as const })),
    ...parts[2].map((n) => ({ ...n, voice: 2 as const })),
  ];
}

function parseNotationContent(
  lines: string[],
  mode: "notation" | "tab" | "coupled",
  title: string | undefined,
  timeSignature: string,
  keySignature: string,
  clef: any,
  tuning: string[],
  errors: string[] = [],
  lyricLines: string[] = []
): NotationScore {
  const measures: ScoreMeasure[] = [];
  let currentMeasureNumber = 1;

  // Split into segments at barline tokens, keeping each barline as its own token.
  // Longest tokens first so ":|:" and "|:" are not read as "|" or ":".
  // A `[V1: ... V2: ...]` group is one measure with two stacked parts. It is pulled out before the
  // barline split so barlines inside it do not break the measure, and is restored as a placeholder token.
  const voicedGroups: string[] = [];
  const fullContent = lines.join(" ").replace(/\[\s*V[12]\s*:[^\]]*\]/gi, (match) => {
    voicedGroups.push(match.slice(1, -1));
    return ` \u0000${voicedGroups.length - 1}\u0000 `;
  });
  // `:|.` is read as a plain repeat end, so its trailing dot is absorbed rather than read as a note.
  const parts = fullContent.split(/(:\|:|\|\||\|:|:\|\.|:\||\|\.|\||\\)/).map((p) => (p === ":|." ? ":|" : p));

  // A barline token closes the current measure and opens the next one,
  // e.g. ":|:" is a repeat-end on the left and a repeat-begin on the right.
  // A `\` token forces the next measure to start a new system.
  let openingBar: BarlineType = "single";
  let pendingSystemBreak = false;
  let segment = "";
  let stickyDuration: DurationType = "q";
  // `:8t` makes following notes triplets until the next duration directive.
  let stickyTuplet = false;
  let stickyDots = 0;
  // `<` opens an explicit beam group and `>` closes it. Notes inside share one group id.
  let beamGroupCount = 0;
  let openBeamGroup: number | undefined;
  // A chord symbol ("Am7") labels the next note or rest, wherever it appears in the bar.
  // It is carried forward across barlines until a note takes it, so it never occupies a beat.
  let pendingChord: string | undefined;
  // An `h` or `p` token waiting for the note it applies to.
  let pendingHammerPull: "h" | "p" | undefined;
  // The last sounding note in the score, so a hammer-on or pull-off can start across a barline.
  let lastSounding: { measure: number; index: number } | undefined;
  const flush = (closingBar: ClosingBarline) => {
    const trimmed = segment.trim();
    segment = "";
    const notes: ScoreNote[] = [];
    for (let token of tokenizeMeasure(trimmed)) {
      const groupMatch = token.match(/^\u0000(\d+)\u0000$/);
      if (groupMatch) {
        // A bracketed parts group is a whole measure, so its notes are added as they are and the rest of the measure is parsed as usual.
        const groupNotes = parseVoicedGroup(
          voicedGroups[Number(groupMatch[1])],
          mode,
          timeSignature,
          keySignature,
          clef,
          tuning,
          errors,
          currentMeasureNumber
        );
        if (groupNotes) notes.push(...groupNotes);
        continue;
      }
      let opens = false;
      let closes = false;
      if (token.startsWith("<")) {
        opens = true;
        token = token.slice(1);
      }
      if (token.endsWith(">")) {
        closes = true;
        token = token.slice(0, -1);
      }
      if (opens) {
        openBeamGroup = beamGroupCount++;
      }
      if (!token) {
        if (closes) openBeamGroup = undefined;
        continue;
      }
      const dirMatch = token.match(/^:([whq]|8|16|32)(\.?)(t?)$/i);
      if (dirMatch) {
        stickyDuration = dirMatch[1].toLowerCase() as DurationType;
        stickyDots = dirMatch[2] === "." ? 1 : 0;
        stickyTuplet = dirMatch[3] === "t" || dirMatch[3] === "T";
        continue;
      }
      if (token.startsWith('"') && token.endsWith('"')) {
        pendingChord = token.slice(1, -1);
        continue;
      }
      // A bare `h` or `p` between two notes marks the next note as a hammer-on or pull-off.
      const hpMatch = token.match(/^([hp])$/i);
      if (hpMatch) {
        if (!lastSounding) {
          errors.push(`"${token}" must come after a sounding note in measure ${currentMeasureNumber}`);
        } else {
          pendingHammerPull = hpMatch[1].toLowerCase() as "h" | "p";
        }
        continue;
      }
      const scoreNote = parseNoteToken(token, mode, stickyDuration, tuning, stickyDots);
      if (scoreNote && pendingHammerPull) {
        scoreNote.hammerPull = pendingHammerPull;
        scoreNote.hammerFrom = lastSounding;
        pendingHammerPull = undefined;
      }
      if (scoreNote && stickyTuplet) scoreNote.tuplet = true;
      if (scoreNote && openBeamGroup !== undefined) scoreNote.beamGroup = openBeamGroup;
      if (closes) openBeamGroup = undefined;
      if (scoreNote) {
        if (pendingChord !== undefined) {
          scoreNote.chordSymbol = pendingChord;
          pendingChord = undefined;
        }
        notes.push(scoreNote);
        if (!scoreNote.isRest) lastSounding = { measure: currentMeasureNumber, index: notes.length - 1 };
      } else errors.push(`Could not read "${token}" in measure ${currentMeasureNumber}`);
    }
    if (notes.length > 0) {
      measures.push({
        number: currentMeasureNumber++,
        timeSignature: currentMeasureNumber === 2 ? timeSignature : undefined,
        keySignature: currentMeasureNumber === 2 ? keySignature : undefined,
        clef: currentMeasureNumber === 2 ? clef : undefined,
        notes,
        startBarline: openingBar === "repeat-begin" ? "repeat-begin" : undefined,
        barline: closingBar === "single" ? undefined : closingBar,
        systemBreak: pendingSystemBreak || undefined,
      });
      pendingSystemBreak = false;
    }
  };

  for (const part of parts) {
    if (part === undefined) continue;
    const bar = BARLINE_TOKENS[part];
    if (part === "\\") {
      pendingSystemBreak = true;
    } else if (bar) {
      flush(bar.closing);
      openingBar = bar.opening;
    } else {
      segment += part;
    }
  }
  flush("single");
  if (pendingChord !== undefined) errors.push(`Chord symbol "${pendingChord}" has no note or rest after it`);

  // Lyrics: each whitespace-separated syllable maps to one note in order, ABC-style.
  // "-" splits a word across notes, "_" holds the previous syllable (melisma), "*" skips a note.
  if (lyricLines.length) {
    const syllables = lyricLines.join(" ").split(/\s+/).filter(Boolean);
    const allNotes = measures.flatMap((m) => m.notes);
    let noteIdx = 0;
    for (const syl of syllables) {
      if (noteIdx >= allNotes.length) {
        errors.push(`Lyric "${syl}" has no note to attach to`);
        break;
      }
      const note = allNotes[noteIdx++];
      // `_` on its own holds the previous syllable; `*` skips this note.
      if (syl === "*") continue;
      if (syl === "_") {
        note.lyricHold = true;
        continue;
      }
      note.lyric = syl;
    }
  }

  // If no measures parsed, provide a default empty measure
  if (measures.length === 0) {
    measures.push({
      number: 1,
      timeSignature,
      keySignature,
      clef,
      notes: [
        {
          id: "default-1",
          duration: "w",
          isRest: true,
          dots: 0,
        },
      ],
    });
  }

  return {
    mode,
    title,
    timeSignature,
    keySignature,
    clef,
    tuning,
    measures,
  };
}

type BarlineType = "single" | "double" | "end" | "repeat-begin" | "repeat-end";
type ClosingBarline = "single" | "double" | "end" | "repeat-end";

/** Maps DSL barline tokens to the closing barline of the previous measure and the opening barline of the next */
const BARLINE_TOKENS: Record<string, { closing: ClosingBarline; opening: BarlineType }> = {
  "|": { closing: "single", opening: "single" },
  "||": { closing: "double", opening: "single" },
  "|.": { closing: "end", opening: "single" },
  "|:": { closing: "single", opening: "repeat-begin" },
  ":|": { closing: "repeat-end", opening: "single" },
  ":|:": { closing: "repeat-end", opening: "repeat-begin" },
};

/** Helper to tokenize notes and chord symbols in a measure */
function tokenizeMeasure(measureStr: string): string[] {
  const tokens: string[] = [];
  // `:dur` directives are split out so `:q` is its own token even when written right after a note.
  // A `{...}` annotation is kept with the note it follows, including any quoted text with spaces.
  const regex = /"([^"]+)"|\[([^\]]+)\](?:\/(\w+))?(\.?)(~?)|(:(?:[whq]|8|16|32)(?=\s|$))|(?:[^\s{]*\{[^{}]*\}|[^\s{]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(measureStr)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

/**
 * Splits a trailing `{...}` note annotation off a token, e.g. `a4(2/2){above:1 circle}`.
 * Returns the bare note token and the parsed annotations.
 */
function splitNoteAnnotations(token: string): { base: string; above?: string; below?: string; circled: boolean } | null {
  const m = token.match(/^(.+?)\{([^{}]*)\}$/);
  if (!m) return { base: token, circled: false };
  const body = m[2].trim();
  const result: { base: string; above?: string; below?: string; circled: boolean } = { base: m[1], circled: false };
  // Items are `above:text`, `below:text`, or `circle`. Text may be quoted to include spaces.
  const itemRe = /(above|below):("([^"]*)"|\S+)|\bcircle\b/gi;
  let leftover = body;
  let im: RegExpExecArray | null;
  while ((im = itemRe.exec(body)) !== null) {
    // Blank out each matched item so only unrecognized text is left over.
    leftover = leftover.replace(im[0], " ".repeat(im[0].length));
    if (im[0].toLowerCase() === "circle") {
      result.circled = true;
    } else if (im[1].toLowerCase() === "above") {
      result.above = im[3] ?? im[2];
    } else {
      result.below = im[3] ?? im[2];
    }
  }
  // Anything left over (other than whitespace) is not a valid annotation.
  if (leftover.trim() !== "" || !body) return null;
  return result;
}

/** Parses a single note or chord token. `defaultDuration` and `defaultDots` come from the sticky `:dur` directive in effect. */
/** Staff pitch for a fret/string position, from the block tuning (string 1 = highest). */
function pitchFromTab(fret: number, str: number, tuning: string[]): NotePitch | undefined {
  if (!Number.isInteger(str) || str < 1 || str > tuning.length) return undefined;
  const openNote = tuning[tuning.length - str];
  if (typeof openNote !== "string" || !openNote.trim()) return undefined;
  const midi = stringFretToMidi(openNote, fret) + GUITAR_WRITTEN_OCTAVE;
  const [, step, accidental, octave] = midiToNote(midi).toLowerCase().match(/^([a-g])(#?)(-?\d+)$/) ?? [];
  if (!step) return undefined;
  return { step: step as NotePitch["step"], accidental: accidental ? "#" : undefined, octave: parseInt(octave, 10) };
}

function parseNoteToken(
  token: string,
  mode: "notation" | "tab" | "coupled",
  defaultDuration: DurationType = "q",
  tuning: string[] = TUNING_PRESETS.standard.notes,
  defaultDots = 0
): ScoreNote | null {
  const annotated = splitNoteAnnotations(token);
  if (!annotated) return null;
  if (annotated.base !== token) {
    const note = parseNoteToken(annotated.base, mode, defaultDuration, tuning, defaultDots);
    if (!note) return null;
    if (annotated.above !== undefined) note.textAbove = annotated.above;
    if (annotated.below !== undefined) note.textBelow = annotated.below;
    if (annotated.circled) note.circled = true;
    return note;
  }
  const id = "note-" + Math.random().toString(36).substring(2, 9);

  // Check if it's a chord symbol e.g. "Am7"
  if (token.startsWith('"') && token.endsWith('"')) {
    return {
      id,
      duration: "q",
      isRest: false,
      dots: 0,
      chordSymbol: token.slice(1, -1),
    };
  }

  // Rest: `r`, or `r/q` / `rest/8` with an explicit duration
  const restMatch = token.match(/^(?:r|rest)(?:\/([whq8]|16|32)(\.?))?$/i);
  if (restMatch) {
    return {
      id,
      duration: restMatch[1] ? (restMatch[1].toLowerCase() as DurationType) : defaultDuration,
      isRest: true,
      dots: restMatch[1] ? (restMatch[2] === "." ? 1 : 0) : defaultDots,
    };
  }

  // Tab note: fret/string, e.g. 5/3 or 0/1h. Duration comes from the sticky `:dur` directive.
  const tabMatch = token.match(/^(\d+)\/(\d+)(~?)([hpsv]?)$/i);
  if (tabMatch) {
    const fret = parseInt(tabMatch[1], 10);
    const str = parseInt(tabMatch[2], 10);
    const tied = tabMatch[3] === "~";
    const technique = (tabMatch[4]?.toLowerCase() as any) || undefined;

    // In coupled blocks a bare fret/string also sets the staff pitch, from the block's tuning.
    const tabPitch = mode === "coupled" ? pitchFromTab(fret, str, tuning) : undefined;
    const pitches = tabPitch ? [tabPitch] : undefined;

    return {
      id,
      duration: defaultDuration,
      isRest: false,
      dots: defaultDots,
      tied,
      tabPositions: [{ str, fret, technique }],
      ...(pitches ? { pitches } : {}),
    };
  }

  // Chord bracket note e.g. [c4,e4,g4]/q, [c4(5/3),e4(5/2)]/q, or [0:6,2:5,2:4]/w
  const chordBracketMatch = token.match(/^\[(.*?)\](?:\/([whq8]|16|32))?(\.?)(~?)$/i);
  if (chordBracketMatch) {
    const inner = chordBracketMatch[1];
    const duration = chordBracketMatch[2] ? (chordBracketMatch[2].toLowerCase() as DurationType) : defaultDuration;
    const dots = chordBracketMatch[3] === "." ? 1 : chordBracketMatch[2] ? 0 : defaultDots;
    const tied = chordBracketMatch[4] === "~";

    const parts = inner.split(",").map((p) => p.trim());
    const pitches: NotePitch[] = [];
    const tabPositions: TabPosition[] = [];

    for (const part of parts) {
      // Pitch with an explicit tab position, e.g. c4(5/3)
      const withTab = part.match(/^(.+?)\((\d+)\/(\d+)\)$/);
      if (withTab) {
        const p = parsePitchString(withTab[1]);
        if (p) pitches.push(p);
        tabPositions.push({ fret: parseInt(withTab[2], 10), str: parseInt(withTab[3], 10) });
      } else if (part.includes(":") || /^\d+\/\d+$/.test(part)) {
        const [f, s] = part.includes(":") ? part.split(":") : part.split("/");
        const fret = parseInt(f, 10);
        const str = parseInt(s, 10);
        tabPositions.push({ fret, str });
        // Coupled blocks also get the staff pitch for a bare fret/string part
        const tabPitch = mode === "coupled" ? pitchFromTab(fret, str, tuning) : undefined;
        if (tabPitch) pitches.push(tabPitch);
      } else {
        const p = parsePitchString(part);
        if (p) pitches.push(p);
      }
    }

    // Explicit `pitch(fret/string)` positions only apply when every note has one, so the
    // fret list always lines up with the pitch list. Partly specified chords are auto-placed.
    const isPositioned = (part: string) => /\(\d+\/\d+\)$/.test(part) || part.includes(":") || /^\d+\/\d+$/.test(part);
    const allPositioned = parts.length > 0 && parts.every(isPositioned);
    return {
      id,
      duration,
      isRest: false,
      dots,
      tied,
      pitches: pitches.length > 0 ? pitches : undefined,
      tabPositions: allPositioned ? tabPositions : undefined,
    };
  }

  // Single standard pitch: e.g. c4/q, f#4/8, bb3/h., g4/q~
  // Pitch with optional fret/string in parens, optional legacy /dur suffix, optional tie.
  const noteMatch = token.match(/^([a-gA-G])([#bn]?)(-?\d+)(?:\((\d+)\/(\d+)\))?(?:\/([whq8]|16|32)(\.?)(t?))?(~?)$/i);
  if (noteMatch) {
    const step = noteMatch[1].toLowerCase() as any;
    const accidental = (noteMatch[2] || undefined) as any;
    const octave = parseInt(noteMatch[3], 10);
    const tabFret = noteMatch[4] ? parseInt(noteMatch[4], 10) : undefined;
    const tabStr = noteMatch[5] ? parseInt(noteMatch[5], 10) : undefined;
    const duration = noteMatch[6] ? (noteMatch[6].toLowerCase() as DurationType) : defaultDuration;
    const dots = noteMatch[6] ? (noteMatch[7] === "." ? 1 : 0) : defaultDots;
    const tuplet = noteMatch[8] === "t" || noteMatch[8] === "T";
    const tied = noteMatch[9] === "~";

    const pitches: NotePitch[] = [{ step, octave, accidental }];
    const tabPositions: TabPosition[] | undefined =
      tabFret !== undefined && tabStr !== undefined ? [{ fret: tabFret, str: tabStr }] : undefined;

    return {
      id,
      duration,
      isRest: false,
      dots,
      ...(tuplet ? { tuplet: true } : {}),
      tied,
      pitches,
      tabPositions,
    };
  }

  return null;
}

/** Helper to parse pitch like "c4", "f#4", "bb3" */
export function parsePitchString(str: string): NotePitch | null {
  const m = str.trim().match(/^([a-gA-G])([#bn]?)(-?\d+)$/);
  if (!m) return null;
  return {
    step: m[1].toLowerCase() as any,
    accidental: (m[2] || undefined) as any,
    octave: parseInt(m[3], 10),
  };
}
