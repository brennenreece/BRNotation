/**
 * Interactive Virtual Guitar Fretboard Widget (Soundslice / Dorico inspired)
 */
import { AudioSynthesizer } from "../audio/audioSynthesizer";
import { midiToNote, NOTE_NAMES, stringFretToMidi, TUNING_PRESETS } from "../parser/scales";

export interface FretboardInputEvent {
  str: number; // 1-indexed (1 is high E, 6 is low E)
  fret: number;
  midi: number;
  noteName: string;
  step: "c" | "d" | "e" | "f" | "g" | "a" | "b";
  accidental?: "#" | "b";
  octave: number;
}

export class FretboardWidget {
  private containerEl: HTMLElement;
  private tuning: string[] = TUNING_PRESETS.standard.notes; // E2 to E4
  private maxFret: number = 15;
  private onFretInputCallbacks: ((event: FretboardInputEvent) => void)[] = [];
  private audio: AudioSynthesizer;
  private selectedPosition: { str: number; fret: number } | null = null;

  constructor(parentEl: HTMLElement, tuning = TUNING_PRESETS.standard.notes) {
    this.audio = AudioSynthesizer.getInstance();
    this.tuning = tuning;
    this.containerEl = parentEl.createDiv({ cls: "br-fretboard-widget-container" });
    this.render();
  }

  public setTuning(tuning: string[]) {
    this.tuning = tuning;
    this.render();
  }

  public onFretInput(cb: (event: FretboardInputEvent) => void) {
    this.onFretInputCallbacks.push(cb);
  }

  private triggerFret(str: number, fret: number) {
    // str is 1-based from high E (1) down to low E (numStrings)
    const numStrings = this.tuning.length;
    const tuningIndex = numStrings - str; // index 0 in tuning is lowest string (E2)
    const openNote = this.tuning[tuningIndex];
    const midi = stringFretToMidi(openNote, fret);
    const noteName = midiToNote(midi);

    const step = noteName[0].toLowerCase() as any;
    const accidental = noteName.includes("#") ? "#" : undefined;
    const octave = parseInt(noteName.replace(/[^0-9-]/g, ""), 10);

    this.selectedPosition = { str, fret };
    this.audio.playNote(midi, 0.6);

    const event: FretboardInputEvent = {
      str,
      fret,
      midi,
      noteName,
      step,
      accidental,
      octave,
    };

    this.onFretInputCallbacks.forEach((cb) => cb(event));
    this.render();
  }

