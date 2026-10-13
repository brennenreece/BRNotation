/**
 * Chord chart SVG renderer. Staves, barlines, time signature, and beat slashes
 * are drawn with VexFlow, the same as staff notation. Chord names and roman
 * numerals are SVG text.
 */
import { Barline, Formatter, Renderer, Stave, StaveNote, Voice } from "vexflow";
import { ChordGridMeasure, ChordGridScore } from "../types";
import { parseChord } from "../parser/chordParser";
import { romanNumeralFor } from "../theory/romanNumeral";

export interface ChordGridRenderOptions {
  width?: number;
  interactive?: boolean;
  activeMeasureIndex?: number;
  onMeasureClick?: (measureIndex: number) => void;
}

/** Vertical space reserved above the staff for chord names and section labels */
const CHORD_BAND = 34;
/** Vertical space reserved below the staff for roman-numeral functions */
const FUNCTION_BAND = 24;
/** Space between VexFlow staff lines (matches the notation staves) */
const STAFF_SPACE = 10;
/** Extra room under the staff so the bottom row is not clipped */
const STAFF_BOTTOM_PAD = 24;
/** Gap kept between the beat slashes and each barline */
const BEAT_EDGE_INSET = 12;
const TOP_PAD = 8;
const BOTTOM_PAD = 12;
const LEFT_PAD = 6;
const RIGHT_PAD = 10;
/** Width of the first measure of each system, which holds the time signature */
const TIMESIG_WIDTH = 34;

let chordFontFamily = "sans-serif";
let chordFontSize = 16;
let chordFontSpacing = 0;
let chordFontWeight = 700;

/**
 * Sets the font used for chord names. The family must be a concrete font-family list,
 * not a CSS variable: SVG presentation attributes do not resolve var().
 * Size is the chord font size in px; spacing is letter-spacing in px; weight is the font weight.
 */
export function setChordFontStyle(family: string, size: number, spacing: number, weight: number): void {
  chordFontFamily = family;
  chordFontSize = size;
  chordFontSpacing = spacing;
  chordFontWeight = weight;
  // Update chord text already drawn, so open notes change without a re-render.
  document.querySelectorAll<SVGElement>(".br-chordgrid-chord-text").forEach((el) => applyChordTextStyle(el));
}

function applyChordTextStyle(el: Element) {
  el.setAttribute("font-family", chordFontFamily);
  el.setAttribute("font-size", `${chordFontSize}px`);
  el.setAttribute("letter-spacing", `${chordFontSpacing}`);
  el.setAttribute("font-weight", `${chordFontWeight}`);
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
  const numRows = Math.max(1, Math.ceil(totalMeasures / measuresPerRow));

  const containerWidth = options.width || Math.max(containerEl.clientWidth || 700, 500);
  const usableWidth = containerWidth - LEFT_PAD - RIGHT_PAD;
  // The first measure of each row is wider to hold the time signature.
  const baseWidth = (usableWidth - TIMESIG_WIDTH) / measuresPerRow;
  const firstWidth = baseWidth + TIMESIG_WIDTH;

  const funcBand = score.showFunctions ? FUNCTION_BAND : 0;
  // Each system is chord band + staff + numeral band. Total height follows the system count.
  const rowHeight = CHORD_BAND + STAFF_SPACE * 4 + STAFF_BOTTOM_PAD + funcBand;
  // VexFlow staves extend below the bottom line, so the height is taken from the last
  // system's real bottom edge rather than from the estimated row height.
  const lastStaveY = TOP_PAD + (numRows - 1) * rowHeight + CHORD_BAND;
  const lastStave = new Stave(0, lastStaveY, 10);
  const totalHeight = Math.max(
    TOP_PAD + numRows * rowHeight + BOTTOM_PAD,
    lastStave.getBottomY() + FUNCTION_BAND + BOTTOM_PAD
  );

  const svgNS = "http://www.w3.org/2000/svg";
  const svgWrapper = wrapper.createDiv({ cls: "br-chordgrid-svg-wrap" });
  const renderer = new Renderer(svgWrapper, Renderer.Backends.SVG);
  renderer.resize(containerWidth, totalHeight);
  const context = renderer.getContext();
  const svg = svgWrapper.querySelector("svg") as SVGSVGElement | null;
  if (svg) svg.classList.add("br-chordgrid-svg");

  for (let row = 0; row < numRows; row++) {
    const rowTop = TOP_PAD + row * rowHeight;
    const staffY = rowTop + CHORD_BAND;

    for (let col = 0; col < measuresPerRow; col++) {
      const mIdx = row * measuresPerRow + col;
      if (mIdx >= totalMeasures) break;
      const measure = score.measures[mIdx];
      const x = LEFT_PAD + (col === 0 ? 0 : firstWidth + (col - 1) * baseWidth);
      const width = col === 0 ? firstWidth : baseWidth;

      const stave = new Stave(x, staffY, width);
      if (row === 0 && col === 0) {
        stave.addTimeSignature(score.timeSignature);
      }
      applyBarline(stave, measure);
      stave.setContext(context).draw();
      drawRightEdgeBarline(stave, measure);

      drawMeasureContent(context, stave, measure, x, width, score, mIdx, options, svg);
    }
  }

  return wrapper;
}

