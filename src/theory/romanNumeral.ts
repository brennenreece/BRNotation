/**
 * Roman-numeral function labels for chord symbols relative to a key.
 */

const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];
// Semitone offset of each diatonic degree in a major key
const MAJOR_DEGREE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Pitch class (0-11) for a note such as "C", "F#", "Bb", or -1 if unparseable. */
function pitchClass(note: string): number {
  const m = note.match(/^([A-Ga-g])([#b]?)$/);
  if (!m) return -1;
  let pc = NATURAL_PC[m[1].toUpperCase()];
  if (m[2] === "#") pc += 1;
  if (m[2] === "b") pc -= 1;
  return ((pc % 12) + 12) % 12;
}

/**
 * Major-key tonic pitch class. Accepts "C", "G", "Bb", "Am", "F#m".
 * A minor key is mapped to its relative major (Am -> C), so numerals stay in the major-key frame.
 */
function keyTonic(key: string): number {
  const m = key.trim().match(/^([A-Ga-g][#b]?)(m|min|minor)?$/);
  if (!m) return -1;
  const pc = pitchClass(m[1]);
  return m[2] ? (pc + 3) % 12 : pc;
}

/**
 * Returns a roman-numeral label for a chord symbol in the given key, or undefined if the key or chord cannot be read.
 * Major-quality chords use uppercase numerals; minor and diminished use lowercase.
 * Chromatic roots get a flat or sharp prefix.
 */
export function romanNumeralFor(chord: string, key: string): string | undefined {
  const tonic = keyTonic(key);
  if (tonic < 0) return undefined;

  const m = chord.trim().match(/^([A-Ga-g][#b]?)(.*)$/);
  if (!m) return undefined;
  const rootPc = pitchClass(m[1]);
  if (rootPc < 0) return undefined;
  const quality = m[2];

  const interval = (rootPc - tonic + 12) % 12;
  let degree = MAJOR_DEGREE_SEMITONES.indexOf(interval);
  let prefix = "";
  if (degree < 0) {
    // Conventional spelling: borrowed degrees 1, 3, 8, 10 are flats (♭II ♭III ♭VI ♭VII); others are sharps (♯IV, etc.)
    const flatSpelled = [1, 3, 8, 10].includes(interval);
    if (flatSpelled) {
      degree = MAJOR_DEGREE_SEMITONES.indexOf((interval + 1) % 12);
      prefix = "♭";
    } else {
      degree = MAJOR_DEGREE_SEMITONES.indexOf((interval + 11) % 12);
      prefix = "♯";
    }
  }

  const isMinorOrDim = /^(m(?!aj)|min|-|dim|°|ø)/.test(quality);
  let label = prefix + (isMinorOrDim ? NUMERALS[degree].toLowerCase() : NUMERALS[degree]);

  if (/^(dim|°|ø)/.test(quality)) label += quality.startsWith("ø") ? "ø" : "°";
  const ext = quality.match(/(maj7|m7|7|6)/);
  if (ext) label += ext[1] === "maj7" ? "M7" : ext[1] === "m7" ? "7" : ext[1];

  return label;
}
