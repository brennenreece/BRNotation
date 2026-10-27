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

/** One bend (`b`) or release (`r`) in quarter tones: 1/4 = 1, 1/2 = 2, full = 4. */
export interface BendAction {
  kind: "bend" | "release";
  quarterTones: number;
}

export interface TabPosition {
  str: number; // 1-indexed (1 is highest string, high E)
  fret: number;
  technique?: "h" | "p" | "b" | "s" | "v" | "pm";
  /** Bend and release actions in order, from `7/3{b1/2,rfull}`. Steps are in quarter tones. */
  bends?: BendAction[];
}

export interface ScoreNote {
  id: string;
  duration: DurationType;
  isRest: boolean;
  dots: number;
  tuplet?: boolean; // triplet: three notes in the time of two
  beamGroup?: number; // explicit beam group id from `<...>` in the measure
  tied?: boolean;
  hammerPull?: "h" | "p"; // hammer-on or pull-off: this note is reached from the previous note
  hammerFrom?: { measure: number; index: number }; // the note the hammer or pull starts from, when it is in an earlier measure
  voice?: 1 | 2; // part from a `V1:` / `V2:` line; undefined when the block has no parts
  pitches?: NotePitch[]; // for standard notation
  tabPositions?: TabPosition[]; // for tablature
  chordSymbol?: string;
  lyric?: string; // syllable under this note (ABC `w:` line)
  lyricHold?: boolean; // `_` in a lyric line: continues the previous syllable
  articulations?: ("staccato" | "accent" | "tenuto" | "fermata")[];
  textAbove?: string; // `{above:...}`: small sans-serif text above the note
  textBelow?: string; // `{below:...}`: small sans-serif text below the note
  circled?: boolean; // `{circle}`: ring around the notehead
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
  showTimeSignature?: boolean; // "time: 4/4 visible = false" hides the signature (default true)
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
  /** Per-string dot overrides from `{style,color}` after a fret in `frets:`. Index matches `frets`. */
  dotOverrides?: ({ style?: DiagramDotStyle | "root"; color?: DiagramColor } | null)[];
  /** Per-string text from `notes:` `=label`, shown in the dot when no finger number is set. Index matches `frets`. */
  labels?: (string | null)[];
  baseFret?: number; // 1-based base fret
  /** Row this box sits in when the block uses `row:` lines. */
  row?: number;
  /** Number of fret spaces drawn (default 5). Set by `fret-count:` in the block. */
  numFrets?: number;
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
  /** True when a `-` in `notes:` joins this note to the one before it. */
  linkFromPrevious?: boolean;
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
  maxFret: number; // default 12; set with `frets: a-b`
  displayMode: "degrees" | "notes";
  dotStyle?: DiagramDotStyle;
  dotColor?: DiagramColor;
  /** Notes entered one by one with `notes:`. When set, these replace the scale's automatic dots. */
  customPositions?: DiagramNote[];
  /** Width in pixels of the lines joining `notes:` linked with `-`. Default 1. */
  lineWidth?: number;
}

export interface ParsedBlock {
  mode: BlockMode;
  rawText: string;
  notationScore?: NotationScore;
  chordGridScore?: ChordGridScore;
  chordDiagram?: ChordDiagramData;
  /** Chord block with several boxes, laid out in rows of `columns`. */
  chordDiagrams?: ChordDiagramData[];
  chordColumns?: number;
  /** Boxes across the pane that one box is sized for (`size:` in the block). */
  chordSize?: number;
  /** Horizontal alignment of the chord box columns and boxes (`align:`). */
  chordAlign?: "left" | "center" | "right";
  chordFont?: string;
  fretboardScale?: FretboardScaleData;
  errors?: string[];
  /** Space above the whole block (`space-above:`), as a CSS length such as "12px" or "1em". */
  spaceAbove?: string;
  /** Space below the whole block (`space-below:`), as a CSS length. */
  spaceBelow?: string;
}
