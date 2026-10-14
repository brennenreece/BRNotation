/**
 * Fretboard & Chord Diagram SVG Renderer
 */
import { ChordDiagramData, DiagramColor, DiagramDotStyle, DiagramNote, FretboardScaleData } from "../types";
import {
  NOTE_NAMES,
  noteToMidi,
  SCALE_DEFINITIONS,
  stringFretToMidi,
  TUNING_PRESETS,
} from "../parser/scales";
import { formatChordHtml } from "../parser/chordParser";

/** Shared sizing so chord boxes and fretboard maps draw dots and strings the same way. */
function dotRadiusFor(stringSpacing: number, fretSpacing: number): number {
  return Math.max(4, Math.min(stringSpacing, fretSpacing) / 2 - 1) * 0.8;
}

/** Strings taper from thick (low E) to thin (high E). `stringIndex` 0 is the low E string. */
function stringStrokeWidth(stringIndex: number, numStrings: number): number {
  const thin = 1.2;
  const thick = 2.6;
  return numStrings > 1 ? thick - (stringIndex / (numStrings - 1)) * (thick - thin) : thick;
}

/**
 * Dot style classes. A block `style:` sets the default, and a per-note `{style}` overrides it.
 * `classic` keeps the default look; the others change fill and stroke in styles.css.
 */
function dotStyleClass(style: DiagramDotStyle | "root" | undefined, isRoot: boolean, color?: DiagramColor): string[] {
  const classes: string[] = [];
  if (style === "root" || (!style && isRoot)) classes.push("is-root");
  else if (style === "numbered-role") classes.push("style-classic");
  else classes.push(`style-${style ?? "classic"}`);
  if (color) classes.push(`color-${color}`);
  return classes;
}

/**
 * Creates a dot shape at (x, y). Squares and diamonds are drawn as polygons so they
 * share the same class names and CSS variables as circles.
 */
function createDot(
  svgNS: string,
  shape: "circle" | "square" | "diamond",
  x: number,
  y: number,
  r: number
): SVGElement {
  if (shape === "circle") {
    const c = document.createElementNS(svgNS, "circle") as SVGCircleElement;
    c.setAttribute("cx", `${x}`);
    c.setAttribute("cy", `${y}`);
    c.setAttribute("r", `${r}`);
    return c;
  }
  const p = document.createElementNS(svgNS, "polygon") as SVGPolygonElement;
  const pts = shape === "square"
    ? [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]]
    : [[x, y - r * 1.25], [x + r * 1.25, y], [x, y + r * 1.25], [x - r * 1.25, y]];
  p.setAttribute("points", pts.map(([px, py]) => `${px},${py}`).join(" "));
  return p;
}

/** Shape used by a dot style. Only square and diamond change the shape. */
function shapeFor(style: DiagramDotStyle | "root" | undefined): "circle" | "square" | "diamond" {
  if (style === "square") return "square";
  if (style === "diamond") return "diamond";
  return "circle";
}

/** Height in px of one fret space in a chord box. */
const CHORD_BOX_FRET_SPACING = 28;

/**
 * Renders one or more chord boxes in a grid with `columns` boxes per row.
 * A single box renders exactly as before.
 */
export function renderChordBoxes(
  containerEl: HTMLElement,
  boxes: ChordDiagramData[],
  columns?: number,
  size?: number
): void {
  containerEl.empty();
  if (boxes.length <= 1 && !columns && !size) {
    renderChordDiagram(containerEl, boxes[0]);
    return;
  }
  const cols = Math.max(1, Math.min(columns ?? boxes.length, boxes.length));
  const grid = containerEl.createDiv({ cls: "br-chord-box-grid" });
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  if (size) {
    // Each box gets the width it would have in a row of `size` boxes, so
    // the box size stays the same whatever `columns:` is set to.
    const colGap = 16;
    grid.style.gridTemplateColumns = `repeat(${cols}, calc((100% - ${(size - 1) * colGap}px) / ${size}))`;
    grid.style.justifyContent = "start";
  }
  for (const box of boxes) {
    const cell = grid.createDiv({ cls: "br-chord-box-cell" });
    renderChordDiagram(cell, box);
  }
}

