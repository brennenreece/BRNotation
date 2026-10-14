/**
 * BRNotation - Type Definitions
 */

export type ClefType = "treble" | "bass" | "alto" | "tenor" | "tab";
export type DurationType = "w" | "h" | "q" | "8" | "16" | "32";
export type BlockMode = "notation" | "tab" | "coupled" | "chordgrid" | "chord" | "fretboard";

export interface NotePitch {
  step: "c" | "d" | "e" | "f" | "g" | "a" | "b";
  octave: number;
  accidental?: "#" | "b" | "n" | "##" | "bb";
}

export interface TabPosition {
  str: number; // 1-indexed (1 is highest string, high E)
  fret: number;
  technique?: "h" | "p" | "b" | "s" | "v" | "pm";
}

export interface ScoreNote {
  id: string;
  duration: DurationType;
  isRest: boolean;
  dots: number;
  tuplet?: boolean; // triplet: three notes in the time of two
  tied?: boolean;
  pitches?: NotePitch[]; // for standard notation
  tabPositions?: TabPosition[]; // for tablature
  chordSymbol?: string;
  lyric?: string; // syllable under this note (ABC `w:` line)
  lyricHold?: boolean; // `_` in a lyric line: continues the previous syllable
  articulations?: ("staccato" | "accent" | "tenuto" | "fermata")[];
}

export interface ScoreMeasure {
  number: number;
  timeSignature?: string; // e.g. "4/4"
  keySignature?: string; // e.g. "C", "G", "F"
  clef?: ClefType;
  notes: ScoreNote[];
  startBarline?: "repeat-begin"; // left edge; right edge is `barline`
  barline?: "single" | "double" | "repeat-end" | "end"; // right edge
  systemBreak?: boolean; // written as `\` before the measure: starts a new system
}

export interface NotationScore {
  mode: "notation" | "tab" | "coupled";
  title?: string;
  subtitle?: string;
  composer?: string;
  timeSignature: string;
  keySignature: string;
  clef: ClefType;
  tuning: string[]; // e.g. ["E4", "B3", "G3", "D3", "A2", "E2"]
  measures: ScoreMeasure[];
  /** "font" draws staff notation with SMuFL glyphs from the staff font; "vexflow" uses VexFlow's glyphs. */
  render?: "vexflow" | "font";
}

export interface ChordGridCell {
  chords: string[]; // e.g. ["Cmaj7"] or ["Cmaj7", "G7"]
  beats?: number[]; // beats where chords land
  slashes?: number; // count of beat slashes
  simile?: boolean; // % sign
  annotation?: string;
}

export interface ChordGridMeasure {
  number: number;
  section?: string; // e.g. "Verse", "Chorus"
  cells: ChordGridCell[];
  startBarline?: "repeat-begin"; // left edge, same as the staff notation
  barline?: "single" | "double" | "repeat-end" | "end"; // right edge, same as the staff notation
}

export interface ChordGridScore {
  title?: string;
  timeSignature: string;
  key?: string; // used for roman-numeral functions
  showFunctions: boolean; // "chord function = true"
  showMeasureNumbers: boolean; // "measure numbers = true"
  measuresPerRow: number;
  measures: ChordGridMeasure[];
}

/** Dot style for diagram notes. `classic` marks the root filled and other notes outlined. */
export type DiagramDotStyle =
  | "classic"
  | "filled"
  | "outlined"
  | "ghost"
  | "accent-outline"
  | "tone-ring"
  | "muted"
  | "square"
  | "diamond"
  | "numbered-role"
  | "inverted";
export const DIAGRAM_DOT_STYLES: DiagramDotStyle[] = [
  "classic",
  "filled",
  "outlined",
  "ghost",
  "accent-outline",
  "tone-ring",
  "muted",
  "square",
  "diamond",
  "numbered-role",
  "inverted",
];

/** Named colors for dots. They map to Obsidian theme variables in styles.css. */
export type DiagramColor = "accent" | "red" | "green" | "blue" | "orange" | "purple" | "muted";
export const DIAGRAM_COLORS: DiagramColor[] = ["accent", "red", "green", "blue", "orange", "purple", "muted"];

export interface ChordDiagramData {
  name: string;
  dotStyle?: DiagramDotStyle;
  dotColor?: DiagramColor;
  tuning?: string[]; // default ["E", "A", "D", "G", "B", "E"]
  frets: (number | "x")[]; // index 0 is lowest string (E2) or highest? We will standardize: 0 is lowest string (6th string)
  fingers?: (number | string | null)[];
  baseFret?: number; // 1-based base fret
  barre?: {
    fret: number;
    fromStr: number; // 1-based (6=low E, 1=high E)
    toStr: number;
  };
}

/** One note from a `notes:` line. `str` is 1-based with 1 = high E, matching tab. */
export interface DiagramNote {
  str: number;
  fret: number;
  label?: string;
  /** `root` forces the root dot style; other values override the block's dot style. */
  style?: DiagramDotStyle | "root";
  color?: DiagramColor;
}

export interface FretboardScaleData {
  title?: string;
  root: string; // e.g. "A", "C", "F#"
  scale: string; // e.g. "major", "minor", "minor-pentatonic", "blues", "dorian"
  tuning?: string[]; // default standard guitar
  minFret: number; // default 0
  maxFret: number; // default 12, 15, or 24
  displayMode: "degrees" | "notes";
  dotStyle?: DiagramDotStyle;
  dotColor?: DiagramColor;
  /** Notes entered one by one with `notes:`. When set, these replace the scale's automatic dots. */
  customPositions?: DiagramNote[];
}

export interface ParsedBlock {
  mode: BlockMode;
  rawText: string;
  notationScore?: NotationScore;
  chordGridScore?: ChordGridScore;
  chordDiagram?: ChordDiagramData;
  fretboardScale?: FretboardScaleData;
  errors?: string[];
}
