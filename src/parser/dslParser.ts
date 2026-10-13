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
import { TUNING_PRESETS } from "./scales";

export function parseBRNotationBlock(rawText: string): ParsedBlock {
  const lines = rawText.split(/\r?\n/);
  const errors: string[] = [];

  // Determine mode from header or first line
  let mode: BlockMode = "notation";
  let title: string | undefined = undefined;
  let timeSignature = "4/4";
  let keySignature = "C";
  let clef: any = "treble";
  let tuningPreset = "standard";
  let measuresPerRow = 4;
  let showFunctions = false;
  let showMeasureNumbers = false;
  let gridKey: string | undefined = undefined;

  // Chord diagram fields
  let chordName = "Chord";
  let chordFrets: (number | "x")[] = [0, 0, 0, 0, 0, 0];
  let chordFingers: (string | number | null)[] = [];
  let baseFret = 1;

  // Fretboard scale fields
  let scaleRoot = "A";
  let scaleName = "minor-pentatonic";
  let minFret = 0;
  let maxFret = 12;
  let displayMode: "degrees" | "notes" = "degrees";
  let dotStyle: DiagramDotStyle | undefined = undefined;
  let dotColor: DiagramColor | undefined = undefined;
  let customNotes: DiagramNote[] | undefined = undefined;

  // Check directive headers
  const contentLines: string[] = [];
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
      customNotes = [];
      for (const token of trimmed.slice(6).trim().split(/\s+/).filter(Boolean)) {
        const note = parseDiagramNote(token);
        if (note) customNotes.push(note);
        else errors.push(`Could not read note "${token}". Use fret/string, such as 5/6 or 7/5{root}=R.`);
      }
      continue;
    }

    if (lower.startsWith("type:") || lower.startsWith("mode:")) {
      const val = trimmed.split(":")[1].trim().toLowerCase() as BlockMode;
      if (["notation", "tab", "coupled", "chordgrid", "chord", "fretboard"].includes(val)) {
        mode = val;
      }
      continue;
    }
    if (lower.startsWith("title:")) {
      title = trimmed.slice(6).trim();
      continue;
    }
    if (lower.startsWith("time:")) {
      timeSignature = trimmed.slice(5).trim();
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
    if (lower.startsWith("name:") || lower.startsWith("chord:")) {
      chordName = trimmed.split(":")[1].trim();
      if (!lines.some((l) => l.toLowerCase().startsWith("type:"))) mode = "chord";
      continue;
    }
    if (lower.startsWith("frets:")) {
      const fStr = trimmed.slice(6).trim();
      chordFrets = fStr.split(/\s+/).map((f) => (f.toLowerCase() === "x" ? "x" : parseInt(f, 10)));
      if (!lines.some((l) => l.toLowerCase().startsWith("type:"))) mode = "chord";
      continue;
    }
    if (lower.startsWith("fingers:")) {
      const fStr = trimmed.slice(8).trim();
      chordFingers = fStr.split(/\s+/).map((f) => (f === "-" || f === "0" ? null : f));
      continue;
    }
    if (lower.startsWith("base-fret:") || lower.startsWith("basefret:")) {
      baseFret = parseInt(trimmed.split(":")[1].trim(), 10) || 1;
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

    contentLines.push(trimmed);
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
    const chordGridScore = parseChordGrid(contentLines, title, timeSignature, measuresPerRow, gridKey, showFunctions, showMeasureNumbers);
    return { mode, rawText, chordGridScore, errors };
  } else if (mode === "chord") {
    const chordDiagram: ChordDiagramData = {
      name: chordName,
      tuning,
      frets: chordFrets,
      fingers: chordFingers,
      baseFret,
      dotStyle,
      dotColor,
    };
    return { mode, rawText, chordDiagram, errors };
  } else if (mode === "fretboard") {
    const fretboardScale: FretboardScaleData = {
      title,
      root: scaleRoot,
      scale: scaleName,
      tuning,
      minFret,
      maxFret,
      displayMode,
      dotStyle,
      dotColor,
      customPositions: customNotes,
    };
    return { mode, rawText, fretboardScale, errors };
  } else {
    // notation, tab, or coupled
    const notationScore = parseNotationContent(contentLines, mode, title, timeSignature, keySignature, clef, tuning, errors);
    return { mode, rawText, notationScore, errors };
  }
}

