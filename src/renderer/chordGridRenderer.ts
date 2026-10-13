/**
 * Lead-Sheet Chord Grid SVG Renderer
 */
import { ChordGridScore } from "../types";
import { parseChord } from "../parser/chordParser";

export interface ChordGridRenderOptions {
  width?: number;
  interactive?: boolean;
  activeMeasureIndex?: number;
  onMeasureClick?: (measureIndex: number) => void;
}

export function renderChordGrid(
  containerEl: HTMLElement,
  score: ChordGridScore,
  options: ChordGridRenderOptions = {}
): HTMLElement {
  containerEl.empty();
  const wrapper = containerEl.createDiv({ cls: "br-chordgrid-container" });

  if (score.title) {
    const titleEl = wrapper.createDiv({ cls: "br-chordgrid-title" });
    titleEl.setText(score.title);
  }

  const measuresPerRow = score.measuresPerRow || 4;
  const totalMeasures = score.measures.length;
  const numRows = Math.ceil(totalMeasures / measuresPerRow);

  const containerWidth = options.width || Math.max(containerEl.clientWidth || 700, 500);
  const cellWidth = Math.floor((containerWidth - 20) / measuresPerRow);
  const cellHeight = 70;
  const rowSpacing = 20;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  const totalHeight = numRows * (cellHeight + rowSpacing) + 30;

  svg.setAttribute("width", `${containerWidth}`);
  svg.setAttribute("height", `${totalHeight}`);
  svg.setAttribute("viewBox", `0 0 ${containerWidth} ${totalHeight}`);
  svg.classList.add("br-chordgrid-svg");

  for (let mIdx = 0; mIdx < totalMeasures; mIdx++) {
    const measure = score.measures[mIdx];
    const row = Math.floor(mIdx / measuresPerRow);
    const col = mIdx % measuresPerRow;

    const x = 10 + col * cellWidth;
    const y = 15 + row * (cellHeight + rowSpacing);

    const isFirstInRow = col === 0;
    const isLastInRow = col === measuresPerRow - 1 || mIdx === totalMeasures - 1;
    const isSelected = options.activeMeasureIndex === mIdx;

    // Group for measure
    const g = document.createElementNS(svgNS, "g");
    g.classList.add("br-chordgrid-measure");
    if (isSelected) g.classList.add("is-selected");
    g.setAttribute("data-measure-index", `${mIdx}`);

    if (options.interactive && options.onMeasureClick) {
      g.style.cursor = "pointer";
      g.addEventListener("click", () => options.onMeasureClick!(mIdx));
    }

    // Measure box background
    const rect = document.createElementNS(svgNS, "rect");
    rect.setAttribute("x", `${x}`);
    rect.setAttribute("y", `${y}`);
    rect.setAttribute("width", `${cellWidth}`);
    rect.setAttribute("height", `${cellHeight}`);
    rect.setAttribute("rx", "4");
    rect.classList.add("br-chordgrid-cell-bg");
    if (isSelected) rect.classList.add("is-active-bg");
    g.appendChild(rect);

    // Section label above first measure in section
    if (measure.section) {
      const secText = document.createElementNS(svgNS, "text");
      secText.setAttribute("x", `${x + 6}`);
      secText.setAttribute("y", `${y - 5}`);
      secText.classList.add("br-chordgrid-section-label");
      secText.textContent = `[${measure.section}]`;
      g.appendChild(secText);
    }

    // Barlines
    // Left barline
    if (measure.repeatBegin) {
      // Repeat start: thick line, thin line, double dots
      drawRepeatBar(g, x, y, cellHeight, "begin");
    } else {
      const leftBar = document.createElementNS(svgNS, "line");
      leftBar.setAttribute("x1", `${x}`);
      leftBar.setAttribute("y1", `${y}`);
      leftBar.setAttribute("x2", `${x}`);
      leftBar.setAttribute("y2", `${y + cellHeight}`);
      leftBar.classList.add("br-chordgrid-barline");
      g.appendChild(leftBar);
    }

    // Right barline
    if (measure.repeatEnd) {
      drawRepeatBar(g, x + cellWidth, y, cellHeight, "end");
    } else if (isLastInRow) {
      const rightBar = document.createElementNS(svgNS, "line");
      rightBar.setAttribute("x1", `${x + cellWidth}`);
      rightBar.setAttribute("y1", `${y}`);
      rightBar.setAttribute("x2", `${x + cellWidth}`);
      rightBar.setAttribute("y2", `${y + cellHeight}`);
      rightBar.classList.add("br-chordgrid-barline");
      g.appendChild(rightBar);
    }

    // Measure number
    const numText = document.createElementNS(svgNS, "text");
    numText.setAttribute("x", `${x + 6}`);
    numText.setAttribute("y", `${y + 14}`);
    numText.classList.add("br-chordgrid-measure-num");
    numText.textContent = `${measure.number}`;
    g.appendChild(numText);

    // Measure content (chords, slashes, simile)
    const chords = measure.cells[0]?.chords || [];
    if (chords.includes("%")) {
      // Simile / repeat measure sign
      drawSimile(g, x + cellWidth / 2, y + cellHeight / 2);
    } else if (chords.length === 1) {
      // Single chord centered
      drawChordSvg(g, chords[0], x + cellWidth / 2, y + cellHeight / 2 + 7, "center");
    } else if (chords.length === 2) {
      // Two chords split evenly
      drawChordSvg(g, chords[0], x + cellWidth * 0.28, y + cellHeight / 2 + 7, "center");
      drawChordSvg(g, chords[1], x + cellWidth * 0.72, y + cellHeight / 2 + 7, "center");
    } else if (chords.length === 4) {
      // 4 beats
      for (let i = 0; i < 4; i++) {
        const cx = x + cellWidth * (0.15 + i * 0.23);
        const item = chords[i];
        if (item === "/") {
          drawBeatSlash(g, cx, y + cellHeight / 2 + 4);
        } else {
          drawChordSvg(g, item, cx, y + cellHeight / 2 + 7, "center");
        }
      }
    } else {
      // Multiple items spaced
      chords.forEach((ch, idx) => {
        const cx = x + (cellWidth / (chords.length + 1)) * (idx + 1);
        if (ch === "/") {
          drawBeatSlash(g, cx, y + cellHeight / 2 + 4);
        } else {
          drawChordSvg(g, ch, cx, y + cellHeight / 2 + 7, "center");
        }
      });
    }

    svg.appendChild(g);
  }

  wrapper.appendChild(svg);
  return wrapper;
}

