/**
 * Interactive Virtual Piano Keyboard Widget (Soundslice / Dorico inspired)
 */
import { AudioSynthesizer } from "../audio/audioSynthesizer";
import { midiToNote } from "../parser/scales";

export interface PianoNoteEvent {
  midi: number;
  noteName: string;
  step: "c" | "d" | "e" | "f" | "g" | "a" | "b";
  accidental?: "#" | "b";
  octave: number;
}

export class PianoWidget {
  private containerEl: HTMLElement;
  private baseOctave: number = 4; // C4 is middle C
  private numOctaves: number = 2; // 2 octaves = 25 keys (C4 to C6)
  private onNoteInputCallbacks: ((event: PianoNoteEvent) => void)[] = [];
  private audio: AudioSynthesizer;

  constructor(parentEl: HTMLElement) {
    this.audio = AudioSynthesizer.getInstance();
    this.containerEl = parentEl.createDiv({ cls: "br-piano-widget-container" });
    this.render();
  }

  public onNoteInput(cb: (event: PianoNoteEvent) => void) {
    this.onNoteInputCallbacks.push(cb);
  }

  private triggerNote(midi: number) {
    const noteName = midiToNote(midi);
    const step = noteName[0].toLowerCase() as any;
    const accidental = noteName.includes("#") ? "#" : undefined;
    const octave = parseInt(noteName.replace(/[^0-9-]/g, ""), 10);

    this.audio.playNote(midi, 0.6);

    const event: PianoNoteEvent = {
      midi,
      noteName,
      step,
      accidental,
      octave,
    };

    this.onNoteInputCallbacks.forEach((cb) => cb(event));
  }

  public render() {
    this.containerEl.empty();

    // Top control bar
    const controls = this.containerEl.createDiv({ cls: "br-piano-controls" });
    const title = controls.createSpan({ cls: "br-widget-title", text: "Piano Keyboard" });

    const octGroup = controls.createDiv({ cls: "br-piano-octave-group" });
    const downBtn = octGroup.createEl("button", { cls: "br-piano-oct-btn", text: "◀ Octave" });
    downBtn.disabled = this.baseOctave <= 2;
    downBtn.addEventListener("click", () => {
      if (this.baseOctave > 2) {
        this.baseOctave--;
        this.render();
      }
    });

    octGroup.createSpan({ cls: "br-piano-oct-label", text: `C${this.baseOctave} - C${this.baseOctave + this.numOctaves}` });

    const upBtn = octGroup.createEl("button", { cls: "br-piano-oct-btn", text: "Octave ▶" });
    upBtn.disabled = this.baseOctave >= 6;
    upBtn.addEventListener("click", () => {
      if (this.baseOctave < 6) {
        this.baseOctave++;
        this.render();
      }
    });

    // Keyboard container
    const keyboardEl = this.containerEl.createDiv({ cls: "br-piano-keyboard" });

    const whiteKeysInOctave = [0, 2, 4, 5, 7, 9, 11]; // semitones: C, D, E, F, G, A, B
    const blackKeyMap: Record<number, number> = {
      0: 1, // C -> C#
      1: 3, // D -> D#
      3: 6, // F -> F#
      4: 8, // G -> G#
      5: 10, // A -> A#
    };

    let totalWhiteKeys = this.numOctaves * 7 + 1; // Ending on top C
    let whiteKeyIndex = 0;

    for (let oct = 0; oct < this.numOctaves; oct++) {
      const currentOctave = this.baseOctave + oct;
      const octaveBaseMidi = (currentOctave + 1) * 12;

      for (let w = 0; w < 7; w++) {
        const semitone = whiteKeysInOctave[w];
        const midi = octaveBaseMidi + semitone;
        const noteName = midiToNote(midi);

        const whiteKey = keyboardEl.createDiv({
          cls: "br-piano-key br-white-key",
          text: w === 0 ? `C${currentOctave}` : "",
        });
        whiteKey.title = noteName;
        whiteKey.addEventListener("click", (e) => {
          e.stopPropagation();
          this.triggerNote(midi);
          whiteKey.addClass("is-pressed");
          setTimeout(() => whiteKey.removeClass("is-pressed"), 180);
        });

        // If this white key has a black key to its right
        if (blackKeyMap[w] !== undefined) {
          const bSemitone = blackKeyMap[w];
          const bMidi = octaveBaseMidi + bSemitone;
          const bNoteName = midiToNote(bMidi);

          const blackKey = whiteKey.createDiv({
            cls: "br-piano-key br-black-key",
          });
          blackKey.title = bNoteName;
          blackKey.addEventListener("click", (e) => {
            e.stopPropagation();
            this.triggerNote(bMidi);
            blackKey.addClass("is-pressed");
            setTimeout(() => blackKey.removeClass("is-pressed"), 180);
          });
        }

        whiteKeyIndex++;
      }
    }

    // Final top C key
    const topMidi = (this.baseOctave + this.numOctaves + 1) * 12;
    const topC = keyboardEl.createDiv({
      cls: "br-piano-key br-white-key",
      text: `C${this.baseOctave + this.numOctaves}`,
    });
    topC.title = midiToNote(topMidi);
    topC.addEventListener("click", () => {
      this.triggerNote(topMidi);
      topC.addClass("is-pressed");
      setTimeout(() => topC.removeClass("is-pressed"), 180);
    });
  }
}
