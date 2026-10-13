/**
 * Musical pitch, scale, and tuning utilities
 */

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const ENHARMONIC_FLATS: Record<string, string> = {
  Db: "C#",
  Eb: "D#",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#",
};

export const ENHARMONIC_SHARPS: Record<string, string> = {
  "C#": "Db",
  "D#": "Eb",
  "F#": "Gb",
  "G#": "Ab",
  "A#": "Bb",
};

export interface TuningsPreset {
  name: string;
  notes: string[]; // lowest string to highest string, e.g. ["E2", "A2", "D3", "G3", "B3", "E4"]
}

export const TUNING_PRESETS: Record<string, TuningsPreset> = {
  standard: {
    name: "Guitar Standard (E A D G B E)",
    notes: ["E2", "A2", "D3", "G3", "B3", "E4"],
  },
  "drop-d": {
    name: "Guitar Drop D (D A D G B E)",
    notes: ["D2", "A2", "D3", "G3", "B3", "E4"],
  },
  dadgad: {
    name: "Guitar DADGAD (D A D G A D)",
    notes: ["D2", "A2", "D3", "G3", "A3", "D4"],
  },
  "open-d": {
    name: "Guitar Open D (D A D F# A D)",
    notes: ["D2", "A2", "D3", "F#3", "A3", "D4"],
  },
  "open-g": {
    name: "Guitar Open G (D G D G B D)",
    notes: ["D2", "G2", "D3", "G3", "B3", "D4"],
  },
  "bass-4": {
    name: "Bass 4-string (E A D G)",
    notes: ["E1", "A1", "D2", "G2"],
  },
  "bass-5": {
    name: "Bass 5-string (B E A D G)",
    notes: ["B0", "E1", "A1", "D2", "G2"],
  },
  ukulele: {
    name: "Ukulele Standard (G C E A)",
    notes: ["G4", "C4", "E4", "A4"],
  },
};

export interface ScaleDefinition {
  name: string;
  intervals: number[]; // semitone offsets from root
  degrees: string[]; // degree labels, e.g. "1", "b3", "4", "5", "b7"
}

export const SCALE_DEFINITIONS: Record<string, ScaleDefinition> = {
  major: {
    name: "Major",
    intervals: [0, 2, 4, 5, 7, 9, 11],
    degrees: ["1", "2", "3", "4", "5", "6", "7"],
  },
  minor: {
    name: "Natural Minor",
    intervals: [0, 2, 3, 5, 7, 8, 10],
    degrees: ["1", "2", "b3", "4", "5", "b6", "b7"],
  },
  "minor-pentatonic": {
    name: "Minor Pentatonic",
    intervals: [0, 3, 5, 7, 10],
    degrees: ["1", "b3", "4", "5", "b7"],
  },
  "major-pentatonic": {
    name: "Major Pentatonic",
    intervals: [0, 2, 4, 7, 9],
    degrees: ["1", "2", "3", "5", "6"],
  },
  blues: {
    name: "Blues",
    intervals: [0, 3, 5, 6, 7, 10],
    degrees: ["1", "b3", "4", "b5", "5", "b7"],
  },
  dorian: {
    name: "Dorian",
    intervals: [0, 2, 3, 5, 7, 9, 10],
    degrees: ["1", "2", "b3", "4", "5", "6", "b7"],
  },
  mixolydian: {
    name: "Mixolydian",
    intervals: [0, 2, 4, 5, 7, 9, 10],
    degrees: ["1", "2", "3", "4", "5", "6", "b7"],
  },
  "harmonic-minor": {
    name: "Harmonic Minor",
    intervals: [0, 2, 3, 5, 7, 8, 11],
    degrees: ["1", "2", "b3", "4", "5", "b6", "7"],
  },
  "melodic-minor": {
    name: "Melodic Minor",
    intervals: [0, 2, 3, 5, 7, 9, 11],
    degrees: ["1", "2", "b3", "4", "5", "6", "7"],
  },
  chromatic: {
    name: "Chromatic",
    intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    degrees: ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"],
  },
};

/** Parse note string like "C4", "F#3", "Bb2" into MIDI number */
export function noteToMidi(noteStr: string): number {
  const match = noteStr.trim().match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!match) return 60; // middle C default
  let step = match[1].toUpperCase();
  const acc = match[2];
  const oct = parseInt(match[3], 10);

  let key = step;
  if (acc === "#") key += "#";
  if (acc === "b") {
    key = ENHARMONIC_FLATS[key + "b"] || key;
  }

  const semitone = NOTE_NAMES.indexOf(key);
  if (semitone === -1) return 60;
  return (oct + 1) * 12 + semitone;
}

/** Convert MIDI number to note name like "C4" or "F#3" */
export function midiToNote(midi: number, preferFlat = false): string {
  const semitone = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  let name = NOTE_NAMES[semitone];
  if (preferFlat && ENHARMONIC_SHARPS[name]) {
    name = ENHARMONIC_SHARPS[name];
  }
  return `${name}${octave}`;
}

/** Convert MIDI to frequency in Hz */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Calculate pitch for string and fret */
export function stringFretToMidi(openNoteStr: string, fret: number): number {
  return noteToMidi(openNoteStr) + fret;
}

/** Given a MIDI note, find best string and fret on guitar */
export function midiToStringFret(
  midi: number,
  tuningNotes: string[] = TUNING_PRESETS.standard.notes
): { strIndex: number; fret: number } | null {
  // tuningNotes is ordered lowest to highest (e.g. E2 to E4)
  // Check from highest string down to find a fret in 0-15 range
  for (let i = tuningNotes.length - 1; i >= 0; i--) {
    const openMidi = noteToMidi(tuningNotes[i]);
    const fret = midi - openMidi;
    if (fret >= 0 && fret <= 15) {
      return { strIndex: i, fret };
    }
  }
  return null;
}