export function renderChordDiagram(
  containerEl: HTMLElement,
  data: ChordDiagramData,
  options: { width?: number; height?: number } = {}
): HTMLElement {
  containerEl.empty();
  const wrapper = containerEl.createDiv({ cls: "br-diagram br-chord-box-container" });

  const numStrings = data.frets.length || 6;
  const numFrets = data.numFrets ?? 5;
  const baseFret = data.baseFret || 1;

  const width = options.width || 180;
  // Each fret has the same height, so fewer frets give a shorter box.
  const padTop = 56;
  const padBottom = 25;
  const fretSpacing = CHORD_BOX_FRET_SPACING;
  const height = options.height || padTop + numFrets * fretSpacing + padBottom;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", `${width}`);
  svg.setAttribute("height", `${height}`);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.classList.add("br-diagram-svg", "br-chord-box-svg");

  // Title / Chord Name
  const title = document.createElementNS(svgNS, "text");
  title.setAttribute("x", `${width / 2}`);
  // Halfway between the top of the SVG and the nut, so the name sits close to the box.
  title.setAttribute("y", "39");
  title.setAttribute("text-anchor", "middle");
  title.classList.add("br-diagram-title");
  title.textContent = data.name;
  svg.appendChild(title);

  // Diagram boundaries
  const padLeft = 35;
  const padRight = 35;

  const gridWidth = width - padLeft - padRight;
  const gridHeight = numFrets * fretSpacing;
  const stringSpacing = gridWidth / (numStrings - 1);

  // Base fret indicator (e.g. "3fr")
  if (baseFret > 1) {
    const baseText = document.createElementNS(svgNS, "text");
    baseText.setAttribute("x", `${padLeft - 8}`);
    baseText.setAttribute("y", `${padTop + fretSpacing * 0.7}`);
    baseText.setAttribute("text-anchor", "end");
    baseText.classList.add("br-diagram-aux");
    baseText.textContent = `${baseFret}fr`;
    svg.appendChild(baseText);
  }

  // Nut or Top fret line
  const nut = document.createElementNS(svgNS, "line");
  nut.setAttribute("x1", `${padLeft}`);
  nut.setAttribute("y1", `${padTop}`);
  nut.setAttribute("x2", `${padLeft + gridWidth}`);
  nut.setAttribute("y2", `${padTop}`);
  nut.classList.add(baseFret === 1 ? "br-diagram-nut" : "br-diagram-line");
  svg.appendChild(nut);

  // Fret horizontal lines
  for (let f = 1; f <= numFrets; f++) {
    const y = padTop + f * fretSpacing;
    const fLine = document.createElementNS(svgNS, "line");
    fLine.setAttribute("x1", `${padLeft}`);
    fLine.setAttribute("y1", `${y}`);
    fLine.setAttribute("x2", `${padLeft + gridWidth}`);
    fLine.setAttribute("y2", `${y}`);
    fLine.classList.add("br-diagram-line");
    svg.appendChild(fLine);
  }

  // Strings vertical lines
  for (let s = 0; s < numStrings; s++) {
    const x = padLeft + s * stringSpacing;
    const sLine = document.createElementNS(svgNS, "line");
    sLine.setAttribute("x1", `${x}`);
    sLine.setAttribute("y1", `${padTop}`);
    sLine.setAttribute("x2", `${x}`);
    sLine.setAttribute("y2", `${padTop + gridHeight}`);
    sLine.setAttribute("stroke-width", `${stringStrokeWidth(s, numStrings)}`);
    sLine.classList.add("br-diagram-string");
    svg.appendChild(sLine);
  }

  // Draw open / muted symbols and finger dots
  // data.frets: index 0 is string 6 (low E on left) to string 1 (high E on right)
  for (let s = 0; s < numStrings; s++) {
    const fretVal = data.frets[s];
    const x = padLeft + s * stringSpacing;

    if (String(fretVal).toLowerCase() === "x") {
      // Muted string 'X'
      const xText = document.createElementNS(svgNS, "text");
      xText.setAttribute("x", `${x}`);
      xText.setAttribute("y", `${padTop - 8}`);
      xText.setAttribute("text-anchor", "middle");
      xText.classList.add("br-diagram-muted");
      xText.textContent = "✕";
      svg.appendChild(xText);
    } else if (fretVal === 0) {
      // Open string 'O'
      const oCircle = document.createElementNS(svgNS, "circle");
      oCircle.setAttribute("cx", `${x}`);
      oCircle.setAttribute("cy", `${padTop - 12}`);
      oCircle.setAttribute("r", "4.5");
      oCircle.classList.add("br-diagram-open");
      svg.appendChild(oCircle);
    } else if (typeof fretVal === "number" && fretVal > 0) {
      // Finger dot
      const relativeFret = fretVal - (baseFret - 1);
      if (relativeFret >= 1 && relativeFret <= numFrets) {
        const y = padTop + (relativeFret - 0.5) * fretSpacing;
        // Same marker markup as fretboard notes, so both use one dot style
        const g = document.createElementNS(svgNS, "g");
        g.classList.add("br-diagram-marker", "is-note");
        const dot = createDot(svgNS, shapeFor(data.dotStyle), x, y, dotRadiusFor(stringSpacing, fretSpacing));
        dot.classList.add("br-diagram-dot", "is-note", ...dotStyleClass(data.dotStyle, false, data.dotColor));
        g.appendChild(dot);

        // Finger number if provided
        const finger = data.fingers ? data.fingers[s] : null;
        if (finger && finger !== "-") {
          const fText = document.createElementNS(svgNS, "text");
          fText.setAttribute("x", `${x}`);
          fText.setAttribute("y", `${y + 3}`);
          fText.setAttribute("text-anchor", "middle");
          fText.classList.add("br-diagram-label");
          fText.textContent = `${finger}`;
          g.appendChild(fText);
        }
        svg.appendChild(g);
      }
    }
  }

  wrapper.appendChild(svg);
  return wrapper;
}

