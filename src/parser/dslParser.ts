/**
 * BRNotation DSL Parser
 */
import {
  BlockMode,
  ChordDiagramData,
  ChordGridMeasure,
  ChordGridScore,
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

  // Check directive headers
  const contentLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("# ")) {
      if (trimmed.startsWith("# ")) title = trimmed.replace(/^#\s*/, "");
      continue;
    }

    const lower = trimmed.toLowerCase();
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
    const chordGridScore = parseChordGrid(contentLines, title, timeSignature, measuresPerRow);
    return { mode, rawText, chordGridScore, errors };
  } else if (mode === "chord") {
    const chordDiagram: ChordDiagramData = {
      name: chordName,
      tuning,
      frets: chordFrets,
      fingers: chordFingers,
      baseFret,
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
    };
    return { mode, rawText, fretboardScale, errors };
  } else {
    // notation, tab, or coupled
    const notationScore = parseNotationContent(contentLines, mode, title, timeSignature, keySignature, clef, tuning);
    return { mode, rawText, notationScore, errors };
  }
}

/** Parses lead-sheet chord grids */
function parseChordGrid(
  lines: string[],
  title: string | undefined,
  timeSignature: string,
  measuresPerRow: number
): ChordGridScore {
  const measures: ChordGridMeasure[] = [];
  let currentSection: string | undefined = undefined;
  let measureCount = 1;

  for (const line of lines) {
    let text = line.trim();
    // Section header e.g. [Verse] or [Chorus]
    const secMatch = text.match(/^\[(.*?)\]$/);
    if (secMatch) {
      currentSection = secMatch[1];
      continue;
    }

    // Measure parts separated by '|'
    if (text.startsWith("|")) text = text.slice(1);
    if (text.endsWith("|")) text = text.slice(0, -1);

    const mParts = text.split("|");
    for (let part of mParts) {
      part = part.trim();
      if (!part) continue;

      let repeatBegin = false;
      let repeatEnd = false;
      if (part.startsWith(":")) {
        repeatBegin = true;
        part = part.slice(1).trim();
      }
      if (part.endsWith(":")) {
        repeatEnd = true;
        part = part.slice(0, -1).trim();
      }

      const chords = part.split(/\s+/).filter(Boolean);
      const cells = [
        {
          chords: chords.map((c) => (c === "/" ? "/" : c === "%" ? "%" : c)),
          simile: chords.includes("%"),
        },
      ];

      measures.push({
        number: measureCount++,
        section: currentSection,
        cells,
        repeatBegin,
        repeatEnd,
      });

      // Section only applies to the first measure of that section
      currentSection = undefined;
    }
  }

  return {
    title,
    timeSignature,
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
  tuning: string[]
): NotationScore {
  const measures: ScoreMeasure[] = [];
  let currentMeasureNumber = 1;

  // Combine lines and split by measure bar '|'
  const fullContent = lines.join(" ");
  const rawMeasures = fullContent.split("|");

  for (const rawM of rawMeasures) {
    const trimmed = rawM.trim();
    if (!trimmed) continue;

    const notes: ScoreNote[] = [];
    // Tokenize notes: e.g. "Am7" e4/q or c4/8 or [c4,e4,g4]/q or 3:5/8
    const tokens = tokenizeMeasure(trimmed);

    for (const token of tokens) {
      const scoreNote = parseNoteToken(token, mode);
      if (scoreNote) notes.push(scoreNote);
    }

    if (notes.length > 0) {
      measures.push({
        number: currentMeasureNumber++,
        timeSignature: currentMeasureNumber === 2 ? timeSignature : undefined,
        keySignature: currentMeasureNumber === 2 ? keySignature : undefined,
        clef: currentMeasureNumber === 2 ? clef : undefined,
        notes,
      });
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

/** Helper to tokenize notes and chord symbols in a measure */
function tokenizeMeasure(measureStr: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"]+)"|\[([^\]]+)\]\/(\w+)(\.?)(~?)|([^\s]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(measureStr)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

/** Parses a single note or chord token */
function parseNoteToken(token: string, mode: "notation" | "tab" | "coupled"): ScoreNote | null {
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

  // Rest: r/q, rest/8, r/w
  const restMatch = token.match(/^(?:r|rest)\/([whq8]|16|32)(\.?)/i);
  if (restMatch) {
    return {
      id,
      duration: restMatch[1].toLowerCase() as DurationType,
      isRest: true,
      dots: restMatch[2] === "." ? 1 : 0,
    };
  }

  // Tab note: e.g. 3:5/8 or 0:1/q or 5:3/8h
  const tabMatch = token.match(/^(\d+):(\d+)\/([whq8]|16|32)(\.?)(~?)([hpsv]?)/i);
  if (tabMatch) {
    const fret = parseInt(tabMatch[1], 10);
    const str = parseInt(tabMatch[2], 10);
    const duration = tabMatch[3].toLowerCase() as DurationType;
    const dots = tabMatch[4] === "." ? 1 : 0;
    const tied = tabMatch[5] === "~";
    const technique = (tabMatch[6]?.toLowerCase() as any) || undefined;

    return {
      id,
      duration,
      isRest: false,
      dots,
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
  const noteMatch = token.match(/^([a-gA-G])([#bn]?)(-?\d+)(?:\((\d+):(\d+)\))?\/([whq8]|16|32)(\.?)(~?)/);
  if (noteMatch) {
    const step = noteMatch[1].toLowerCase() as any;
    const accidental = (noteMatch[2] || undefined) as any;
    const octave = parseInt(noteMatch[3], 10);
    const tabFret = noteMatch[4] ? parseInt(noteMatch[4], 10) : undefined;
    const tabStr = noteMatch[5] ? parseInt(noteMatch[5], 10) : undefined;
    const duration = noteMatch[6].toLowerCase() as DurationType;
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
