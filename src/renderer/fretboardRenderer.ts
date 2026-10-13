/**
 * Fretboard & Chord Diagram SVG Renderer
 */
import { ChordDiagramData, FretboardScaleData } from "../types";
import {
  NOTE_NAMES,
  noteToMidi,
  SCALE_DEFINITIONS,
  stringFretToMidi,
  TUNING_PRESETS,
} from "../parser/scales";
import { formatChordHtml } from "../parser/chordParser";

/** Render a vertical chord box diagram */
export function renderChordDiagram(
  containerEl: HTMLElement,
  data: ChordDiagramData,
  options: { width?: number; height?: number } = {}
): HTMLElement {
  containerEl.empty();
  const wrapper = containerEl.createDiv({ cls: "br-chord-box-container" });

  const numStrings = data.frets.length || 6;
  const numFrets = 5;
  const baseFret = data.baseFret || 1;

  const width = options.width || 180;
  const height = options.height || 220;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", `${width}`);
  svg.setAttribute("height", `${height}`);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.classList.add("br-chord-box-svg");

  // Title / Chord Name
  const title = document.createElementNS(svgNS, "text");
  title.setAttribute("x", `${width / 2}`);
  title.setAttribute("y", "24");
  title.setAttribute("text-anchor", "middle");
  title.classList.add("br-chord-box-title");
  title.textContent = data.name;
  svg.appendChild(title);

  // Diagram boundaries
  const padLeft = 35;
  const padRight = 35;
  const padTop = 50;
  const padBottom = 25;

  const gridWidth = width - padLeft - padRight;
  const gridHeight = height - padTop - padBottom;
  const stringSpacing = gridWidth / (numStrings - 1);
  const fretSpacing = gridHeight / numFrets;

  // Base fret indicator (e.g. "3fr")
  if (baseFret > 1) {
    const baseText = document.createElementNS(svgNS, "text");
    baseText.setAttribute("x", `${padLeft - 8}`);
    baseText.setAttribute("y", `${padTop + fretSpacing * 0.7}`);
    baseText.setAttribute("text-anchor", "end");
    baseText.classList.add("br-chord-box-base-fret");
    baseText.textContent = `${baseFret}fr`;
    svg.appendChild(baseText);
  }

  // Nut or Top fret line
  const nut = document.createElementNS(svgNS, "line");
  nut.setAttribute("x1", `${padLeft}`);
  nut.setAttribute("y1", `${padTop}`);
  nut.setAttribute("x2", `${padLeft + gridWidth}`);
  nut.setAttribute("y2", `${padTop}`);
  nut.classList.add(baseFret === 1 ? "br-chord-box-nut" : "br-chord-box-fret");
  if (baseFret === 1) {
    nut.setAttribute("stroke-width", "4");
  }
  svg.appendChild(nut);

  // Fret horizontal lines
  for (let f = 1; f <= numFrets; f++) {
    const y = padTop + f * fretSpacing;
    const fLine = document.createElementNS(svgNS, "line");
    fLine.setAttribute("x1", `${padLeft}`);
    fLine.setAttribute("y1", `${y}`);
    fLine.setAttribute("x2", `${padLeft + gridWidth}`);
    fLine.setAttribute("y2", `${y}`);
    fLine.classList.add("br-chord-box-fret");
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
    sLine.classList.add("br-chord-box-string");
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
      xText.classList.add("br-chord-box-muted");
      xText.textContent = "✕";
      svg.appendChild(xText);
    } else if (fretVal === 0) {
      // Open string 'O'
      const oCircle = document.createElementNS(svgNS, "circle");
      oCircle.setAttribute("cx", `${x}`);
      oCircle.setAttribute("cy", `${padTop - 10}`);
      oCircle.setAttribute("r", "4.5");
      oCircle.classList.add("br-chord-box-open");
      svg.appendChild(oCircle);
    } else if (typeof fretVal === "number" && fretVal > 0) {
      // Finger dot
      const relativeFret = fretVal - (baseFret - 1);
      if (relativeFret >= 1 && relativeFret <= numFrets) {
        const y = padTop + (relativeFret - 0.5) * fretSpacing;
        const dot = document.createElementNS(svgNS, "circle");
        dot.setAttribute("cx", `${x}`);
        dot.setAttribute("cy", `${y}`);
        dot.setAttribute("r", "7");
        dot.classList.add("br-chord-box-dot");
        svg.appendChild(dot);

        // Finger number if provided
        const finger = data.fingers ? data.fingers[s] : null;
        if (finger && finger !== "-") {
          const fText = document.createElementNS(svgNS, "text");
          fText.setAttribute("x", `${x}`);
          fText.setAttribute("y", `${y + 3.5}`);
          fText.setAttribute("text-anchor", "middle");
          fText.classList.add("br-chord-box-finger-text");
          fText.textContent = `${finger}`;
          svg.appendChild(fText);
        }
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
  const wrapper = containerEl.createDiv({ cls: "br-fretboard-map-container" });

  if (data.title) {
    const titleEl = wrapper.createDiv({ cls: "br-fretboard-title" });
    titleEl.setText(data.title);
  }

  const tuning = data.tuning || TUNING_PRESETS.standard.notes;
  const numStrings = tuning.length; // e.g. 6
  const minFret = data.minFret || 0;
  const maxFret = data.maxFret || 12;
  const totalFrets = maxFret - minFret + 1;

  const containerWidth = options.width || Math.max(containerEl.clientWidth || 750, 600);
  const height = options.height || 180;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", `${containerWidth}`);
  svg.setAttribute("height", `${height}`);
  svg.setAttribute("viewBox", `0 0 ${containerWidth} ${height}`);
  svg.classList.add("br-fretboard-svg");

  const padLeft = 45;
  const padRight = 20;
  const padTop = 30;
  const padBottom = 25;

  const boardWidth = containerWidth - padLeft - padRight;
  const boardHeight = height - padTop - padBottom;
  const stringSpacing = boardHeight / (numStrings - 1);
  const fretSpacing = boardWidth / (totalFrets - 1);

  // Inlay marker dots (frets 3, 5, 7, 9, 12, 15, 17, 19, 21, 24)
  const singleDots = [3, 5, 7, 9, 15, 17, 19, 21];
  const doubleDots = [12, 24];

  for (let f = minFret; f <= maxFret; f++) {
    const x = padLeft + (f - minFret) * fretSpacing - fretSpacing / 2;
    if (f > 0 && singleDots.includes(f)) {
      const dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("cx", `${x}`);
      dot.setAttribute("cy", `${padTop + boardHeight / 2}`);
      dot.setAttribute("r", "4.5");
      dot.classList.add("br-fretboard-inlay");
      svg.appendChild(dot);
    } else if (f > 0 && doubleDots.includes(f)) {
      const d1 = document.createElementNS(svgNS, "circle");
      d1.setAttribute("cx", `${x}`);
      d1.setAttribute("cy", `${padTop + boardHeight * 0.25}`);
      d1.setAttribute("r", "4.5");
      d1.classList.add("br-fretboard-inlay");
      svg.appendChild(d1);

      const d2 = document.createElementNS(svgNS, "circle");
      d2.setAttribute("cx", `${x}`);
      d2.setAttribute("cy", `${padTop + boardHeight * 0.75}`);
      d2.setAttribute("r", "4.5");
      d2.classList.add("br-fretboard-inlay");
      svg.appendChild(d2);
    }
  }

  // Fret lines (vertical)
  for (let f = minFret; f <= maxFret; f++) {
    const x = padLeft + (f - minFret) * fretSpacing;
    const fLine = document.createElementNS(svgNS, "line");
    fLine.setAttribute("x1", `${x}`);
    fLine.setAttribute("y1", `${padTop}`);
    fLine.setAttribute("x2", `${x}`);
    fLine.setAttribute("y2", `${padTop + boardHeight}`);

    if (f === 0) {
      fLine.setAttribute("stroke-width", "5");
      fLine.classList.add("br-fretboard-nut");
    } else {
      fLine.classList.add("br-fretboard-fret");
    }
    svg.appendChild(fLine);

    // Fret number at bottom
    if (f > 0) {
      const numText = document.createElementNS(svgNS, "text");
      numText.setAttribute("x", `${x - fretSpacing / 2}`);
      numText.setAttribute("y", `${padTop + boardHeight + 16}`);
      numText.setAttribute("text-anchor", "middle");
      numText.classList.add("br-fretboard-num");
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
    sLine.setAttribute("stroke-width", `${1 + s * 0.4}`); // thicker for lower strings
    sLine.classList.add("br-fretboard-string");
    svg.appendChild(sLine);

    // Tuning label on left
    const openNote = tuning[s];
    const match = openNote.match(/^([A-G][#b]?)/);
    const label = match ? match[1] : openNote;
    const tText = document.createElementNS(svgNS, "text");
    tText.setAttribute("x", `${padLeft - 12}`);
    tText.setAttribute("y", `${y + 4}`);
    tText.setAttribute("text-anchor", "end");
    tText.classList.add("br-fretboard-tuning-label");
    tText.textContent = label;
    svg.appendChild(tText);
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
        const x = f === 0 ? padLeft - 6 : padLeft + (f - minFret) * fretSpacing - fretSpacing / 2;

        const g = document.createElementNS(svgNS, "g");
        g.classList.add("br-fretboard-marker");
        if (isRoot) g.classList.add("is-root");

        if (options.onNoteClick) {
          g.style.cursor = "pointer";
          g.addEventListener("click", () => options.onNoteClick!(s, f));
        }

        const circle = document.createElementNS(svgNS, "circle");
        circle.setAttribute("cx", `${x}`);
        circle.setAttribute("cy", `${y}`);
        circle.setAttribute("r", isRoot ? "8" : "7");
        circle.classList.add(isRoot ? "br-fretboard-root-dot" : "br-fretboard-note-dot");
        g.appendChild(circle);

        const text = document.createElementNS(svgNS, "text");
        text.setAttribute("x", `${x}`);
        text.setAttribute("y", `${y + 3.5}`);
        text.setAttribute("text-anchor", "middle");
        text.classList.add("br-fretboard-dot-text");

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