/** Render a horizontal scale / arpeggio fretboard map */
export function renderFretboardScale(
  containerEl: HTMLElement,
  data: FretboardScaleData,
  options: { width?: number; height?: number; onNoteClick?: (strIdx: number, fret: number) => void } = {}
): HTMLElement {
  containerEl.empty();
  const wrapper = containerEl.createDiv({ cls: "br-diagram br-fretboard-map-container" });

  if (data.title) {
    const titleEl = wrapper.createDiv({ cls: "br-diagram-title" });
    titleEl.setText(data.title);
  }

  const tuning = data.tuning || TUNING_PRESETS.standard.notes;
  const numStrings = tuning.length; // e.g. 6
  const minFret = data.minFret || 0;
  const maxFret = data.maxFret || 12;
  const totalFrets = maxFret - minFret + 1;

  const containerWidth = options.width || Math.max(containerEl.clientWidth || 750, 600);
  const height = options.height || 190;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", `${containerWidth}`);
  svg.setAttribute("height", `${height}`);
  svg.setAttribute("viewBox", `0 0 ${containerWidth} ${height}`);
  svg.classList.add("br-diagram-svg", "br-fretboard-svg");

  const padLeft = 45;
  const padRight = 20;
  const padTop = 30;
  const padBottom = 36;

  const boardWidth = containerWidth - padLeft - padRight;
  const boardHeight = height - padTop - padBottom;
  const stringSpacing = boardHeight / (numStrings - 1);
  const fretSpacing = boardWidth / (totalFrets - 1);

  // Fret lines (vertical)
  for (let f = minFret; f <= maxFret; f++) {
    const x = padLeft + (f - minFret) * fretSpacing;
    const fLine = document.createElementNS(svgNS, "line");
    fLine.setAttribute("x1", `${x}`);
    fLine.setAttribute("y1", `${padTop}`);
    fLine.setAttribute("x2", `${x}`);
    fLine.setAttribute("y2", `${padTop + boardHeight}`);

    if (f === 0) {
      fLine.classList.add("br-diagram-nut");
    } else {
      fLine.classList.add("br-diagram-line");
    }
    svg.appendChild(fLine);

    // Fret number at bottom
    if (f > 0) {
      const numText = document.createElementNS(svgNS, "text");
      numText.setAttribute("x", `${x - fretSpacing / 2}`);
      numText.setAttribute("y", `${padTop + boardHeight + 24}`);
      numText.setAttribute("text-anchor", "middle");
      numText.classList.add("br-diagram-aux");
      numText.textContent = `${f}`;
      svg.appendChild(numText);
    }
  }

  // Strings (horizontal lines): index 0 = lowest string at bottom (guitar orientation) or top?
  // Standard tab/fretboard diagram convention: high E on top (string index numStrings - 1), low E on bottom (string index 0)
  for (let s = 0; s < numStrings; s++) {
    // Invert so high E is at top
    const displayIndex = numStrings - 1 - s;
    const y = padTop + displayIndex * stringSpacing;
    const sLine = document.createElementNS(svgNS, "line");
    sLine.setAttribute("x1", `${padLeft}`);
    sLine.setAttribute("y1", `${y}`);
    sLine.setAttribute("x2", `${padLeft + boardWidth}`);
    sLine.setAttribute("y2", `${y}`);
    sLine.setAttribute("stroke-width", `${stringStrokeWidth(s, numStrings)}`);
    sLine.classList.add("br-diagram-string");
    svg.appendChild(sLine);
  }

  // Scale calculations
  const scaleDef = SCALE_DEFINITIONS[data.scale.toLowerCase()] || SCALE_DEFINITIONS["major"];
  const rootMidi = noteToMidi(`${data.root}4`);
  const rootPitchClass = rootMidi % 12;

  // Map of pitch classes in the scale to their degree label
  const scaleDegreeMap: Record<number, { degree: string; isRoot: boolean }> = {};
  scaleDef.intervals.forEach((interval, idx) => {
    const pc = (rootPitchClass + interval) % 12;
    scaleDegreeMap[pc] = {
      degree: scaleDef.degrees[idx],
      isRoot: idx === 0,
    };
  });

  const dotRadius = dotRadiusFor(stringSpacing, fretSpacing);

  if (data.customPositions && data.customPositions.length > 0) {
    renderCustomNotes(svg, data, numStrings, tuning, minFret, padLeft, fretSpacing, stringSpacing, padTop, dotRadius, options);
    wrapper.appendChild(svg);
    return wrapper;
  }

  // Plot note markers across frets and strings
  for (let s = 0; s < numStrings; s++) {
    const displayIndex = numStrings - 1 - s;
    const y = padTop + displayIndex * stringSpacing;
    const openNote = tuning[s];

    for (let f = minFret; f <= maxFret; f++) {
      const midi = stringFretToMidi(openNote, f);
      const pc = ((midi % 12) + 12) % 12;

      if (scaleDegreeMap[pc]) {
        const { degree, isRoot } = scaleDegreeMap[pc];
        const x = f === 0 ? padLeft - dotRadius - 4 : padLeft + (f - minFret) * fretSpacing - fretSpacing / 2;

        const g = document.createElementNS(svgNS, "g");
        g.classList.add("br-diagram-marker");
        if (isRoot) g.classList.add("is-root");

        if (options.onNoteClick) {
          g.style.cursor = "pointer";
          g.addEventListener("click", () => options.onNoteClick!(s, f));
        }

        const circle = createDot(svgNS, shapeFor(data.dotStyle), x, y, dotRadius + (isRoot ? 1 : 0));
        circle.classList.add("br-diagram-dot", isRoot ? "is-root" : "is-note", ...dotStyleClass(data.dotStyle, isRoot, data.dotColor).filter((c) => c !== "is-root"));
        g.appendChild(circle);

        const text = document.createElementNS(svgNS, "text");
        text.setAttribute("x", `${x}`);
        text.setAttribute("y", `${y + 3.5}`);
        text.setAttribute("text-anchor", "middle");
        text.classList.add("br-diagram-label");

        if (data.displayMode === "notes") {
          text.textContent = NOTE_NAMES[pc];
        } else {
          text.textContent = degree;
        }

        g.appendChild(text);
        svg.appendChild(g);
      }
    }
  }

  wrapper.appendChild(svg);
  return wrapper;
}

