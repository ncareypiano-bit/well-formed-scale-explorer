const TIMBRES = {
  organ: [
    [1, 0.78],
    [2, 0.28],
    [3, 0.16],
    [4, 0.08],
    [5, 0.04],
  ],
  sine: [[1, 1]],
  clarinet: [
    [1, 0.82],
    [3, 0.38],
    [5, 0.18],
    [7, 0.08],
  ],
  flute: [
    [1, 0.92],
    [2, 0.1],
    [3, 0.04],
  ],
  plucked: [
    [1, 0.9],
    [2, 0.26],
    [3, 0.14],
    [4, 0.07],
  ],
};

export class AudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.activeNotes = new Map();
    this.playbackTimers = [];
  }

  async resume() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.72;
      this.master.connect(this.context.destination);
    }

    if (this.context.state !== "running") {
      await this.context.resume();
    }
  }

  stopAll() {
    this.playbackTimers.forEach((timer) => clearTimeout(timer));
    this.playbackTimers = [];
    for (const noteId of [...this.activeNotes.keys()]) {
      this.stopSustainedNote(noteId);
    }
  }

  playTransient(noteId, frequencies, options) {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const duration = options.duration ?? 0.45;
    const timbre = TIMBRES[options.timbre] ?? TIMBRES.organ;
    const gainAmount = 0.18 / Math.max(1, Math.sqrt(frequencies.length));

    frequencies.forEach((frequency) => {
      timbre.forEach(([harmonic, amplitude]) => {
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency * harmonic;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(gainAmount * amplitude, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        oscillator.connect(gain).connect(this.master);
        oscillator.start(now);
        oscillator.stop(now + duration + 0.03);
      });
    });
  }

  startSustainedNote(noteId, frequencies, options) {
    this.stopSustainedNote(noteId);
    if (!this.context || !this.master) return;

    const timbre = TIMBRES[options.timbre] ?? TIMBRES.organ;
    const now = this.context.currentTime;
    const masterGain = this.context.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.linearRampToValueAtTime(0.18 / Math.max(1, Math.sqrt(frequencies.length)), now + 0.02);
    masterGain.connect(this.master);

    const oscillators = [];
    frequencies.forEach((frequency) => {
      timbre.forEach(([harmonic, amplitude]) => {
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency * harmonic;
        gain.gain.value = amplitude;
        oscillator.connect(gain).connect(masterGain);
        oscillator.start(now);
        oscillators.push(oscillator);
      });
    });

    this.activeNotes.set(noteId, { masterGain, oscillators });
  }

  stopSustainedNote(noteId) {
    if (!this.context) return;
    const current = this.activeNotes.get(noteId);
    if (!current) return;

    const now = this.context.currentTime;
    current.masterGain.gain.cancelScheduledValues(now);
    current.masterGain.gain.setValueAtTime(Math.max(current.masterGain.gain.value, 0.0001), now);
    current.masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    current.oscillators.forEach((oscillator) => oscillator.stop(now + 0.09));
    this.activeNotes.delete(noteId);
  }

  schedulePlayback(rows, options) {
    if (!this.context) return;
    this.stopAll();

    const interval = options.interval ?? 0.24;
    rows.forEach((row, index) => {
      const timer = setTimeout(() => {
        this.playTransient(`playback-${index}`, [row.frequency], options);
        options.onStep?.(row, index);
      }, interval * 1000 * index);
      this.playbackTimers.push(timer);
    });
  }
}