  public render() {
    this.containerEl.empty();

    // Top control bar
    const controls = this.containerEl.createDiv({ cls: "br-fretboard-controls" });
    controls.createSpan({ cls: "br-widget-title", text: "Guitar Fretboard" });

    const numStrings = this.tuning.length;
    const width = Math.max(this.containerEl.clientWidth || 750, 650);
    const height = 150;

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", `${width}`);
    svg.setAttribute("height", `${height}`);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.classList.add("br-fretboard-interactive-svg");

    const padLeft = 45;
    const padRight = 20;
    const padTop = 22;
    const padBottom = 22;

    const boardWidth = width - padLeft - padRight;
    const boardHeight = height - padTop - padBottom;
    const stringSpacing = boardHeight / (numStrings - 1);
    const fretSpacing = boardWidth / this.maxFret;

    // Inlays
    const singleDots = [3, 5, 7, 9, 15];
    const doubleDots = [12];
    for (let f = 1; f <= this.maxFret; f++) {
      const cx = padLeft + f * fretSpacing - fretSpacing / 2;
      if (singleDots.includes(f)) {
        const dot = document.createElementNS(svgNS, "circle");
        dot.setAttribute("cx", `${cx}`);
        dot.setAttribute("cy", `${padTop + boardHeight / 2}`);
        dot.setAttribute("r", "4");
        dot.classList.add("br-fretboard-inlay");
        svg.appendChild(dot);
      } else if (doubleDots.includes(f)) {
        const d1 = document.createElementNS(svgNS, "circle");
        d1.setAttribute("cx", `${cx}`);
        d1.setAttribute("cy", `${padTop + boardHeight * 0.25}`);
        d1.setAttribute("r", "4");
        d1.classList.add("br-fretboard-inlay");
        svg.appendChild(d1);

        const d2 = document.createElementNS(svgNS, "circle");
        d2.setAttribute("cx", `${cx}`);
        d2.setAttribute("cy", `${padTop + boardHeight * 0.75}`);
        d2.setAttribute("r", "4");
        d2.classList.add("br-fretboard-inlay");
        svg.appendChild(d2);
      }
    }

    // Fret lines
    for (let f = 0; f <= this.maxFret; f++) {
      const x = padLeft + f * fretSpacing;
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

      // Fret number
      if (f > 0) {
        const numText = document.createElementNS(svgNS, "text");
        numText.setAttribute("x", `${x - fretSpacing / 2}`);
        numText.setAttribute("y", `${padTop + boardHeight + 15}`);
        numText.setAttribute("text-anchor", "middle");
        numText.classList.add("br-fretboard-num");
        numText.textContent = `${f}`;
        svg.appendChild(numText);
      }
    }

    // Strings
    for (let s = 1; s <= numStrings; s++) {
      const displayIndex = s - 1; // 0 is top string (high E), 5 is bottom (low E)
      const y = padTop + displayIndex * stringSpacing;

      const sLine = document.createElementNS(svgNS, "line");
      sLine.setAttribute("x1", `${padLeft}`);
      sLine.setAttribute("y1", `${y}`);
      sLine.setAttribute("x2", `${padLeft + boardWidth}`);
      sLine.setAttribute("y2", `${y}`);
      sLine.setAttribute("stroke-width", `${1 + (numStrings - s) * 0.4}`);
      sLine.classList.add("br-fretboard-string");
      svg.appendChild(sLine);

      // Tuning label on left
      const tuningIndex = numStrings - s;
      const openNote = this.tuning[tuningIndex];
      const match = openNote.match(/^([A-G][#b]?)/);
      const label = match ? match[1] : openNote;

      const tText = document.createElementNS(svgNS, "text");
      tText.setAttribute("x", `${padLeft - 10}`);
      tText.setAttribute("y", `${y + 4}`);
      tText.setAttribute("text-anchor", "end");
      tText.classList.add("br-fretboard-tuning-label");
      tText.textContent = label;
      svg.appendChild(tText);

      // Clickable target zones for open string (fret 0) and frets 1 to maxFret
      for (let f = 0; f <= this.maxFret; f++) {
        const cx = f === 0 ? padLeft - 6 : padLeft + f * fretSpacing - fretSpacing / 2;
        const targetWidth = f === 0 ? 16 : fretSpacing;
        const targetX = f === 0 ? padLeft - 14 : padLeft + (f - 1) * fretSpacing;

        const isSelected =
          this.selectedPosition &&
          this.selectedPosition.str === s &&
          this.selectedPosition.fret === f;

        // Interactive hit zone
        const hitZone = document.createElementNS(svgNS, "rect");
        hitZone.setAttribute("x", `${targetX}`);
        hitZone.setAttribute("y", `${y - stringSpacing / 2}`);
        hitZone.setAttribute("width", `${targetWidth}`);
        hitZone.setAttribute("height", `${stringSpacing}`);
        hitZone.setAttribute("fill", "transparent");
        hitZone.style.cursor = "pointer";

        hitZone.addEventListener("click", () => {
          this.triggerFret(s, f);
        });
        svg.appendChild(hitZone);

        // Selected indicator
        if (isSelected) {
          const dot = document.createElementNS(svgNS, "circle");
          dot.setAttribute("cx", `${cx}`);
          dot.setAttribute("cy", `${y}`);
          dot.setAttribute("r", "7");
          dot.classList.add("br-fretboard-active-dot");
          svg.appendChild(dot);

          const dotText = document.createElementNS(svgNS, "text");
          dotText.setAttribute("x", `${cx}`);
          dotText.setAttribute("y", `${y + 3.5}`);
          dotText.setAttribute("text-anchor", "middle");
          dotText.classList.add("br-fretboard-active-text");
          dotText.textContent = `${f}`;
          svg.appendChild(dotText);
        }
      }
    }

    this.containerEl.appendChild(svg);
  }
}
