/**
 * Web Audio Synthesizer for Note Auditioning and Playback
 */
import { midiToFreq } from "../parser/scales";

export class AudioSynthesizer {
  private static instance: AudioSynthesizer;
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;

  private constructor() {}

  public static getInstance(): AudioSynthesizer {
    if (!AudioSynthesizer.instance) {
      AudioSynthesizer.instance = new AudioSynthesizer();
    }
    return AudioSynthesizer.instance;
  }

  private initContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /** Set muted state */
  public setMuted(muted: boolean): void {
    this.isMuted = muted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  /** Play a single MIDI note */
  public playNote(midi: number, durationSeconds: number = 0.5, velocity: number = 0.8): void {
    if (this.isMuted) return;
    try {
      const ctx = this.initContext();
      const freq = midiToFreq(midi);
      const now = ctx.currentTime;

      // Master gain for this note
      const gainNode = ctx.createGain();
      gainNode.connect(ctx.destination);

      // Acoustic envelope: quick attack, natural exponential decay
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(velocity * 0.2, now + 0.015);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);

      // Fundamental oscillator (triangle for warm body)
      const osc1 = ctx.createOscillator();
      osc1.type = "triangle";
      osc1.frequency.setValueAtTime(freq, now);
      osc1.connect(gainNode);

      // 1st Harmonic oscillator (sine for chime/sparkle)
      const osc2 = ctx.createOscillator();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(freq * 2, now);
      const osc2Gain = ctx.createGain();
      osc2Gain.gain.setValueAtTime(0.3, now);
      osc2.connect(osc2Gain);
      osc2Gain.connect(gainNode);

      osc1.start(now);
      osc2.start(now);

      osc1.stop(now + durationSeconds);
      osc2.stop(now + durationSeconds);
    } catch (e) {
      // AudioContext might fail before user interaction
    }
  }

  /** Play multiple MIDI notes (chord) */
  public playChord(midiNotes: number[], durationSeconds: number = 1.0, arpeggiated: boolean = false): void {
    if (this.isMuted || midiNotes.length === 0) return;
    midiNotes.forEach((midi, idx) => {
      const delay = arpeggiated ? idx * 0.035 : 0;
      setTimeout(() => {
        this.playNote(midi, durationSeconds, 0.7);
      }, delay * 1000);
    });
  }
}
