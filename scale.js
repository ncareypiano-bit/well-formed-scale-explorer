const EPSILON = 1e-10;
const BASE_FREQUENCY_MIN = 22;
const BASE_FREQUENCY_MAX = 1047;

export const KEYBOARD_KEYS = "zxcvbnm,./asdfghjkl;'qwertyuiop[]".split("");
export const MODE_ORDERS = {
  step: "step",
  generator: "generator",
};

export function evaluateExpression(raw) {
  const expression = String(raw).trim();
  if (!expression) {
    throw new Error("Enter a value.");
  }

  let normalized = expression
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/\^/g, "**")
    .replace(/\bpi\b/gi, "Math.PI")
    .replace(/\be\b/g, "Math.E")
    .replace(/\bgoldenratio\b/gi, "((1 + __WFSI_SQRT__(5)) / 2)")
    .replace(/\bsqrt\b/gi, "__WFSI_SQRT__")
    .replace(/\bln\b/gi, "__WFSI_LOG__")
    .replace(/\blog\b/gi, "__WFSI_LOG__")
    .replace(/\bexp\b/gi, "__WFSI_EXP__")
    .replace(/\bsin\b/gi, "__WFSI_SIN__")
    .replace(/\bcos\b/gi, "__WFSI_COS__");

  normalized = normalized
    .replace(/__WFSI_SQRT__/g, "Math.sqrt")
    .replace(/__WFSI_LOG__/g, "Math.log")
    .replace(/__WFSI_EXP__/g, "Math.exp")
    .replace(/__WFSI_SIN__/g, "Math.sin")
    .replace(/__WFSI_COS__/g, "Math.cos");

  // eslint-disable-next-line no-new-func
  const value = Function(`"use strict"; return (${normalized});`)();
  if (!Number.isFinite(value)) {
    throw new Error(`Could not evaluate "${raw}".`);
  }
  return value;
}

export function centsFromPeriodValue(x, period) {
  return 1200 * x * Math.log2(period);
}

function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function frequencyToMidi(frequency) {
  return 69 + 12 * Math.log2(frequency / 440);
}

