/**
 * Note Entry Palette Component (Soundslice / Dorico / Sibelius inspired)
 */
import { DurationType } from "../types";

export interface NoteEntryState {
  duration: DurationType;
  isRest: boolean;
  dots: number;
  accidental: "#" | "b" | "n" | null;
  tied: boolean;
  articulation: "staccato" | "accent" | "tenuto" | null;
  technique: "h" | "p" | "b" | "s" | "v" | null;
}

export class NoteEntryPalette {
  private containerEl: HTMLElement;
  private state: NoteEntryState = {
    duration: "q",
    isRest: false,
    dots: 0,
    accidental: null,
    tied: false,
    articulation: null,
    technique: null,
  };
  private onChangeCallbacks: ((state: NoteEntryState) => void)[] = [];

  constructor(parentEl: HTMLElement) {
    this.containerEl = parentEl.createDiv({ cls: "br-entry-palette" });
    this.render();
  }

  public getState(): NoteEntryState {
    return { ...this.state };
  }

  public setState(partial: Partial<NoteEntryState>) {
    Object.assign(this.state, partial);
    this.render();
    this.notifyChange();
  }

  public onChange(cb: (state: NoteEntryState) => void) {
    this.onChangeCallbacks.push(cb);
  }

  private notifyChange() {
    this.onChangeCallbacks.forEach((cb) => cb(this.getState()));
  }

  public render() {
    this.containerEl.empty();

    // 1. Durations Group
    const durGroup = this.containerEl.createDiv({ cls: "br-palette-group" });
    durGroup.createSpan({ cls: "br-palette-label", text: "Duration" });

    const durations: { id: DurationType; label: string; glyph: string; shortcut: string }[] = [
      { id: "w", label: "Whole", glyph: "𝅝", shortcut: "1" },
      { id: "h", label: "Half", glyph: "𝅗𝅥", shortcut: "2" },
      { id: "q", label: "Quarter", glyph: "𝅘𝅥", shortcut: "3" },
      { id: "8", label: "8th", glyph: "𝅘𝅥𝅮", shortcut: "4" },
      { id: "16", label: "16th", glyph: "𝅘𝅥𝅯", shortcut: "5" },
      { id: "32", label: "32nd", glyph: "𝅘𝅥𝅰", shortcut: "6" },
    ];

    durations.forEach((d) => {
      const btn = durGroup.createEl("button", {
        cls: `br-palette-btn ${this.state.duration === d.id && !this.state.isRest ? "is-active" : ""}`,
        text: d.glyph,
      });
      btn.title = `${d.label} (${d.shortcut})`;
      btn.addEventListener("click", () => {
        this.setState({ duration: d.id });
      });
    });

    // 2. Modifiers Group (Rest, Dot, Tie)
    const modGroup = this.containerEl.createDiv({ cls: "br-palette-group" });
    modGroup.createSpan({ cls: "br-palette-label", text: "Modifiers" });

    // Rest toggle
    const restBtn = modGroup.createEl("button", {
      cls: `br-palette-btn ${this.state.isRest ? "is-active" : ""}`,
      text: "𝄽",
    });
    restBtn.title = "Rest toggle (R)";
    restBtn.addEventListener("click", () => {
      this.setState({ isRest: !this.state.isRest });
    });

    // Augmentation Dot
    const dotBtn = modGroup.createEl("button", {
      cls: `br-palette-btn ${this.state.dots > 0 ? "is-active" : ""}`,
      text: "•",
    });
    dotBtn.title = "Augmentation Dot (.)";
    dotBtn.addEventListener("click", () => {
      this.setState({ dots: this.state.dots > 0 ? 0 : 1 });
    });

    // Tie
    const tieBtn = modGroup.createEl("button", {
      cls: `br-palette-btn ${this.state.tied ? "is-active" : ""}`,
      text: "⁀",
    });
    tieBtn.title = "Tie (T)";
    tieBtn.addEventListener("click", () => {
      this.setState({ tied: !this.state.tied });
    });

    // 3. Accidentals Group
    const accGroup = this.containerEl.createDiv({ cls: "br-palette-group" });
    accGroup.createSpan({ cls: "br-palette-label", text: "Pitch" });

    const accidentals: { id: "#" | "b" | "n" | null; label: string; glyph: string }[] = [
      { id: "#", label: "Sharp (#)", glyph: "♯" },
      { id: "b", label: "Flat (b)", glyph: "♭" },
      { id: "n", label: "Natural (n)", glyph: "♮" },
    ];

    accidentals.forEach((acc) => {
      const btn = accGroup.createEl("button", {
        cls: `br-palette-btn ${this.state.accidental === acc.id ? "is-active" : ""}`,
        text: acc.glyph,
      });
      btn.title = acc.label;
      btn.addEventListener("click", () => {
        this.setState({ accidental: this.state.accidental === acc.id ? null : acc.id });
      });
    });

    // 4. Guitar Techniques Group
    const techGroup = this.containerEl.createDiv({ cls: "br-palette-group" });
    techGroup.createSpan({ cls: "br-palette-label", text: "Guitar" });

    const techniques: { id: "h" | "p" | "b" | "s" | "v" | null; label: string; glyph: string }[] = [
      { id: "h", label: "Hammer-on", glyph: "H" },
      { id: "p", label: "Pull-off", glyph: "P" },
      { id: "b", label: "Bend", glyph: "B" },
      { id: "s", label: "Slide", glyph: "/" },
      { id: "v", label: "Vibrato", glyph: "~" },
    ];

    techniques.forEach((tech) => {
      const btn = techGroup.createEl("button", {
        cls: `br-palette-btn ${this.state.technique === tech.id ? "is-active" : ""}`,
        text: tech.glyph,
      });
      btn.title = tech.label;
      btn.addEventListener("click", () => {
        this.setState({ technique: this.state.technique === tech.id ? null : tech.id });
      });
    });
  }
}
