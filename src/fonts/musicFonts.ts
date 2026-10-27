import { MUSIC_FONT_DATA } from "./fontData";
import { setChordBoxFontStyle, setChordFontStyle } from "../renderer/chordGridRenderer";

/**
 * Chord symbol fonts. Each text face covers letters, digits, and the common chord
 * symbols. The system option uses the Obsidian UI font.
 */
export const CHORD_FONT_OPTIONS: Record<
  string,
  { label: string; family: string; scale: number; spacing: number; weight: number }
> = {
  system: { label: "System default", family: "var(--font-sans)", scale: 1, spacing: 0, weight: 700 },
  // Jazz faces are condensed and only ship Regular, so they are set larger. Bold is
  // not applied because the browser would synthesize it and thicken the accidentals.
  julesjazz: { label: "JulesJazz (jazz chord charts)", family: "\"JulesJazzText\", var(--font-sans)", scale: 1.4, spacing: 0, weight: 400 },
  musejazz: { label: "MuseJazz (jazz chord charts)", family: "\"MuseJazzText\", var(--font-sans)", scale: 1.4, spacing: 0, weight: 400 },
};

/**
 * Tab fret number font choices. `family` is a CSS font stack applied to the fret numbers.
 */
export const TAB_FONT_OPTIONS: Record<string, { label: string; family: string }> = {
  system: { label: "System default", family: "var(--font-sans)" },
  mono: { label: "Monospace", family: "var(--font-monospace)" },
  serif: { label: "Serif", family: "Georgia, \"Times New Roman\", serif" },
  julesjazz: { label: "JulesJazz (jazz)", family: "\"JulesJazzText\", var(--font-sans)" },
  musejazz: { label: "MuseJazz (jazz)", family: "\"MuseJazzText\", var(--font-sans)" },
};

/**
 * Staff notation font choices. `vexflow` is the VexFlow family name. `noteheadScale`
 * scales the notehead so it matches Bravura's size against the same staff spacing.
 * Values are the notehead height ratio to Bravura (0.250 em), measured from each font.
 */
export const STAFF_FONT_OPTIONS: Record<string, { label: string; vexflow: string; noteheadScale: number }> = {
  bravura: { label: "Bravura (standard)", vexflow: "Bravura", noteheadScale: 0.9 },
  petaluma: { label: "Petaluma (handwritten)", vexflow: "Petaluma", noteheadScale: 0.686 },
  leland: { label: "Leland (MuseScore)", vexflow: "Leland", noteheadScale: 0.849 },
  jazz: { label: "JulesJazz (jazz)", vexflow: "JulesJazz", noteheadScale: 0.833 },
  gootville: { label: "Gootville (engraved)", vexflow: "Gootville", noteheadScale: 0.833 },
  musejazz: { label: "MuseJazz (jazz)", vexflow: "MuseJazz", noteheadScale: 0.833 },
};

/** Bundled font data key → CSS family name it is registered under. */
const REGISTERED_FAMILIES: Record<string, string> = {
  JulesJazzText: "JulesJazzText",
  Bravura: "Bravura",
  Leland: "Leland",
  Petaluma: "Petaluma",
  JulesJazz: "JulesJazz",
  Gootville: "Gootville",
  MuseJazz: "MuseJazz",
  MuseJazzText: "MuseJazzText",
};

let fontsLoaded: Promise<void> | null = null;

/** Registers the bundled music fonts with the document. Safe to call repeatedly. */
export function loadBundledFonts(): Promise<void> {
  if (fontsLoaded) return fontsLoaded;
  fontsLoaded = (async () => {
    if (typeof FontFace === "undefined") return;
    for (const [key, family] of Object.entries(REGISTERED_FAMILIES)) {
      const data = MUSIC_FONT_DATA[key];
      if (!data) continue;
      try {
        const face = new FontFace(family, `url(${data})`);
        await face.load();
        (document.fonts as unknown as { add(f: FontFace): void }).add(face);
      } catch (err) {
        console.warn(`BRNotation: failed to load font ${family}`, err);
      }
    }
  })();
  return fontsLoaded;
}

/** Applies the chord box font, size, and letter spacing to chord box names. */
export function applyChordBoxFont(choice: string, baseSize: number, spacing: number): void {
  const option = CHORD_FONT_OPTIONS[choice] ?? CHORD_FONT_OPTIONS.system;
  setChordBoxFontStyle(resolveFontFamily(option.family), baseSize * option.scale, spacing, option.weight);
}

/** Applies the chosen chord font by setting a CSS variable used by chord text. */
export function applyChordFont(choice: string, baseSize: number, spacing: number): void {
  const option = CHORD_FONT_OPTIONS[choice] ?? CHORD_FONT_OPTIONS.system;
  document.body.style.setProperty("--br-chord-font", option.family);
  setChordFontStyle(resolveFontFamily(option.family), baseSize * option.scale, spacing, option.weight);
}

/**
 * Replaces CSS var(--name) references with their computed values, so SVG attributes
 * (which don't resolve CSS variables) get real font names.
 */
export function resolveFontFamily(family: string): string {
  if (!family.includes("var(")) return family;
  const styles = getComputedStyle(document.body);
  return family.replace(/var\((--[\w-]+)(?:,\s*([^)]*))?\)/g, (_m, name: string, fallback?: string) => {
    const value = styles.getPropertyValue(name).trim();
    return value || fallback?.trim() || "sans-serif";
  });
}