export function parseBaseFrequencyInput(raw) {
  const expression = String(raw).trim();
  const noteMatch = expression.match(/^([A-Ga-g])([#b]?)(-?\d+)$/);

  let frequency;
  if (noteMatch) {
    const [, letterRaw, accidental, octaveRaw] = noteMatch;
    const octave = Number(octaveRaw);
    const semitones = {
      C: 0,
      D: 2,
      E: 4,
      F: 5,
      G: 7,
      A: 9,
      B: 11,
    };
    const letter = letterRaw.toUpperCase();
    const accidentalOffset = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
    const midi = (octave + 1) * 12 + semitones[letter] + accidentalOffset;
    frequency = midiToFrequency(midi);
  } else {
    frequency = evaluateExpression(expression);
  }

  if (!(frequency >= BASE_FREQUENCY_MIN && frequency <= BASE_FREQUENCY_MAX)) {
    throw new Error(`Base frequency must be between ${BASE_FREQUENCY_MIN} and ${BASE_FREQUENCY_MAX} Hz.`);
  }

  return frequency;
}

export function formatBaseFrequencyInput(frequency) {
  const midi = Math.round(frequencyToMidi(frequency));
  const exactFrequency = midiToFrequency(midi);
  if (Math.abs(exactFrequency - frequency) < 1e-6) {
    const names = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
    const octave = Math.floor(midi / 12) - 1;
    return `${names[((midi % 12) + 12) % 12]}${octave}`;
  }
  if (Math.abs(frequency - Math.round(frequency)) < 1e-9) {
    return String(Math.round(frequency));
  }
  return editableNumber(frequency, 12);
}

export function displayNumber(value, digits = 3) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  if (Math.abs(value - Math.round(value)) < 1e-9) {
    return String(Math.round(value));
  }
  return value.toFixed(digits);
}

export function editableNumber(value, digits = 12) {
  if (!Number.isFinite(value)) {
    return "";
  }
  if (Math.abs(value - Math.round(value)) < 1e-12) {
    return String(Math.round(value));
  }
  return Number(value.toPrecision(digits)).toString();
}

function mod1(value) {
  return ((value % 1) + 1) % 1;
}

function gcd(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

function continuedFractionTerms(value, maxTerms = 15) {
  const terms = [];
  let current = value;

  for (let index = 0; index < maxTerms; index += 1) {
    const integerPart = Math.floor(current + EPSILON);
    terms.push(integerPart);
    const fraction = current - integerPart;
    if (Math.abs(fraction) < 1e-12) break;
    current = 1 / fraction;
    if (!Number.isFinite(current)) break;
  }

  return terms;
}

function continuedFractionApproximants(value, maxTerms = 15, maxDenominator = 60) {
  const terms = continuedFractionTerms(value, maxTerms);
  const approximants = [];
  let prev2Num = 0;
  let prev2Den = 1;
  let prev1Num = 1;
  let prev1Den = 0;

  terms.forEach((term, index) => {
    const numerator = term * prev1Num + prev2Num;
    const denominator = term * prev1Den + prev2Den;
    approximants.push({
      numerator,
      denominator,
      type: "convergent",
      value: numerator / denominator,
    });

    if (index >= 1 && term >= 2) {
      for (let semi = 1; semi < term; semi += 1) {
        const semiNum = semi * prev1Num + prev2Num;
        const semiDen = semi * prev1Den + prev2Den;
        if (!Number.isFinite(semiDen) || semiDen > maxDenominator) {
          break;
        }
        approximants.push({
          numerator: semiNum,
          denominator: semiDen,
          type: "semiconvergent",
          value: semiNum / semiDen,
        });
      }
    }

    prev2Num = prev1Num;
    prev2Den = prev1Den;
    prev1Num = numerator;
    prev1Den = denominator;
  });

  return approximants
    .filter((item) => Number.isInteger(item.denominator) && item.denominator > 1 && item.denominator <= maxDenominator)
    .sort((left, right) => left.denominator - right.denominator || left.value - right.value);
}

export function availableCardinalitiesFromGeneratorValue(generatorValue, maxTerms = 15, maxDenominator = 60) {
  return [...new Set(
    continuedFractionApproximants(generatorValue, maxTerms, maxDenominator).map((item) => item.denominator)
  )];
}

export function parseGeneratorConfiguration({
  period,
  generatorMode,
  generatorInput,
  baseFrequency,
}) {
  if (!(period > 1)) {
    throw new Error("Period must be greater than 1.");
  }
  if (!(baseFrequency > 0)) {
    throw new Error("Base frequency must be positive.");
  }

  const parsedGeneratorInput = evaluateExpression(generatorInput);
  const generatorValue =
    generatorMode === "log"
      ? parsedGeneratorInput
      : Math.log(parsedGeneratorInput) / Math.log(period);

  if (!(generatorValue > 0) || Math.abs(generatorValue - 1) < EPSILON) {
    throw new Error("Generator input is not valid for the chosen period.");
  }

  const generator =
    generatorMode === "log"
      ? period ** generatorValue
      : parsedGeneratorInput;

  return {
    period,
    generator,
    generatorValue,
    baseFrequency,
    availableCardinalities: availableCardinalitiesFromGeneratorValue(generatorValue),
  };
}

function stepWordFromSteps(steps) {
  const max = Math.max(...steps);
  return steps
    .map((step) => (Math.abs(step - max) < EPSILON ? "A" : "B"))
    .join("");
}

function stepSummary(steps) {
  const distinct = [...steps].sort((a, b) => b - a).filter((value, index, array) => {
    if (index === 0) return true;
    return Math.abs(value - array[index - 1]) > EPSILON;
  });

  if (distinct.length <= 1) {
    return {
      degenerate: true,
      typeASize: distinct[0] ?? steps[0] ?? 0,
      typeBSize: null,
      typeACount: steps.length,
      typeBCount: 0,
      ratio: null,
      word: "A".repeat(steps.length),
    };
  }

  const [typeA, typeB] = distinct;
  const word = stepWordFromSteps(steps);
  const typeACount = [...word].filter((char) => char === "A").length;
  const typeBCount = word.length - typeACount;

  return {
    degenerate: false,
    typeASize: typeA,
    typeBSize: typeB,
    typeACount,
    typeBCount,
    ratio: centsFromPeriodValue(typeA, 2) / centsFromPeriodValue(typeB, 2),
    word,
  };
}

function rowsFromPitchClasses({ pitchClasses, fromGeneratorIndices, period, baseFrequency }) {
  return pitchClasses.map((pitchClass, index) => ({
    scaleDegree: index,
    fromGeneratorIndex: fromGeneratorIndices[index],
    pitchClass,
    cents: centsFromPeriodValue(pitchClass, period),
    frequency: baseFrequency * period ** pitchClass,
  }));
}

function cumulativePitchClasses(stepPattern) {
  const pitchClasses = [0];
  for (let index = 1; index < stepPattern.length; index += 1) {
    pitchClasses.push(pitchClasses[index - 1] + stepPattern[index - 1]);
  }
  return pitchClasses.map((value) => mod1(value));
}

export function buildScaleFromGenerator({
  period,
  generatorMode,
  generatorInput,
  baseFrequency,
  cardinality,
}) {
  const parsed = parseGeneratorConfiguration({
    period,
    generatorMode,
    generatorInput,
    baseFrequency,
  });
  const { generator, generatorValue, availableCardinalities } = parsed;

  if (!(cardinality > 1)) {
    throw new Error("Cardinality must be greater than 1.");
  }
  if (!availableCardinalities.includes(cardinality)) {
    throw new Error("Cardinality must come from the continued-fraction hierarchy.");
  }

  const rawPairs = Array.from({ length: cardinality }, (_, index) => ({
    fromGeneratorIndex: index,
    pitchClass: mod1(index * generatorValue),
  }));

  const sorted = [...rawPairs].sort((a, b) => a.pitchClass - b.pitchClass);
  const pitchClasses = sorted.map((row) => row.pitchClass);
  const frequencies = pitchClasses.map((pitchClass) => baseFrequency * period ** pitchClass);
  const steps = pitchClasses.map((pitchClass, index) => {
    const next = index === pitchClasses.length - 1 ? pitchClasses[0] + 1 : pitchClasses[index + 1];
    return next - pitchClass;
  });

  const rows = sorted.map((row, index) => ({
    scaleDegree: index,
    fromGeneratorIndex: row.fromGeneratorIndex,
    pitchClass: row.pitchClass,
    cents: centsFromPeriodValue(row.pitchClass, period),
    frequency: frequencies[index],
  }));

  return {
    period,
    generator,
    generatorValue,
    baseFrequency,
    cardinality,
    availableCardinalities,
    stepPattern: steps,
    stepWord: stepWordFromSteps(steps),
    rows,
    summary: stepSummary(steps),
  };
}

export function buildScaleFromStepStructure({
  period,
  baseFrequency,
  cardinality,
  typeACount,
  inputMode,
  ratioA,
  ratioB,
  typeASize,
}) {
  if (!(period > 1)) {
    throw new Error("Period must be greater than 1.");
  }
  if (!(baseFrequency > 0)) {
    throw new Error("Base frequency must be positive.");
  }
  if (!Number.isInteger(cardinality) || cardinality <= 1) {
    throw new Error("Cardinality must be an integer greater than 1.");
  }
  if (!Number.isInteger(typeACount) || typeACount < 0 || typeACount > cardinality) {
    throw new Error("Type A count must be an integer between 0 and N.");
  }

  const typeBCount = cardinality - typeACount;
  const degenerate = typeACount === 0 || typeBCount === 0;

  if (!degenerate && gcd(typeBCount, cardinality) !== 1) {
    throw new Error("Type A count must define a generated well-formed scale for this N.");
  }

  let stepA = 1 / cardinality;
  let stepB = degenerate ? null : 1 / cardinality;

  if (!degenerate) {
    if (inputMode === "size") {
      stepA = evaluateExpression(typeASize);
      if (!(stepA > 0)) {
        throw new Error("Type A size must be positive.");
      }
      stepB = (1 - typeACount * stepA) / typeBCount;
      if (!(stepB > 0)) {
        throw new Error("Type A size is too large for the chosen cardinality and count.");
      }
    } else {
      const parsedRatioA = evaluateExpression(ratioA);
      const parsedRatioB = evaluateExpression(ratioB);
      if (!(parsedRatioA > 0) || !(parsedRatioB > 0)) {
        throw new Error("Step ratios must be positive.");
      }
      const total = typeACount * parsedRatioA + typeBCount * parsedRatioB;
      stepA = parsedRatioA / total;
      stepB = parsedRatioB / total;
    }
  }

  const fromGeneratorIndices = degenerate
    ? Array.from({ length: cardinality }, (_, index) => index)
    : Array.from({ length: cardinality }, (_, index) => (typeBCount * index) % cardinality);

  const stepPattern = degenerate
    ? Array(cardinality).fill(1 / cardinality)
    : fromGeneratorIndices.map((current, index, array) => {
        const next = array[(index + 1) % array.length];
        return next > current ? stepA : stepB;
      });

  const pitchClasses = cumulativePitchClasses(stepPattern);
  const rows = rowsFromPitchClasses({
    pitchClasses,
    fromGeneratorIndices,
    period,
    baseFrequency,
  });

  const generatorRow = rows.find((row) => row.fromGeneratorIndex === 1) ?? rows[1] ?? rows[0];
  const generatorValue = generatorRow.pitchClass;
  const generator = period ** generatorValue;
  const availableCardinalities = [...new Set(
    availableCardinalitiesFromGeneratorValue(generatorValue).concat(cardinality)
  )].sort((left, right) => left - right);

  return {
    period,
    generator,
    generatorValue,
    baseFrequency,
    cardinality,
    availableCardinalities,
    stepPattern,
    stepWord: stepWordFromSteps(stepPattern),
    rows,
    summary: stepSummary(stepPattern),
  };
}

export function applyMode(scale, mode) {
  if (mode === null) {
    return {
      ...scale,
      mode: null,
      displayRows: scale.rows,
      playbackRows: scale.rows,
      displayStepWord: scale.stepWord,
    };
  }

  const start = ((mode % scale.cardinality) + scale.cardinality) % scale.cardinality;
  const doubled = scale.rows.concat(
    scale.rows.map((row) => ({
      ...row,
      scaleDegree: row.scaleDegree + scale.cardinality,
      pitchClass: row.pitchClass + 1,
      cents: centsFromPeriodValue(row.pitchClass + 1, scale.period),
      frequency: scale.baseFrequency * scale.period ** (row.pitchClass + 1),
    }))
  );

  const windowRows = doubled.slice(start, start + scale.cardinality + 1).map((row, index) => ({
    ...row,
    scaleDegree: index,
  }));

  const displaySteps = windowRows.slice(0, -1).map((row, index) => {
    const next = windowRows[index + 1];
    return next.pitchClass - row.pitchClass;
  });

  return {
    ...scale,
    mode: start,
    displayRows: windowRows,
    playbackRows: windowRows,
    displayStepWord: stepWordFromSteps(displaySteps),
  };
}

export function playbackRowsForMode(scale, playbackMode) {
  const rows = [...scale.playbackRows];

  switch (playbackMode) {
    case "up":
      return rows;
    case "down":
      return [...rows].reverse();
    case "updown":
      return rows.concat(rows.slice(0, -1).reverse());
    case "generator": {
      const tonicIndex = rows[0]?.fromGeneratorIndex ?? 0;
      const core = rows.slice(0, -1).sort((a, b) => {
        const aDistance = ((a.fromGeneratorIndex - tonicIndex) % scale.cardinality + scale.cardinality) % scale.cardinality;
        const bDistance = ((b.fromGeneratorIndex - tonicIndex) % scale.cardinality + scale.cardinality) % scale.cardinality;
        return aDistance - bDistance;
      });
      return core.concat(rows[rows.length - 1]);
    }
    default:
      return rows;
  }
}

function keyboardRows(scale) {
  const start = scale.mode === null ? 0 : scale.mode;
  const rowCount = scale.cardinality * 2 + 1;
  return Array.from({ length: rowCount }, (_, index) => {
    const sourceIndex = (start + index) % scale.cardinality;
    const periodOffset = Math.floor((start + index) / scale.cardinality);
    const source = scale.rows[sourceIndex];
    const pitchClass = source.pitchClass + periodOffset;
    return {
      ...source,
      scaleDegree: index,
      pitchClass,
      cents: centsFromPeriodValue(pitchClass, scale.period),
      frequency: scale.baseFrequency * scale.period ** pitchClass,
    };
  });
}

function keyboardStepWord(scale, length) {
  const source = scale.mode === null ? scale.stepWord : (scale.displayStepWord || scale.stepWord || "");
  if (!source) return "";
  return Array.from({ length }, (_, index) => source[index % source.length]).join("");
}

export function keyboardItems(scale) {
  const rows = keyboardRows(scale);
  const stepWord = keyboardStepWord(scale, Math.max(0, rows.length - 1));
  const whiteKeys = rows.map((row, index) => ({
    id: `white-${index}`,
    role: "scale",
    displayDegree: index % scale.cardinality,
    pitchClass: row.pitchClass,
    frequency: row.frequency,
    displayFrequency: row.frequency,
    highlighted: true,
  }));

  const summary = scale.summary;
  const blackKeys = [];
  if (!summary.degenerate && summary.typeBSize !== null) {
    const firstStep = stepWord[0] ?? "A";
    const colorStep = summary.typeASize - summary.typeBSize;
    const lowerOffset = firstStep === "A" ? colorStep : summary.typeBSize;
    const chars = stepWord.split("");

    chars.forEach((char, index) => {
      const lower = rows[index];
      const upper = rows[index + 1];
      if (char !== "A" || !lower || !upper) return;

      const pitchClass = lower.pitchClass + lowerOffset;
      blackKeys.push({
        id: `black-${index}`,
        role: "color",
        displayDegree: null,
        pitchClass,
        frequency: scale.baseFrequency * scale.period ** pitchClass,
        displayFrequency: scale.baseFrequency * scale.period ** pitchClass,
        highlighted: false,
        gapIndex: index,
        x: index + 1 - 0.24,
        width: 0.48,
      });
    });
  }

  return {
    whiteKeys,
    blackKeys,
    patternGaps: stepWord.split("").map((letter, index) => ({
      letter,
      gapIndex: index,
      hasColorKey: letter === "A",
    })),
  };
}

export function orderedModes(scale, modeOrder = MODE_ORDERS.step) {
  if (modeOrder === MODE_ORDERS.generator) {
    return [...scale.rows]
      .sort((left, right) => left.fromGeneratorIndex - right.fromGeneratorIndex)
      .map((row) => row.scaleDegree);
  }
  return Array.from({ length: scale.cardinality }, (_, index) => index);
}

export function keyboardLegend(scale) {
  return KEYBOARD_KEYS.slice(0, keyboardItems(scale).whiteKeys.length).join(" ");
}

export function keyboardLabel(key, scale, labelMode) {
  if (key.role === "color") {
    return "";
  }

  const tonic = scale.displayRows[0];
  switch (labelMode) {
    case "notes":
      return String(key.displayDegree);
    case "hz":
      return displayNumber(key.displayFrequency);
    case "ratio":
      return displayNumber(key.displayFrequency / tonic.frequency);
    case "cents":
      return displayNumber(centsFromPeriodValue(key.pitchClass - tonic.pitchClass, scale.period));
    default:
      return "";
  }
}

export function infoValues(scale) {
  const summary = scale.summary;
  const pCents = centsFromPeriodValue(1, scale.period);
  const generatorCents = centsFromPeriodValue(scale.generatorValue, scale.period);
  const aCents = centsFromPeriodValue(summary.typeASize, scale.period);
  const bCents = summary.typeBSize === null ? null : centsFromPeriodValue(summary.typeBSize, scale.period);
  return [
    { label: "p", value: `${displayNumber(pCents)}¢` },
    { label: "log_p(g)", value: `${displayNumber(generatorCents)}¢` },
    { label: "A", value: `${displayNumber(aCents)}¢` },
    { label: "B", value: bCents === null ? "-" : `${displayNumber(bCents)}¢` },
    { label: "A/B", value: summary.ratio === null ? "-" : displayNumber(summary.ratio) },
  ];
}

export function scaleStructureValues(scale) {
  const summary = scale.summary;
  const rows = [
    { label: "Cardinality", value: String(scale.cardinality) },
  ];

  if (summary.degenerate) {
    rows.push(
      { label: "Single step count", value: String(scale.cardinality) },
      { label: "Single step size", value: `${displayNumber(centsFromPeriodValue(summary.typeASize, scale.period))}¢` }
    );
  } else {
    rows.push(
      { label: "Type A count", value: String(summary.typeACount) },
      { label: "Type B count", value: String(summary.typeBCount) },
      { label: "Type A size", value: `${displayNumber(centsFromPeriodValue(summary.typeASize, scale.period))}¢` },
      { label: "Type B size", value: `${displayNumber(centsFromPeriodValue(summary.typeBSize, scale.period))}¢` }
    );
  }

  rows.push(
    { label: "Period", value: displayNumber(scale.period, 6) },
    { label: "Generator", value: displayNumber(scale.generator, 6) }
  );

  return rows;
}

export function analysisPanelData(scale) {
  const summary = scale.summary;
  const pCents = centsFromPeriodValue(1, scale.period);
  const generatorCents = centsFromPeriodValue(scale.generatorValue, scale.period);
  const aCents = centsFromPeriodValue(summary.typeASize, scale.period);
  const bCents = summary.typeBSize === null ? null : centsFromPeriodValue(summary.typeBSize, scale.period);
  const aRatio = scale.period ** summary.typeASize;
  const bRatio = summary.typeBSize === null ? null : scale.period ** summary.typeBSize;

  return {
    cardinalities: [
      { label: "N", value: String(scale.cardinality) },
      { label: "#A", value: String(summary.typeACount) },
      { label: "#B", value: String(summary.typeBCount) },
      {
        label: "A/B",
        value: summary.ratio === null ? "-" : displayNumber(summary.ratio, 6),
        note: "Log freq ratio",
      },
    ],
    values: [
      { label: "p", raw: displayNumber(scale.period, 6), cents: displayNumber(pCents) },
      { label: "g", raw: displayNumber(scale.generator, 6), cents: displayNumber(generatorCents) },
      { label: "A", raw: displayNumber(aRatio, 6), cents: displayNumber(aCents) },
      {
        label: "B",
        raw: bRatio === null ? "-" : displayNumber(bRatio, 6),
        cents: bCents === null ? "-" : displayNumber(bCents),
      },
    ],
  };
}