/** Draws chord names, beat slashes, numerals, and measure number for one measure */
function drawMeasureContent(
  context: any,
  stave: Stave,
  measure: ChordGridMeasure,
  x: number,
  width: number,
  score: ChordGridScore,
  mIdx: number,
  options: ChordGridRenderOptions,
  svg: SVGSVGElement | null
) {
  const svgNS = "http://www.w3.org/2000/svg";
  const g = document.createElementNS(svgNS, "g");
  g.classList.add("br-chordgrid-measure");
  g.setAttribute("data-measure-index", `${mIdx}`);
  if (options.interactive && options.onMeasureClick) {
    g.style.cursor = "pointer";
    g.addEventListener("click", () => options.onMeasureClick!(mIdx));
  }
  if (svg) svg.appendChild(g);

  const top = stave.getYForLine(0);
  const bottom = stave.getYForLine(4);
  const midY = (top + bottom) / 2;

  if (measure.section) {
    const secText = document.createElementNS(svgNS, "text");
    secText.setAttribute("x", `${x + 2}`);
    secText.setAttribute("y", `${top - CHORD_BAND + 10}`);
    secText.classList.add("br-chordgrid-section-label");
    secText.textContent = measure.section;
    g.appendChild(secText);
  }

  if (score.showMeasureNumbers) {
    const numText = document.createElementNS(svgNS, "text");
    numText.setAttribute("x", `${x + 3}`);
    numText.setAttribute("y", `${top - CHORD_BAND + 10}`);
    numText.classList.add("br-chordgrid-measure-num");
    numText.textContent = `${measure.number}`;
    g.appendChild(numText);
  }

  const chords = measure.cells[0]?.chords || [];
  const beatCount = beatsIn(score.timeSignature);
  // Inset from both barlines so slashes never touch a barline or repeat dots
  const innerStart = stave.getNoteStartX() + BEAT_EDGE_INSET;
  const innerEnd = stave.getNoteEndX() - BEAT_EDGE_INSET;
  const innerWidth = Math.max(10, innerEnd - innerStart);

  // One slash per beat, evenly spaced across the measure
  const beatWidth = innerWidth / beatCount;
  for (let b = 0; b < beatCount; b++) {
    const cx = innerStart + beatWidth * (b + 0.5);
    drawBeatSlash(g, cx, midY, STAFF_SPACE);
  }

  // Each chord is centered over the beat where it starts. Chords split the bar evenly.
  chords.forEach((label, idx) => {
    const startBeat = Math.min(beatCount - 1, Math.round((idx * beatCount) / chords.length));
    const cx = innerStart + beatWidth * (startBeat + 0.5);
    if (label === "%") {
      drawSimile(g, cx, top - 12);
      return;
    }
    if (label === "/") return;
    drawChordSvg(g, label, cx, top - 12, "center");
    if (score.showFunctions && score.key) {
      const numeral = romanNumeralFor(label, score.key);
      if (numeral) {
        const fText = document.createElementNS(svgNS, "text");
        fText.setAttribute("x", `${cx}`);
        fText.setAttribute("y", `${bottom + 18}`);
        fText.setAttribute("text-anchor", "middle");
        fText.classList.add("br-chordgrid-function-text");
        fText.textContent = numeral;
        g.appendChild(fText);
      }
    }
  });
}

/** Draws one beat slash as a short diagonal line, the notation's rhythm-slash style */
function drawBeatSlash(g: Element, cx: number, cy: number, space: number) {
  const svgNS = "http://www.w3.org/2000/svg";
  const half = space * 0.6;
  const line = document.createElementNS(svgNS, "line");
  line.setAttribute("x1", `${cx - half}`);
  line.setAttribute("y1", `${cy + half}`);
  line.setAttribute("x2", `${cx + half}`);
  line.setAttribute("y2", `${cy - half}`);
  line.setAttribute("stroke-width", "2.5");
  line.classList.add("br-chordgrid-slash");
  g.appendChild(line);
}

/** Reads the numerator from a time signature such as "4/4" or "3/4" */
function beatsIn(timeSig: string): number {
  const n = parseInt(timeSig.split("/")[0], 10);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

/** Applies the left and right barlines to a stave, matching staff notation */
function applyBarline(stave: Stave, measure: ChordGridMeasure) {
  if (measure.startBarline === "repeat-begin") {
    stave.setBegBarType(Barline.type.REPEAT_BEGIN);
  }
  if (measure.barline === "double") {
    stave.setEndBarType(Barline.type.DOUBLE);
  }
}

/** Draws the right-edge end or repeat-end barline flush with the staff, as staff notation does */
function drawRightEdgeBarline(stave: Stave, measure: ChordGridMeasure) {
  if (measure.barline !== "end" && measure.barline !== "repeat-end") return;
  const ctx = stave.getContext();
  if (!ctx) return;

  const top = stave.getTopLineTopY();
  const height = stave.getBottomLineBottomY() - top;
  const right = stave.getX() + stave.getWidth();

  const thickWidth = 4.5;
  const thickX = right - thickWidth;
  ctx.fillRect(thickX, top, thickWidth, height);

  if (measure.barline === "end") {
    ctx.fillRect(thickX - 3, top, 1, height);
    return;
  }

  const thinX = thickX - 3;
  ctx.fillRect(thinX, top, 1, height);
  const dotRadius = 2;
  const dotX = thinX - 4 - dotRadius;
  const spacing = stave.getSpacingBetweenLines();
  const midY = top + height / 2;
  ctx.beginPath();
  ctx.arc(dotX, midY - spacing / 2, dotRadius, 0, Math.PI * 2, false);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(dotX, midY + spacing / 2, dotRadius, 0, Math.PI * 2, false);
  ctx.fill();
}

/** Draws a "%" simile sign centered on the given point */
function drawSimile(g: Element, cx: number, cy: number) {
  const svgNS = "http://www.w3.org/2000/svg";
  const t = document.createElementNS(svgNS, "text");
  t.setAttribute("x", `${cx}`);
  t.setAttribute("y", `${cy}`);
  t.setAttribute("text-anchor", "middle");
  t.classList.add("br-chordgrid-chord-text");
  applyChordTextStyle(t);
  t.textContent = "%";
  g.appendChild(t);
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
  applyChordTextStyle(text);

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
