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

const ROMAN_TOKEN = /^([#b♭♯]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(.*)$/;

/**
 * True when a chord-grid token is written as a roman numeral (I7, IV, bVII, ii7).
 * Note-name roots (A-G) are not matched, so chords such as "Bb" or "Am7" are unaffected.
 */
export function isRomanNumeralToken(token: string): boolean {
  return ROMAN_TOKEN.test(token.trim());
}

/**
 * Splits a roman-numeral token into its display base and superscript quality, like note-name chords.
 * "I7" -> { base: "I", quality: "7" }; "bVIIM7" -> { base: "♭VII", quality: "maj7" }; "viidim7" -> { base: "vii", quality: "°7" }.
 */
export function splitRomanNumeral(token: string): { base: string; quality: string } {
  const m = token.trim().match(ROMAN_TOKEN);
  if (!m) return { base: token, quality: "" };
  const prefix = m[1] === "b" ? "♭" : m[1] === "#" ? "♯" : m[1];
  const rest = m[3];
  const q = rest.match(/^(maj7|M7|Δ|m7b5|ø7|ø|dim7|°7|°|m7|7|6|m|dim)?(.*)$/);
  let quality = q?.[1] ?? "";
  const alts = (q?.[2] ?? "").replace(/b/g, "♭").replace(/#/g, "♯");
  if (quality === "M7" || quality === "Δ") quality = "maj7";
  else if (quality === "m7b5" || quality === "ø") quality = "ø7";
  else if (quality === "dim7" || quality === "°") quality = "°7";
  else if (quality === "dim") quality = "°";
  else if (quality === "m") quality = "";
  return { base: prefix + m[2], quality: quality + alts };
}