/** Helper to draw repeat barlines */
function drawRepeatBar(
  g: SVGElement,
  x: number,
  y: number,
  height: number,
  type: "begin" | "end"
) {
  const svgNS = "http://www.w3.org/2000/svg";
  const thickX = type === "begin" ? x + 1.5 : x - 1.5;
  const thinX = type === "begin" ? x + 5 : x - 5;
  const dotX = type === "begin" ? x + 9 : x - 9;

  const thickLine = document.createElementNS(svgNS, "line");
  thickLine.setAttribute("x1", `${thickX}`);
  thickLine.setAttribute("y1", `${y}`);
  thickLine.setAttribute("x2", `${thickX}`);
  thickLine.setAttribute("y2", `${y + height}`);
  thickLine.setAttribute("stroke-width", "3.5");
  thickLine.classList.add("br-chordgrid-barline-thick");
  g.appendChild(thickLine);

  const thinLine = document.createElementNS(svgNS, "line");
  thinLine.setAttribute("x1", `${thinX}`);
  thinLine.setAttribute("y1", `${y}`);
  thinLine.setAttribute("x2", `${thinX}`);
  thinLine.setAttribute("y2", `${y + height}`);
  thinLine.setAttribute("stroke-width", "1");
  thinLine.classList.add("br-chordgrid-barline");
  g.appendChild(thinLine);

  const dot1 = document.createElementNS(svgNS, "circle");
  dot1.setAttribute("cx", `${dotX}`);
  dot1.setAttribute("cy", `${y + height * 0.35}`);
  dot1.setAttribute("r", "2.5");
  dot1.classList.add("br-chordgrid-repeat-dot");
  g.appendChild(dot1);

  const dot2 = document.createElementNS(svgNS, "circle");
  dot2.setAttribute("cx", `${dotX}`);
  dot2.setAttribute("cy", `${y + height * 0.65}`);
  dot2.setAttribute("r", "2.5");
  dot2.classList.add("br-chordgrid-repeat-dot");
  g.appendChild(dot2);
}