/**
 * Parses one `notes:` entry: `fret/string`, optionally followed by `{style}`, `{style,color}`,
 * `{,color}`, and `=label`.
 * Examples: 5/6, 7/5{root}, 8/4{ghost}=b3, 9/3{halo,red}=R
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
  showMeasureNumbers: boolean
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
    key,
    showFunctions,
    showMeasureNumbers,
    measuresPerRow,
    measures,
  };
}

/** Parses standard notation, tab, and coupled staves */
function parseNotationContent(
  lines: string[],
  mode: "notation" | "tab" | "coupled",
  title: string | undefined,
  timeSignature: string,
  keySignature: string,
  clef: any,
  tuning: string[],
  errors: string[] = []
): NotationScore {
  const measures: ScoreMeasure[] = [];
  let currentMeasureNumber = 1;

  // Split into segments at barline tokens, keeping each barline as its own token.
  // Longest tokens first so ":|:" and "|:" are not read as "|" or ":".
  const fullContent = lines.join(" ");
  const parts = fullContent.split(/(:\|:|\|\||\|:|:\||\|\.|\|)/);

  // A barline token closes the current measure and opens the next one,
  // e.g. ":|:" is a repeat-end on the left and a repeat-begin on the right.
  let openingBar: BarlineType = "single";
  let segment = "";
  let stickyDuration: DurationType = "q";
  const flush = (closingBar: ClosingBarline) => {
    const trimmed = segment.trim();
    segment = "";
    const notes: ScoreNote[] = [];
    for (const token of tokenizeMeasure(trimmed)) {
      const dirMatch = token.match(/^:([whq]|8|16|32)$/i);
      if (dirMatch) {
        stickyDuration = dirMatch[1].toLowerCase() as DurationType;
        continue;
      }
      const scoreNote = parseNoteToken(token, mode, stickyDuration);
      if (scoreNote) notes.push(scoreNote);
      else errors.push(`Could not read "${token}" in measure ${currentMeasureNumber}`);
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
      });
    }
  };

  for (const part of parts) {
    if (part === undefined) continue;
    const bar = BARLINE_TOKENS[part];
    if (bar) {
      flush(bar.closing);
      openingBar = bar.opening;
    } else {
      segment += part;
    }
  }
  flush("single");

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
  const regex = /"([^"]+)"|\[([^\]]+)\]\/(\w+)(\.?)(~?)|(:(?:[whq]|8|16|32)(?=\s|$))|([^\s]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(measureStr)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

/** Parses a single note or chord token. `defaultDuration` is the sticky `:dur` value in effect. */
function parseNoteToken(
  token: string,
  mode: "notation" | "tab" | "coupled",
  defaultDuration: DurationType = "q"
): ScoreNote | null {
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
      dots: restMatch[2] === "." ? 1 : 0,
    };
  }

  // Tab note: fret/string, e.g. 5/3 or 0/1h. Duration comes from the sticky `:dur` directive.
  const tabMatch = token.match(/^(\d+)\/(\d+)(~?)([hpsv]?)$/i);
  if (tabMatch) {
    const fret = parseInt(tabMatch[1], 10);
    const str = parseInt(tabMatch[2], 10);
    const tied = tabMatch[3] === "~";
    const technique = (tabMatch[4]?.toLowerCase() as any) || undefined;

    return {
      id,
      duration: defaultDuration,
      isRest: false,
      dots: 0,
      tied,
      tabPositions: [{ str, fret, technique }],
    };
  }

  // Chord bracket note e.g. [c4,e4,g4]/q or [0:6,2:5,2:4]/w
  const chordBracketMatch = token.match(/^\[(.*?)\]\/([whq8]|16|32)(\.?)(~?)/);
  if (chordBracketMatch) {
    const inner = chordBracketMatch[1];
    const duration = chordBracketMatch[2].toLowerCase() as DurationType;
    const dots = chordBracketMatch[3] === "." ? 1 : 0;
    const tied = chordBracketMatch[4] === "~";

    const parts = inner.split(",").map((p) => p.trim());
    const pitches: NotePitch[] = [];
    const tabPositions: TabPosition[] = [];

    for (const part of parts) {
      if (part.includes(":")) {
        const [f, s] = part.split(":");
        tabPositions.push({ fret: parseInt(f, 10), str: parseInt(s, 10) });
      } else {
        const p = parsePitchString(part);
        if (p) pitches.push(p);
      }
    }

    return {
      id,
      duration,
      isRest: false,
      dots,
      tied,
      pitches: pitches.length > 0 ? pitches : undefined,
      tabPositions: tabPositions.length > 0 ? tabPositions : undefined,
    };
  }

  // Single standard pitch: e.g. c4/q, f#4/8, bb3/h., g4/q~
  // Pitch with optional fret/string in parens, optional legacy /dur suffix, optional tie.
  const noteMatch = token.match(/^([a-gA-G])([#bn]?)(-?\d+)(?:\((\d+)\/(\d+)\))?(?:\/([whq8]|16|32)(\.?))?(~?)$/i);
  if (noteMatch) {
    const step = noteMatch[1].toLowerCase() as any;
    const accidental = (noteMatch[2] || undefined) as any;
    const octave = parseInt(noteMatch[3], 10);
    const tabFret = noteMatch[4] ? parseInt(noteMatch[4], 10) : undefined;
    const tabStr = noteMatch[5] ? parseInt(noteMatch[5], 10) : undefined;
    const duration = noteMatch[6] ? (noteMatch[6].toLowerCase() as DurationType) : defaultDuration;
    const dots = noteMatch[7] === "." ? 1 : 0;
    const tied = noteMatch[8] === "~";

    const pitches: NotePitch[] = [{ step, octave, accidental }];
    const tabPositions: TabPosition[] | undefined =
      tabFret !== undefined && tabStr !== undefined ? [{ fret: tabFret, str: tabStr }] : undefined;

    return {
      id,
      duration,
      isRest: false,
      dots,
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
