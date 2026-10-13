/**
 * Chord parser and formatter
 */
import { ENHARMONIC_FLATS, noteToMidi, NOTE_NAMES } from "./scales";

export interface ParsedChord {
  raw: string;
  root: string;
  accidental: string;
  quality: string;
  extension: string;
  alterations: string[];
  bass?: string;
  midiNotes: number[]; // chord pitches in MIDI (root octave default ~3/4)
}

const CHORD_FORMULAS: Record<string, number[]> = {
  // triads
  maj: [0, 4, 7],
  "": [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  "-": [0, 3, 7],
  dim: [0, 3, 6],
  "°": [0, 3, 6],
  aug: [0, 4, 8],
  "+": [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  sus: [0, 5, 7],
  // 7ths
  "7": [0, 4, 7, 10],
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  M7: [0, 4, 7, 11],
  "Δ7": [0, 4, 7, 11],
  Δ: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  min7: [0, 3, 7, 10],
  "-7": [0, 3, 7, 10],
  mmaj7: [0, 3, 7, 11],
  "m(maj7)": [0, 3, 7, 11],
  dim7: [0, 3, 6, 9],
  "°7": [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  "half-dim": [0, 3, 6, 10],
  "ø": [0, 3, 6, 10],
  "ø7": [0, 3, 6, 10],
  aug7: [0, 4, 8, 10],
  "+7": [0, 4, 8, 10],
  "7sus4": [0, 5, 7, 10],
  "7sus": [0, 5, 7, 10],
  // 6ths
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  // 9ths, 11ths, 13ths
  "9": [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
  "11": [0, 4, 7, 10, 14, 17],
  m11: [0, 3, 7, 10, 14, 17],
  "13": [0, 4, 7, 10, 14, 21],
  maj13: [0, 4, 7, 11, 14, 21],
  m13: [0, 3, 7, 10, 14, 21],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  "5": [0, 7], // power chord
};

export function parseChord(chordStr: string): ParsedChord {
  const raw = chordStr.trim();
  // Split slash bass e.g. "C/E", "G7/B"
  let mainPart = raw;
  let bass: string | undefined = undefined;
  if (raw.includes("/")) {
    const parts = raw.split("/");
    mainPart = parts[0].trim();
    bass = parts[1]?.trim();
  }

  // Match root note: letter + optional accidental
  const rootMatch = mainPart.match(/^([A-Ga-g])([#b]?)(.*)$/);
  if (!rootMatch) {
    return {
      raw,
      root: "C",
      accidental: "",
      quality: "",
      extension: "",
      alterations: [],
      bass,
      midiNotes: [60, 64, 67],
    };
  }

  const root = rootMatch[1].toUpperCase();
  const accidental = rootMatch[2] || "";
  let remainder = rootMatch[3].trim();

  // Extract alterations in parentheses e.g. (b9#11) or free alterations
  const alterations: string[] = [];
  const parenMatch = remainder.match(/\((.*?)\)/);
  if (parenMatch) {
    const inner = parenMatch[1];
    remainder = remainder.replace(parenMatch[0], "");
    // split alterations by comma or token
    const altTokens = inner.match(/([#b]?\d+)/g);
    if (altTokens) {
      alterations.push(...altTokens);
    }
  }

  // Look for alterations at end of string e.g. "7b5", "7#9"
  const trailingAlt = remainder.match(/([#b](5|9|11|13))+$/);
  if (trailingAlt) {
    const matched = trailingAlt[0];
    remainder = remainder.slice(0, remainder.length - matched.length);
    const tokens = matched.match(/[#b]\d+/g);
    if (tokens) alterations.push(...tokens);
  }

  const quality = remainder;

  // Derive MIDI notes
  const rootKey = root + (accidental === "#" ? "#" : accidental === "b" ? "b" : "");
  const normalizedKey = ENHARMONIC_FLATS[rootKey] || rootKey;
  const semitone = NOTE_NAMES.indexOf(normalizedKey);
  const baseMidi = 48 + (semitone !== -1 ? semitone : 0); // Octave 3 root

  let intervals = CHORD_FORMULAS[quality] || CHORD_FORMULAS["maj"];
  let midiNotes = intervals.map((i) => baseMidi + i);

  // Apply alterations
  alterations.forEach((alt) => {
    if (alt === "b5") {
      midiNotes = midiNotes.map((m) => (m % 12 === (baseMidi + 7) % 12 ? baseMidi + 6 : m));
    } else if (alt === "#5") {
      midiNotes = midiNotes.map((m) => (m % 12 === (baseMidi + 7) % 12 ? baseMidi + 8 : m));
    } else if (alt === "b9") {
      midiNotes.push(baseMidi + 13);
    } else if (alt === "#9") {
      midiNotes.push(baseMidi + 15);
    } else if (alt === "#11") {
      midiNotes.push(baseMidi + 18);
    } else if (alt === "b13") {
      midiNotes.push(baseMidi + 20);
    }
  });

  // If bass note is specified, add it as the lowest note
  if (bass) {
    const bassKey = ENHARMONIC_FLATS[bass] || bass;
    const bassSemi = NOTE_NAMES.indexOf(bassKey);
    if (bassSemi !== -1) {
      const bassMidi = 36 + bassSemi; // Octave 2
      midiNotes = [bassMidi, ...midiNotes];
    }
  }

  return {
    raw,
    root,
    accidental,
    quality,
    extension: remainder,
    alterations,
    bass,
    midiNotes,
  };
}

/** Formats a chord name into typographic HTML for clean visual presentation */
export function formatChordHtml(chordStr: string): string {
  const parsed = parseChord(chordStr);
  let html = `<span class="br-chord-root">${parsed.root}</span>`;
  if (parsed.accidental) {
    const accChar = parsed.accidental === "b" ? "♭" : "♯";
    html += `<span class="br-chord-accidental">${accChar}</span>`;
  }
  if (parsed.quality) {
    let q = parsed.quality;
    if (q === "maj7" || q === "Δ" || q === "Δ7") q = "maj<sup>7</sup>";
    else if (q === "m7" || q === "min7") q = "m<sup>7</sup>";
    else if (q === "m7b5" || q === "ø" || q === "ø7") q = "ø<sup>7</sup>";
    else if (q === "dim7" || q === "°7") q = "°<sup>7</sup>";
    else if (q.match(/^\d+$/)) q = `<sup>${q}</sup>`;
    html += `<span class="br-chord-quality">${q}</span>`;
  }
  if (parsed.alterations.length > 0) {
    const formattedAlts = parsed.alterations
      .map((a) => a.replace(/b/g, "♭").replace(/#/g, "♯"))
      .join("");
    html += `<sup class="br-chord-alterations">${formattedAlts}</sup>`;
  }
  if (parsed.bass) {
    const bAcc = parsed.bass.includes("b") ? "♭" : parsed.bass.includes("#") ? "♯" : "";
    const bRoot = parsed.bass.replace(/[#b]/g, "");
    html += `<span class="br-chord-bass">/${bRoot}${bAcc}</span>`;
  }
  return `<span class="br-chord-symbol">${html}</span>`;
}
