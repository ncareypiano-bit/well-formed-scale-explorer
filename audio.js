import { SAMPLE_BANKS } from './sample-bank.js?v=1';

export class AudioEngine {
  constructor({ fetcher = (...args) => fetch(...args) } = {}) {
    this.volume = .72;
    this.context = null;
    this.master = null;
    this.activeNotes = new Map();
    this.playbackTimers = [];
    this.playbackNodes = [];
    this.instruments = new Map();
    this.loading = new Map();
    this.fetcher = fetcher;
  }

  async resume() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
    }
    if (this.context.state !== 'running') await this.context.resume();
  }

  async ensureInstrument(timbre) {
    await this.resume();
    if (timbre === 'sine' || this.instruments.has(timbre)) return;
    if (!SAMPLE_BANKS[timbre]) throw new Error('Unknown instrument.');
    if (!this.loading.has(timbre)) {
      const promise = Promise.all(SAMPLE_BANKS[timbre].samples.map(async sample => {
        const response = await this.fetcher(new URL(sample.url, import.meta.url));
        if (!response.ok) throw new Error('Could not load instrument recordings. Please try again.');
        const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
        return { ...sample, buffer };
      })).then(samples => this.instruments.set(timbre, samples))
        .finally(() => this.loading.delete(timbre));
      this.loading.set(timbre, promise);
    }
    await this.loading.get(timbre);
  }

  setVolume(value) {
    this.volume = Math.min(1, Math.max(0, value));
    if (this.master) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, .02);
  }

  releaseVoice(voice, time, release = voice.release) {
    const param = voice.masterGain.gain;
    // Also cancels voices scheduled in the future when Stop is pressed.
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(time);
    else {
      param.cancelScheduledValues(time);
      param.setValueAtTime(Math.max(param.value, .0001), time);
    }
    param.exponentialRampToValueAtTime(.0001, time + release);
    for (const source of voice.oscillators) source.stop(time + release + .01);
  }

  stopAll() {
    this.playbackTimers.forEach(clearTimeout);
    this.playbackTimers = [];
    if (this.context) {
      for (const voice of this.playbackNodes) this.releaseVoice(voice, this.context.currentTime, .025);
    }
    this.playbackNodes = [];
    this.activeNotes.clear();
  }

  createVoice(noteId, frequencies, options, start, duration = null) {
    if (!this.context || !this.master) return;
    const timbre = options.timbre ?? 'organ';
    const bank = SAMPLE_BANKS[timbre];
    const samples = this.instruments.get(timbre);
    if (timbre !== 'sine' && !samples) throw new Error('Instrument is still loading.');
    const masterGain = this.context.createGain();
    const level = (timbre === 'sine' ? .12 : .85) / Math.max(1, Math.sqrt(frequencies.length));
    masterGain.gain.setValueAtTime(.0001, start);
    masterGain.gain.linearRampToValueAtTime(level, start + .005);
    masterGain.connect(this.master);
    const voice = { masterGain, oscillators: [], startTime: start, release: bank?.release ?? .025 };
    for (const frequency of frequencies) {
      if (!Number.isFinite(frequency) || frequency <= 0) continue;
      let source;
      if (timbre === 'sine') {
        source = this.context.createOscillator();
        source.type = 'sine';
        source.frequency.setValueAtTime(frequency, start);
      } else {
        const sample = samples.reduce((best, item) => Math.abs(Math.log2(frequency / item.rootHz)) < Math.abs(Math.log2(frequency / best.rootHz)) ? item : best);
        source = this.context.createBufferSource();
        source.buffer = sample.buffer;
        source.playbackRate.setValueAtTime(frequency / sample.rootHz, start);
        source.loop = bank.sustained;
        if (source.loop) { source.loopStart = sample.loopStart; source.loopEnd = sample.loopEnd; }
      }
      source.connect(masterGain);
      voice.oscillators.push(source);
    }
    if (!voice.oscillators.length) { masterGain.disconnect(); return; }
    this.playbackNodes.push(voice);
    let remaining = voice.oscillators.length;
    for (const source of voice.oscillators) {
      source.onended = () => {
        source.disconnect();
        if (--remaining === 0) {
          masterGain.disconnect();
          this.playbackNodes = this.playbackNodes.filter(item => item !== voice);
          if (this.activeNotes.get(noteId) === voice) this.activeNotes.delete(noteId);
        }
      };
      source.start(start);
    }
    if (duration !== null) {
      const end = start + Math.max(.01, duration);
      // Gate stays open to the next beat. Only the release overlaps the next note.
      masterGain.gain.setValueAtTime(level, end);
      masterGain.gain.exponentialRampToValueAtTime(.0001, end + voice.release);
      voice.oscillators.forEach(source => source.stop(end + voice.release + .01));
    }
    return voice;
  }

  playTransient(noteId, frequencies, options) {
    return this.createVoice(noteId, frequencies, options, this.context?.currentTime ?? 0, options.duration ?? .45);
  }

  playPlaybackTransient(noteId, frequencies, options) {
    return this.playTransient(noteId, frequencies, options);
  }

  startSustainedNote(noteId, frequencies, options) {
    this.stopSustainedNote(noteId);
    const voice = this.createVoice(noteId, frequencies, options, this.context?.currentTime ?? 0);
    if (voice) this.activeNotes.set(noteId, voice);
  }

  stopSustainedNote(noteId, { minimumDuration = 0 } = {}) {
    const voice = this.activeNotes.get(noteId);
    if (!voice) return;
    this.releaseVoice(voice, Math.max(this.context.currentTime, voice.startTime + minimumDuration));
    this.activeNotes.delete(noteId);
  }

  schedulePlayback(rows, options) {
    if (!this.context) return;
    this.stopAll();
    const interval = options.interval ?? .375;
    const start = this.context.currentTime + .03;
    rows.forEach((row, index) => {
      this.createVoice(`playback-${index}`, [row.frequency], options, start + interval * index, options.duration ?? interval);
      this.playbackTimers.push(setTimeout(() => options.onStep?.(row, index), (start - this.context.currentTime + interval * index) * 1000));
    });
  }
}
