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
    this.playbackNodes = [];
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
    if (this.context) {
      const now = this.context.currentTime;
      this.playbackNodes.forEach(({ masterGain, oscillators }) => {
        if (masterGain) {
          masterGain.gain.cancelScheduledValues(now);
          masterGain.gain.setValueAtTime(Math.max(masterGain.gain.value, 0.0001), now);
          masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
        }
        oscillators.forEach((oscillator) => {
          try {
            oscillator.stop(now + 0.04);
          } catch (_error) {
            // Ignore already-stopped nodes.
          }
        });
      });
    }
    this.playbackNodes = [];
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

  playPlaybackTransient(noteId, frequencies, options) {
    if (!this.context || !this.master) return;

    const timbreName = options.timbre ?? "organ";
    const timbre = TIMBRES[timbreName] ?? TIMBRES.organ;
    const startTime = this.context.currentTime;
    const noteDuration = Math.max(options.duration ?? 0.45, 0.08);
    const gainAmount = 0.16 / Math.max(1, Math.sqrt(frequencies.length));
    const attack = Math.min(0.025, noteDuration * 0.2);
    const decay = Math.min(0.09, Math.max(0.03, noteDuration * 0.2));
    const sustainLevel = 0.72;
    const holdRatio = timbreName === "plucked" ? 0.65 : 1;
    const releaseStart = Math.max(
      startTime + attack + decay,
      startTime + noteDuration * holdRatio
    );

    const masterGain = this.context.createGain();
    masterGain.gain.setValueAtTime(0.0001, startTime);
    masterGain.gain.linearRampToValueAtTime(1, startTime + attack);
    masterGain.gain.setValueAtTime(1, releaseStart);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, startTime + noteDuration);
    masterGain.connect(this.master);

    const oscillators = [];
    frequencies.forEach((frequency) => {
      timbre.forEach(([harmonic, amplitude]) => {
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency * harmonic;
        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.linearRampToValueAtTime(gainAmount * amplitude, startTime + attack);
        gain.gain.linearRampToValueAtTime(
          gainAmount * amplitude * sustainLevel,
          startTime + attack + decay
        );
        gain.gain.setValueAtTime(gainAmount * amplitude * sustainLevel, releaseStart);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + noteDuration);
        oscillator.connect(gain).connect(masterGain);
        oscillator.start(startTime);
        oscillator.stop(startTime + noteDuration + 0.03);
        oscillators.push(oscillator);
      });
    });

    this.playbackNodes.push({ masterGain, oscillators });
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
    const duration = options.duration ?? Math.max(interval * 1.4, 0.36);

    rows.forEach((row, index) => {
      const timer = setTimeout(() => {
        this.playPlaybackTransient(`playback-${index}`, [row.frequency], {
          ...options,
          duration,
        });
        options.onStep?.(row, index);
      }, interval * 1000 * index);
      this.playbackTimers.push(timer);
    });
  }
}