/**
 * Draws notes entered with `notes:`. Each note is placed at its own fret/string,
 * with its own dot style (`{style}`) and optional label (`=text`).
 */
function renderCustomNotes(
  svg: SVGSVGElement,
  data: FretboardScaleData,
  numStrings: number,
  tuning: string[],
  minFret: number,
  padLeft: number,
  fretSpacing: number,
  stringSpacing: number,
  padTop: number,
  dotRadius: number,
  options: { onNoteClick?: (stringIndex: number, fret: number) => void }
): void {
  const svgNS = "http://www.w3.org/2000/svg";
  const rootPc = noteToMidi(`${data.root}4`) % 12;
  for (const note of data.customPositions ?? []) {
    // Tab numbering: string 1 = high E. Tuning index 0 = low E, so invert.
    if (note.str < 1 || note.str > numStrings || note.fret < 0) continue;
    const stringIndex = numStrings - note.str;
    const displayIndex = numStrings - 1 - stringIndex;
    const y = padTop + displayIndex * stringSpacing;
    const x = note.fret === 0 ? padLeft - dotRadius - 4 : padLeft + (note.fret - minFret) * fretSpacing - fretSpacing / 2;

    const pc = ((stringFretToMidi(tuning[stringIndex], note.fret) % 12) + 12) % 12;
    const isRoot = pc === rootPc;

    const g = document.createElementNS(svgNS, "g");
    g.classList.add("br-diagram-marker", isRoot ? "is-root" : "is-note");
    if (options.onNoteClick) {
      g.style.cursor = "pointer";
      g.addEventListener("click", () => options.onNoteClick!(stringIndex, note.fret));
    }

    const noteStyle = note.style ?? data.dotStyle;
    const color = note.color ?? data.dotColor;
    const circle = createDot(svgNS, shapeFor(noteStyle), x, y, dotRadius + (isRoot ? 1 : 0));
    circle.classList.add("br-diagram-dot", "is-note", ...dotStyleClass(noteStyle, isRoot, color).filter((c) => c !== "is-root"));
    g.appendChild(circle);

    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("x", `${x}`);
    text.setAttribute("y", `${y + 3.5}`);
    text.setAttribute("text-anchor", "middle");
    text.classList.add("br-diagram-label");
    text.textContent = note.label ?? NOTE_NAMES[pc];
    g.appendChild(text);
    svg.appendChild(g);
  }
}