/** Draw beat slash */
function drawBeatSlash(g: SVGElement, x: number, y: number) {
  const svgNS = "http://www.w3.org/2000/svg";
  const slash = document.createElementNS(svgNS, "line");
  slash.setAttribute("x1", `${x - 6}`);
  slash.setAttribute("y1", `${y + 8}`);
  slash.setAttribute("x2", `${x + 6}`);
  slash.setAttribute("y2", `${y - 8}`);
  slash.setAttribute("stroke-width", "2");
  slash.classList.add("br-chordgrid-slash");
  g.appendChild(slash);
}

/** Draw simile / percent repeat symbol */
function drawSimile(g: SVGElement, cx: number, cy: number) {
  const svgNS = "http://www.w3.org/2000/svg";
  const slash = document.createElementNS(svgNS, "line");
  slash.setAttribute("x1", `${cx - 10}`);
  slash.setAttribute("y1", `${cy + 10}`);
  slash.setAttribute("x2", `${cx + 10}`);
  slash.setAttribute("y2", `${cy - 10}`);
  slash.setAttribute("stroke-width", "2.5");
  slash.classList.add("br-chordgrid-slash");
  g.appendChild(slash);

  const dot1 = document.createElementNS(svgNS, "circle");
  dot1.setAttribute("cx", `${cx - 6}`);
  dot1.setAttribute("cy", `${cy - 6}`);
  dot1.setAttribute("r", "3");
  dot1.classList.add("br-chordgrid-repeat-dot");
  g.appendChild(dot1);

  const dot2 = document.createElementNS(svgNS, "circle");
  dot2.setAttribute("cx", `${cx + 6}`);
  dot2.setAttribute("cy", `${cy + 6}`);
  dot2.setAttribute("r", "3");
  dot2.classList.add("br-chordgrid-repeat-dot");
  g.appendChild(dot2);
}

/** Draw chord name with typography */
function drawChordSvg(
  g: SVGElement,
  chordStr: string,
  x: number,
  y: number,
  align: "center" | "left" = "center"
) {
  const parsed = parseChord(chordStr);
  const svgNS = "http://www.w3.org/2000/svg";
  const text = document.createElementNS(svgNS, "text");
  text.setAttribute("x", `${x}`);
  text.setAttribute("y", `${y}`);
  text.setAttribute("text-anchor", align === "center" ? "middle" : "start");
  text.classList.add("br-chordgrid-chord-text");

  // Root
  const rootTspan = document.createElementNS(svgNS, "tspan");
  rootTspan.textContent = parsed.root;
  rootTspan.classList.add("br-chord-root");
  text.appendChild(rootTspan);

  // Accidental
  if (parsed.accidental) {
    const accTspan = document.createElementNS(svgNS, "tspan");
    accTspan.textContent = parsed.accidental === "b" ? "♭" : "♯";
    accTspan.classList.add("br-chord-accidental");
    text.appendChild(accTspan);
  }

  // Quality & extensions as superscript
  if (parsed.quality || parsed.alterations.length > 0) {
    const extTspan = document.createElementNS(svgNS, "tspan");
    extTspan.setAttribute("dy", "-4");
    extTspan.setAttribute("font-size", "0.75em");
    let q = parsed.quality;
    if (q === "maj7" || q === "Δ") q = "maj7";
    else if (q === "m7") q = "m7";
    else if (q === "m7b5" || q === "ø") q = "ø7";
    else if (q === "dim7" || q === "°") q = "°7";

    const alts = parsed.alterations.map((a) => a.replace(/b/g, "♭").replace(/#/g, "♯")).join("");
    extTspan.textContent = `${q}${alts}`;
    text.appendChild(extTspan);
  }

  // Slash bass
  if (parsed.bass) {
    const bassTspan = document.createElementNS(svgNS, "tspan");
    bassTspan.setAttribute("dy", "4");
    bassTspan.setAttribute("font-size", "0.85em");
    const bAcc = parsed.bass.includes("b") ? "♭" : parsed.bass.includes("#") ? "♯" : "";
    const bRoot = parsed.bass.replace(/[#b]/g, "");
    bassTspan.textContent = `/${bRoot}${bAcc}`;
    text.appendChild(bassTspan);
  }

  g.appendChild(text);
}
