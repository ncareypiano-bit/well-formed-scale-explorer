import { buildScaleFromGenerator, preserveStepLabels, applyMode } from './scale.js?v=19';

const choices = (value, options, label) => {
  if (!options.includes(value)) throw new Error(`Invalid ${label} in scale data.`);
  return value;
};
const number = (value, min, max, label, integer = false) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`Invalid ${label} in scale data.`);
  }
  return value;
};

// Rebuild imported scales from mathematical inputs; never trust saved rows or frequencies.
export function restoreSession(saved) {
  if (!saved || saved.version !== 2 || !saved.model) throw new Error('Unsupported scale data version.');
  const m = saved.model;
  const cardinality = number(m.cardinality, 2, 60, 'cardinality', true);
  const period = number(m.period, 1 + Number.EPSILON, Number.MAX_VALUE, 'period');
  const generatorValue = number(m.generatorValue, Number.MIN_VALUE, Number.MAX_VALUE, 'generator');
  const baseFrequency = number(m.baseFrequency, 22, 1047, 'base frequency');
  let scale = buildScaleFromGenerator({ period, generatorMode: 'log', generatorInput: String(generatorValue), baseFrequency, cardinality });
  if (scale.rows.some(row => !Number.isFinite(row.frequency))) throw new Error('Scale data contains an out-of-range frequency.');
  const word = m.stepWord;
  if (typeof word !== 'string' || word.length !== cardinality || !/^[AB]+$/.test(word)) throw new Error('Invalid step labels in scale data.');
  const structuralWord = scale.rows.map((row, i, rows) => rows[(i + 1) % cardinality].fromGeneratorIndex > row.fromGeneratorIndex ? 'A' : 'B').join('');
  const inverse = structuralWord.replace(/[AB]/g, c => c === 'A' ? 'B' : 'A');
  if (word.includes('B')) {
    if (word !== structuralWord && word !== inverse) throw new Error('Step labels do not match the generated scale.');
    for (const letter of ['A', 'B']) {
      const expected = scale.stepPattern[word.indexOf(letter)];
      if (!Number.isFinite(expected) || scale.stepPattern.some((step, i) => word[i] === letter && Math.abs(step - expected) > 1e-8)) {
        throw new Error('Step labels do not match the generated scale.');
      }
    }
    scale = preserveStepLabels(scale, { ...scale, stepWord: word });
  } else if (!scale.summary.degenerate) {
    throw new Error('Scale data omits a step type.');
  }
  const mode = number(saved.mode, 0, cardinality - 1, 'mode', true);
  const cycle = number(saved.cycle, 1, cardinality - 1, 'cycle', true);
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  number(saved.coset, 0, gcd(cycle, cardinality) - 1, 'coset', true);
  choices(saved.modeOrder, ['step', 'generator'], 'mode order');
  choices(saved.buildMethod, ['step', 'generator'], 'build method');
  choices(saved.view, ['keyboard', 'circle'], 'view');
  choices(saved.labelMode, ['notes', 'hz', 'ratio', 'cents'], 'labels');
  choices(saved.timbre, ['piano', 'marimba', 'clarinet', 'flute', 'organ', 'plucked', 'sine'], 'timbre');
  choices(saved.generatorMode, ['generator', 'log'], 'generator input mode');
  // Older v2 files stored the legacy Duration setting rather than BPM.
  const tempo = saved.tempo === undefined
    ? 60 / Math.max(.12, number(saved.duration, .12, 1.2, 'duration') * .48)
    : number(saved.tempo, 30, 500, 'tempo');
  number(saved.volume, 0, 1, 'volume');
  if (typeof saved.name !== 'string' || /[\r\n]/.test(saved.name)) throw new Error('Invalid scale name in scale data.');
  const normalized = { ...saved, tempo, timbre: ({flute: 'clarinet', plucked: 'marimba'})[saved.timbre] ?? saved.timbre };
  delete normalized.duration;
  return { saved: JSON.parse(JSON.stringify(normalized)), scale: applyMode(scale, mode) };
}

export class EditHistory {
  constructor(limit = 100) { this.limit = limit; this.entries = []; this.index = -1; }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index + 1 < this.entries.length; }
  record(snapshot, { replace = false } = {}) {
    const entry = JSON.stringify(snapshot);
    if (this.entries[this.index] === entry) return false;
    if (replace && this.index > 0) {
      this.entries[this.index] = entry;
      // Returning to the pre-typing scale should not leave a no-op Undo step.
      if (this.entries[this.index - 1] === entry) {
        this.entries.splice(this.index, 1);
        this.index--;
      }
      return true;
    }
    this.entries.splice(this.index + 1);
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
    this.index = this.entries.length - 1;
    return true;
  }
  undo() { return this.canUndo ? JSON.parse(this.entries[--this.index]) : null; }
  redo() { return this.canRedo ? JSON.parse(this.entries[++this.index]) : null; }
}
