import {
  KEYBOARD_KEYS,
  analysisPanelData,
  applyMode,
  buildScaleFromGenerator,
  buildScaleFromStepStructure,
  circleRows,
  cycleIntervalLetter,
  displayNumber,
  editableNumber,
  evaluateExpression,
  formatBaseFrequencyInput,
  generatorDeformationInfo,
  keyboardItems,
  keyboardLabel,
  MODE_ORDERS,
  orderedModes,
  parseGeneratorConfiguration,
  parseBaseFrequencyInput,
  preserveStepLabels,
} from "./scale.js?v=19";
import { AudioEngine } from "./audio.js?v=6";
import { EditHistory, restoreSession } from "./session.js?v=3";

const CIRCLE_DRAG_THRESHOLD_PX = 8;
const CIRCLE_DEFORMATION_EPSILON = 1e-12;
const CIRCLE_DRAG_GAIN = 0.45;
const CIRCLE_COLLAPSE_DISTANCE_PX = 0.5;

const state = {
  buildMethod: "generator",
  activeBuildMethod: "generator",
  explorerView: "keyboard",
  periodInput: "2",
  generatorMode: "generator",
  generatorInput: "3/2",
  baseFrequencyInput: "174.6141157165",
  cardinality: 7,
  mode: 0,
  modeOrder: MODE_ORDERS.step,
  labelMode: "notes",
  timbre: "organ",
  tempo: 160,
  scale: null,
  cycleStepTouched: false,
  activeKeyboardKeys: new Map(),
  activePitchClasses: new Set(),
  activeDisplayDegrees: new Set(),
  activeCycleSegment: null,
  circleDeformation: {
    previewGeneratorValue: null,
    dragSession: null,
  },
};

const audio = new AudioEngine();
const history = new EditHistory();
let appliedInputs = null;
let automaticEditField = null;
let audioEpoch = 0;
const uiTimers = new Set();
const pointerNotes = new Map();
const ringingPointerNotes = new Set();

const els = {
  undo: document.querySelector("#undo-edit"),
  redo: document.querySelector("#redo-edit"),
  pendingLine: document.querySelector("#pending-line"),
  volume: document.querySelector("#volume-slider"),
  buildGenerator: document.querySelector("#build-generator"),
  buildStep: document.querySelector("#build-step"),
  viewKeyboard: document.querySelector("#view-keyboard"),
  viewCircle: document.querySelector("#view-circle"),
  generatorBuildPanel: document.querySelector("#generator-build-panel"),
  stepBuildPanel: document.querySelector("#step-build-panel"),
  applyGenerator: document.querySelector("#apply-generator"),
  playCycle: document.querySelector("#play-cycle"),
  stopPlayback: document.querySelector("#stop-playback"),
  cycleActions: document.querySelector("#cycle-actions"),
  cycleStep: document.querySelector("#cycle-step"),
  cosetControl: document.querySelector("#coset-control"),
  cosetSelect: document.querySelector("#coset-select"),
  periodInput: document.querySelector("#period-input"),
  generatorMode: document.querySelector("#generator-mode"),
  generatorInput: document.querySelector("#generator-input"),
  cardinalityInput: document.querySelector("#cardinality-input"),
  baseFrequencyInput: document.querySelector("#base-frequency-input"),
  stepPeriodInput: document.querySelector("#step-period-input"),
  stepCardinalityInput: document.querySelector("#step-cardinality-input"),
  typeACountInput: document.querySelector("#type-a-count-input"),
  stepInputMode: document.querySelector("#step-input-mode"),
  ratioALabel: document.querySelector("#ratio-a-label"),
  ratioBLabel: document.querySelector("#ratio-b-label"),
  typeASizeLabel: document.querySelector("#type-a-size-label"),
  ratioAInput: document.querySelector("#ratio-a-input"),
  ratioBInput: document.querySelector("#ratio-b-input"),
  typeASizeInput: document.querySelector("#type-a-size-input"),
  stepBaseFrequencyInput: document.querySelector("#step-base-frequency-input"),
  applyStepBuild: document.querySelector("#apply-step-build"),
  modeSelect: document.querySelector("#mode-select"),
  modeOrder: document.querySelector("#mode-order"),
  labelMode: document.querySelector("#label-mode"),
  timbreSelect: document.querySelector("#timbre-select"),
  tempoInput: document.querySelector("#tempo-input"),
  keyboard: document.querySelector("#keyboard"),
  analysisPanel: document.querySelector("#analysis-panel"),
  statusLine: document.querySelector("#status-line"),
  scaleNameInput: document.querySelector("#scale-name-input"),
  exportScala: document.querySelector("#export-scala"),
  exportData: document.querySelector("#export-data"),
  importData: document.querySelector("#import-data"),
  importDataFile: document.querySelector("#import-data-file"),
  generatorSpanLine: document.querySelector("#generator-span-line"),
  patternLine: document.querySelector("#pattern-line"),
  cyclePatternLine: document.querySelector("#cycle-pattern-line"),
  cycleFoldingLine: document.querySelector("#cycle-folding-line"),
  intervalPanel: document.querySelector("#interval-panel"),
  summaryLine: document.querySelector("#summary-line"),
};

function setStatus(message) {
  els.statusLine.textContent = message;
}

function setSummary(message) {
  els.summaryLine.textContent = message;
}

const generatorFields = ["periodInput", "generatorMode", "generatorInput", "cardinalityInput", "baseFrequencyInput"];
const stepFields = ["stepPeriodInput", "stepCardinalityInput", "typeACountInput", "stepInputMode", "ratioAInput", "ratioBInput", "typeASizeInput", "stepBaseFrequencyInput"];
function readInputs(fields) {
  return Object.fromEntries(fields.map(key => [key, els[key].value]));
}
function rememberAppliedInputs() {
  els.generatorMode.dataset.previous = els.generatorMode.value;
  els.stepInputMode.dataset.previous = els.stepInputMode.value;
  appliedInputs = { generator: readInputs(generatorFields), step: readInputs(stepFields) };
  renderPending();
}
function renderPending() {
  if (!appliedInputs) return;
  const fields = state.buildMethod === "generator" ? generatorFields : stepFields;
  const pending = JSON.stringify(readInputs(fields)) !== JSON.stringify(appliedInputs[state.buildMethod]);
  els.pendingLine.textContent = pending ? "Incomplete or invalid inputs — the Explorer shows the last valid scale." : "";
}
function fieldValue(element, read) {
  try { return read(element.value); }
  catch (error) { error.field = element; throw error; }
}
function clearInputErrors() {
  document.querySelectorAll('[aria-invalid="true"]').forEach(element => element.removeAttribute("aria-invalid"));
}
function reportInputError(error, { focus = true } = {}) {
  if (error.field) {
    error.field.setAttribute("aria-invalid", "true");
    if (focus) error.field.focus();
  }
  setStatus(error instanceof Error ? error.message : String(error));
  renderPending();
}
function snapshot() {
  const scale = state.scale;
  return {
    version: 2,
    model: { period: scale.period, generatorValue: scale.generatorValue, cardinality: scale.cardinality, baseFrequency: scale.baseFrequency, stepWord: scale.stepWord },
    mode: scale.mode ?? 0, modeOrder: state.modeOrder,
    cycle: Number(els.cycleStep.value || 1), coset: Number(els.cosetSelect.value || 0),
    buildMethod: state.activeBuildMethod, generatorMode: els.generatorMode.value,
    view: state.explorerView, labelMode: els.labelMode.value, timbre: els.timbreSelect.value,
    tempo: state.tempo, volume: Number(els.volume.value),
    name: els.scaleNameInput.value.trim().replace(/[\r\n]/g, " "),
  };
}
function recordEdit({ automaticField = null } = {}) {
  const previousIndex = history.index;
  if (state.scale && history.record(snapshot(), { replace: automaticField !== null && automaticField === automaticEditField })) {
    automaticEditField = history.index < previousIndex ? null : automaticField;
  }
  if (automaticField === null) automaticEditField = null;
  els.undo.disabled = !history.canUndo;
  els.redo.disabled = !history.canRedo;
}
function restoreSavedSession(saved, record = true) {
  automaticEditField = null;
  // Validate and construct everything before touching the current session.
  const restored = restoreSession(saved);
  saved = restored.saved;
  stopPlaybackUi("");
  state.scale = restored.scale;
  state.activeBuildMethod = saved.buildMethod;
  state.buildMethod = saved.buildMethod;
  state.modeOrder = saved.modeOrder;
  state.explorerView = saved.view;
  state.cycleStepTouched = true;
  els.generatorMode.value = saved.generatorMode;
  els.modeOrder.value = saved.modeOrder;
  els.labelMode.value = saved.labelMode;
  els.timbreSelect.value = saved.timbre;
  state.tempo = saved.tempo;
  els.tempoInput.value = editableNumber(saved.tempo, 12);
  updateTempoHint();
  els.volume.value = String(saved.volume);
  audio.setVolume(saved.volume);
  els.scaleNameInput.value = saved.name;
  syncGeneratorControlsFromScale(state.scale);
  syncStepControlsFromScale(state.scale);
  render();
  els.cycleStep.value = String(saved.cycle);
  renderCosetOptions(state.scale);
  els.cosetSelect.value = String(saved.coset);
  clearInputErrors();
  setStatus("");
  render();
  rememberAppliedInputs();
  if (record) recordEdit();
  else {
    els.undo.disabled = !history.canUndo;
    els.redo.disabled = !history.canRedo;
  }
}
function afterDelay(callback, delay) {
  const epoch = audioEpoch;
  const timer = setTimeout(() => {
    uiTimers.delete(timer);
    if (epoch === audioEpoch && state.scale) callback();
  }, delay);
  uiTimers.add(timer);
}

function defaultScaleName(scale) {
  return `WFS N${scale.cardinality} g${editableNumber(scale.generator, 6)} p${editableNumber(scale.period, 6)}`;
}

function currentScaleName(scale) {
  return els.scaleNameInput.value.trim() || defaultScaleName(scale);
}

function updateScaleNamePlaceholder(scale) {
  els.scaleNameInput.placeholder = scale ? defaultScaleName(scale) : "WFS";
}

function slugifyFilename(value, fallback = "well-formed-scale") {
  const cleaned = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function downloadTextFile(filename, content, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportRowsWithTop(scale) {
  if (scale.displayRows && scale.displayRows.length >= scale.cardinality + 1) {
    return scale.displayRows.slice(0, scale.cardinality + 1);
  }

  const baseRows = scale.rows.slice(0, scale.cardinality);
  if (baseRows.length === 0) return [];
  const first = baseRows[0];
  const top = {
    ...first,
    scaleDegree: scale.cardinality,
    pitchClass: first.pitchClass + 1,
    cents: first.cents + 1200 * Math.log2(scale.period),
    frequency: first.frequency * scale.period,
  };
  return [...baseRows, top];
}

function approximateRational(value, maxDenominator = 1048576, tolerance = 1e-10) {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (Math.abs(value - Math.round(value)) <= tolerance) {
    const numerator = Math.round(value);
    return numerator <= 2147483647 ? { numerator, denominator: 1 } : null;
  }

  let x = value;
  let a = Math.floor(x);
  let hPrev = 1;
  let kPrev = 0;
  let h = a;
  let k = 1;

  while (k <= maxDenominator && Math.abs(h / k - value) > tolerance) {
    const fraction = x - a;
    if (Math.abs(fraction) < 1e-15) break;
    x = 1 / fraction;
    a = Math.floor(x);
    const hNext = a * h + hPrev;
    const kNext = a * k + kPrev;
    if (
      !Number.isFinite(hNext) ||
      !Number.isFinite(kNext) ||
      kNext > maxDenominator ||
      hNext > 2147483647 ||
      kNext > 2147483647
    ) {
      break;
    }
    hPrev = h;
    kPrev = k;
    h = hNext;
    k = kNext;
  }

  return Math.abs(h / k - value) <= tolerance ? { numerator: h, denominator: k } : null;
}

function formatScalaPitchValue(relativePitch, period) {
  const ratio = period ** relativePitch;
  const rational = approximateRational(ratio);
  if (rational) {
    return rational.denominator === 1
      ? String(rational.numerator)
      : `${rational.numerator}/${rational.denominator}`;
  }
  return (1200 * relativePitch * Math.log2(period)).toFixed(6);
}

function buildScalaContent(scale) {
  const name = currentScaleName(scale);
  const filename = `${slugifyFilename(name)}.scl`;
  const rows = exportRowsWithTop(scale);
  const tonicPitchClass = rows[0]?.pitchClass ?? 0;
  const pitchLines = rows
    .slice(1)
    .map((row) => formatScalaPitchValue(row.pitchClass - tonicPitchClass, scale.period));

  const content = [
    `! ${filename}`,
    "!",
    name,
    ` ${scale.cardinality}`,
    "!",
    ...pitchLines.map((line) => ` ${line}`),
    "",
  ].join("\n");

  return { filename, content };
}

function buildScaleDataContent(scale) {
  const name = currentScaleName(scale);
  const rows = exportRowsWithTop(scale);
  const tonicPitchClass = rows[0]?.pitchClass ?? 0;
  const totalCents = 1200 * Math.log2(scale.period);
  const data = analysisPanelData(scale);
  const filename = `${slugifyFilename(name)}-data.txt`;
  const header = [
    "WFSE scale data v2",
    `session: ${JSON.stringify(snapshot())}`,
    "",
    "Well-Formed Scale Explorer",
    "",
    `Scale name: ${name}`,
    `Build method: ${state.activeBuildMethod === "generator" ? "Generator Build" : "Scale Step Build"}`,
    `Selected mode: ${currentModeValue()}`,
    `Mode order: ${state.modeOrder === MODE_ORDERS.generator ? "Generator" : "Step"}`,
    "",
    "Cardinalities",
    ...data.cardinalities.map((item) =>
      `${item.label}\t${item.value}${item.note ? `\t(${item.note})` : ""}`
    ),
    "",
    "Values",
    "Item\tFreq ratio\tCents",
    ...data.values.map((item) => `${item.label}\t${item.raw}\t${item.cents}`),
    "",
    "Scale",
    `Period range:\t1 to ${displayNumber(scale.period, 6)}`,
    `Cents range:\t0 to ${displayNumber(totalCents, 6)}`,
    "",
    "Degree\tFreq ratio\tCents",
    ...rows.map((row, index) => {
      const relativePitch = row.pitchClass - tonicPitchClass;
      const ratio = scale.period ** relativePitch;
      const cents = 1200 * relativePitch * Math.log2(scale.period);
      return `${index}\t${displayNumber(ratio, 6)}\t${displayNumber(cents, 6)}`;
    }),
    "",
  ];

  return { filename, content: header.join("\n") };
}

function parseScaleDataContent(text) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  if (!["WFSE scale data v1", "WFSE scale data v2"].includes(lines[0]?.trim())) {
    throw new Error("This does not look like a Well-Formed Scale Explorer data file.");
  }

  const metadata = {};
  let index = 1;
  while (index < lines.length) {
    const line = lines[index].trim();
    index += 1;
    if (!line) break;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    metadata[key] = value;
  }

  return metadata;
}

function importScaleData(metadata) {
  if (metadata.session) {
    let saved;
    try { saved = JSON.parse(metadata.session); }
    catch { throw new Error("The scale data contains an unreadable session."); }
    restoreSavedSession(saved);
    return;
  }
  // Backward compatibility for files exported before complete session saving.
  const required = ["active_build_method", "selected_mode", "mode_order", "generator_period", "generator_mode", "generator_input", "generator_cardinality", "generator_base_frequency", "step_period", "step_cardinality", "step_type_a_count", "step_input_mode", "step_ratio_a", "step_ratio_b", "step_type_a_size", "step_base_frequency"];
  required.forEach(key => { if (!(key in metadata)) throw new Error(`Scale data file is missing "${key}".`); });
  let scale;
  if (metadata.active_build_method === "step") {
    scale = buildScaleFromStepStructure({
      period: evaluateExpression(metadata.step_period), cardinality: Number(metadata.step_cardinality),
      baseFrequency: parseBaseFrequencyInput(metadata.step_base_frequency), typeACount: Number(metadata.step_type_a_count),
      inputMode: metadata.step_input_mode, ratioA: metadata.step_ratio_a, ratioB: metadata.step_ratio_b, typeASize: metadata.step_type_a_size,
    });
  } else if (metadata.active_build_method === "generator") {
    const cardinality = Number(metadata.generator_cardinality);
    if (!Number.isInteger(cardinality) || cardinality < 2 || cardinality > 60) throw new Error("Invalid cardinality in scale data.");
    scale = buildScaleFromGenerator({ period: evaluateExpression(metadata.generator_period), generatorMode: metadata.generator_mode,
      generatorInput: metadata.generator_input, baseFrequency: parseBaseFrequencyInput(metadata.generator_base_frequency), cardinality });
  } else throw new Error("Invalid build method in scale data.");
  restoreSavedSession({
    version: 2, model: {period: scale.period, generatorValue: scale.generatorValue, cardinality: scale.cardinality, baseFrequency: scale.baseFrequency, stepWord: scale.stepWord},
    mode: Number(metadata.selected_mode), modeOrder: metadata.mode_order, cycle: 1, coset: 0,
    buildMethod: metadata.active_build_method, generatorMode: metadata.generator_mode,
    view: "keyboard", labelMode: "notes", timbre: "clarinet", duration: .75, volume: .72, name: metadata.scale_name || "",
  });
}

function renderBuildMethod() {
  const generatorActive = state.buildMethod === "generator";
  els.generatorBuildPanel.classList.toggle("hidden", !generatorActive);
  els.stepBuildPanel.classList.toggle("hidden", generatorActive);
  els.buildGenerator.classList.toggle("is-active", generatorActive);
  els.buildStep.classList.toggle("is-active", !generatorActive);
}

function renderExplorerView() {
  const keyboardView = state.explorerView === "keyboard";
  els.viewKeyboard.classList.toggle("is-active", keyboardView);
  els.viewCircle.classList.toggle("is-active", !keyboardView);
  els.keyboard.setAttribute(
    "aria-label",
    keyboardView ? "Scale keyboard" : "Scale circle"
  );
}

function renderStepInputMode() {
  const ratioMode = els.stepInputMode.value === "ratio";
  els.ratioALabel.classList.toggle("hidden", !ratioMode);
  els.ratioBLabel.classList.toggle("hidden", !ratioMode);
  els.typeASizeLabel.classList.toggle("hidden", ratioMode);
}

function modalCycleRows(scale) {
  const baseRows = circleRows(scale).map((row) => ({
    ...row,
    positionIndex: row.displayDegree,
  }));
  const tonicGeneratorIndex = baseRows[0]?.fromGeneratorIndex ?? 0;
  const aliasedRows = baseRows.map((row) => ({
    ...row,
    generatorOrderIndex:
      ((row.fromGeneratorIndex - tonicGeneratorIndex) % scale.cardinality + scale.cardinality) %
      scale.cardinality,
  }));

  if (state.modeOrder !== MODE_ORDERS.generator) {
    return aliasedRows;
  }

  return [...aliasedRows]
    .map((row) => ({
      ...row,
      generatorDistance: row.generatorOrderIndex,
    }))
    .sort((left, right) => left.generatorDistance - right.generatorDistance)
    .map((row, index) => ({
      ...row,
      displayDegree: index,
    }));
}

function mod(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function normalizeAngleDelta(delta) {
  if (delta <= -Math.PI) {
    return delta + 2 * Math.PI;
  }
  if (delta > Math.PI) {
    return delta - 2 * Math.PI;
  }
  return delta;
}

function angleFromPointer(clientX, clientY, centerPoint) {
  return Math.atan2(centerPoint.y - clientY, clientX - centerPoint.x);
}

function circleDeformationInfoForScale(scale) {
  return generatorDeformationInfo(scale, CIRCLE_DEFORMATION_EPSILON);
}

function clearCircleDeformationState() {
  state.circleDeformation.previewGeneratorValue = null;
  state.circleDeformation.dragSession = null;
}

function previewCircleRows(scale, rows) {
  const previewGeneratorValue = state.circleDeformation.previewGeneratorValue;
  if (previewGeneratorValue === null) {
    return rows;
  }

  try {
    const previewScale = applyMode(
      preserveStepLabels(buildScaleFromGenerator({
        period: scale.period,
        generatorMode: "log",
        generatorInput: String(previewGeneratorValue),
        baseFrequency: scale.baseFrequency,
        cardinality: scale.cardinality,
      }), scale),
      currentModeValue()
    );
    return modalCycleRows(previewScale);
  } catch {
    return rows;
  }
}

function circlePitchClassSeparation(left, right) {
  const directDistance = Math.abs(left - right);
  return Math.min(directDistance, 1 - directDistance);
}

function visibleCircleRows(rows, radius) {
  if (rows.length <= 1) {
    return rows;
  }

  const collapsePitchClassDistance =
    2 * Math.asin(Math.min(1, CIRCLE_COLLAPSE_DISTANCE_PX / (2 * radius))) / (2 * Math.PI);
  const sortedRows = [...rows].sort((left, right) => (
    left.relativePitchClass - right.relativePitchClass || left.displayDegree - right.displayDegree
  ));
  const groups = [];

  for (let index = 0; index < sortedRows.length; index += 1) {
    const group = [sortedRows[index]];
    while (
      index + 1 < sortedRows.length &&
      circlePitchClassSeparation(
        sortedRows[index + 1].relativePitchClass,
        sortedRows[index].relativePitchClass
      ) <= collapsePitchClassDistance
    ) {
      group.push(sortedRows[index + 1]);
      index += 1;
    }
    groups.push(group);
  }

  if (
    groups.length > 1 &&
    circlePitchClassSeparation(
      groups[0][0].relativePitchClass,
      groups[groups.length - 1][groups[groups.length - 1].length - 1].relativePitchClass
    ) <= collapsePitchClassDistance
  ) {
    groups[0] = [...groups[groups.length - 1], ...groups[0]];
    groups.pop();
  }

  const visibleDegrees = new Set();
  groups.forEach((group) => {
    const visibleRow = group.reduce((best, candidate) => (
      candidate.displayDegree < best.displayDegree ? candidate : best
    ));
    visibleDegrees.add(visibleRow.displayDegree);
  });

  return rows.filter((row) => visibleDegrees.has(row.displayDegree));
}

function modularInverse(value, modulus) {
  let t = 0;
  let newT = 1;
  let r = modulus;
  let newR = mod(value, modulus);

  while (newR !== 0) {
    const quotient = Math.floor(r / newR);
    [t, newT] = [newT, t - quotient * newT];
    [r, newR] = [newR, r - quotient * newR];
  }

  if (r !== 1) {
    throw new Error("Generator span is not invertible modulo N.");
  }

  return mod(t, modulus);
}

function trueGeneratorSpan(scale) {
  const rows = circleRows(scale);
  const tonicGeneratorIndex = rows[0]?.fromGeneratorIndex ?? 0;
  const generatorRow = rows.find((row) => {
    const distance = mod(row.fromGeneratorIndex - tonicGeneratorIndex, scale.cardinality);
    return distance === 1;
  });
  return generatorRow?.displayDegree ?? 1;
}

function cycleGroupsForSelectedOrder(scale, stepSize) {
  const rows = modalCycleRows(scale);
  const size = rows.length;
  const step = mod(stepSize, size);
  if (step === 0) {
    throw new Error("Cycle step must be between 1 and N-1.");
  }

  const visited = new Array(size).fill(false);
  const groups = [];

  for (let start = 0; start < size; start += 1) {
    if (visited[start]) continue;
    const group = [];
    let index = start;
    while (!visited[index]) {
      visited[index] = true;
      group.push(rows[index]);
      index = (index + step) % size;
    }
    groups.push(group);
  }

  return groups;
}

function generatorCycleDefaultStep(scale) {
  return state.modeOrder === MODE_ORDERS.generator ? 1 : trueGeneratorSpan(scale);
}

function currentModeValue() {
  return Number(els.modeSelect.value || 0);
}

function numericGeneratorInputs() {
  return {
    period: fieldValue(els.periodInput, value => {
      const period = evaluateExpression(value);
      if (!(period > 1)) throw new Error("Period must be greater than 1.");
      return period;
    }),
    generatorMode: els.generatorMode.value,
    generatorInput: els.generatorInput.value,
    baseFrequency: fieldValue(els.baseFrequencyInput, parseBaseFrequencyInput),
  };
}
function numericStepInputs() {
  const inputMode = els.stepInputMode.value;
  return {
    period: fieldValue(els.stepPeriodInput, value => {
      const period = evaluateExpression(value);
      if (!(period > 1)) throw new Error("Period must be greater than 1.");
      return period;
    }),
    baseFrequency: fieldValue(els.stepBaseFrequencyInput, parseBaseFrequencyInput),
    cardinality: Number(els.stepCardinalityInput.value), typeACount: Number(els.typeACountInput.value), inputMode,
    ratioA: inputMode === "ratio" ? String(fieldValue(els.ratioAInput, evaluateExpression)) : els.ratioAInput.value,
    ratioB: inputMode === "ratio" ? String(fieldValue(els.ratioBInput, evaluateExpression)) : els.ratioBInput.value,
    typeASize: inputMode === "size" ? String(fieldValue(els.typeASizeInput, evaluateExpression)) : els.typeASizeInput.value,
  };
}
function buildCurrentScale(method, preserveCardinality) {
  let baseScale;
  if (method === "step") {
    try { baseScale = buildScaleFromStepStructure(numericStepInputs()); }
    catch (error) {
      if (!error.field) error.field = /Cardinality/.test(error.message) ? els.stepCardinalityInput : /count/.test(error.message) ? els.typeACountInput : els.stepInputMode.value === "size" ? els.typeASizeInput : els.ratioAInput;
      throw error;
    }
  } else {
    const inputs = numericGeneratorInputs();
    const parsed = fieldValue(els.generatorInput, () => parseGeneratorConfiguration(inputs));
    const selected = Number(els.cardinalityInput.value || state.cardinality);
    const cardinality = parsed.availableCardinalities.includes(selected) || preserveCardinality ? selected : parsed.availableCardinalities[0];
    if (!cardinality) throw new Error("No well-formed cardinalities were found for this generator (maximum N = 60).");
    baseScale = preserveStepLabels(buildScaleFromGenerator({ ...inputs, cardinality }), state.scale);
  }
  return applyMode(baseScale, Math.min(currentModeValue(), baseScale.cardinality - 1));
}

function populateCardinalityOptions(options, selectedValue, { preserveSelectedValue = false } = {}) {
  if (options.length === 0) {
    throw new Error("No well-formed cardinalities were found for this generator.");
  }

  const resolvedOptions =
    preserveSelectedValue &&
    Number.isInteger(selectedValue) &&
    selectedValue > 1 &&
    !options.includes(selectedValue)
      ? [...new Set([...options, selectedValue])].sort((left, right) => left - right)
      : options;
  const nextValue = resolvedOptions.includes(selectedValue) ? selectedValue : resolvedOptions[0];
  els.cardinalityInput.innerHTML = "";
  resolvedOptions.forEach((value) => {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = String(value);
    els.cardinalityInput.appendChild(option);
  });
  els.cardinalityInput.value = String(nextValue);
  state.cardinality = nextValue;
}


function syncStepControlsFromScale(scale) {
  els.stepPeriodInput.value = editableNumber(scale.period);
  els.stepCardinalityInput.value = String(scale.cardinality);
  els.stepBaseFrequencyInput.value = formatBaseFrequencyInput(scale.baseFrequency);

  if (scale.summary.typeBCount === 0) {
    els.typeACountInput.value = String(scale.cardinality);
    els.stepInputMode.value = "size";
    els.ratioAInput.value = "1";
    els.ratioBInput.value = "1";
    els.typeASizeInput.value = editableNumber(1 / scale.cardinality);
  } else {
    els.typeACountInput.value = String(scale.summary.typeACount);
    els.stepInputMode.value = "ratio";
    els.ratioAInput.value = editableNumber(scale.summary.ratio, 15);
    els.ratioBInput.value = "1";
    els.typeASizeInput.value = editableNumber(scale.summary.typeASize);
  }

  renderStepInputMode();
}

function syncGeneratorControlsFromScale(scale) {
  els.periodInput.value = editableNumber(scale.period);
  els.baseFrequencyInput.value = formatBaseFrequencyInput(scale.baseFrequency);
  if (els.generatorMode.value === "log") {
    els.generatorInput.value = editableNumber(scale.generatorValue);
  } else {
    els.generatorInput.value = editableNumber(scale.generator);
  }
  populateCardinalityOptions(
    [...new Set(scale.availableCardinalities.concat(scale.cardinality))].sort((left, right) => left - right),
    scale.cardinality
  );
}

function rebuildScale({ method = state.activeBuildMethod, resetCycleSelection = false, preserveGeneratorCardinality = false, automaticField = null, reportErrors = true } = {}) {
  if (automaticField === null) automaticEditField = null;
  clearInputErrors();
  try {
    const nextScale = buildCurrentScale(method, preserveGeneratorCardinality);
    stopPlaybackUi("");
    clearCircleDeformationState();
    state.scale = nextScale;
    state.activeBuildMethod = method;
    if (resetCycleSelection) state.cycleStepTouched = false;
    if (method === "generator") {
      const rawInputs = readInputs(generatorFields);
      syncGeneratorControlsFromScale(nextScale);
      for (const key of automaticField ? generatorFields.filter(key => key !== "cardinalityInput") : ["generatorInput"]) {
        els[key].value = rawInputs[key];
      }
      syncStepControlsFromScale(nextScale);
    } else {
      syncGeneratorControlsFromScale(nextScale);
    }
    setStatus("");
    render();
    rememberAppliedInputs();
    recordEdit({ automaticField });
    return true;
  } catch (error) {
    clearCircleDeformationState();
    if (reportErrors) reportInputError(error, { focus: automaticField === null });
    else { setStatus(""); renderPending(); }
    return false;
  }
}

function renderAnalysisPanel(scale) {
  const data = analysisPanelData(scale);
  els.analysisPanel.innerHTML = "";

  const cardinalities = document.createElement("section");
  cardinalities.className = "analysis-card";
  cardinalities.innerHTML = `
    <div class="analysis-card-header">
      <h3>Cardinalities</h3>
    </div>
  `;

  const cardinalityTable = document.createElement("table");
  cardinalityTable.className = "analysis-table";
  const cardinalityBody = document.createElement("tbody");
  data.cardinalities.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <th scope="row">${item.label}</th>
      <td>
        <div>${item.value}</div>
        ${item.note ? `<div class="analysis-note">(${item.note})</div>` : ""}
      </td>
    `;
    cardinalityBody.appendChild(row);
  });
  cardinalityTable.appendChild(cardinalityBody);
  cardinalities.appendChild(cardinalityTable);

  const values = document.createElement("section");
  values.className = "analysis-card analysis-card-wide";
  values.innerHTML = `
    <div class="analysis-card-header">
      <h3>Values</h3>
    </div>
  `;

  const valuesTable = document.createElement("table");
  valuesTable.className = "analysis-table analysis-table-values";
  valuesTable.innerHTML = `
    <thead>
      <tr>
        <th scope="col"></th>
        <th scope="col">Freq ratio</th>
        <th scope="col">Cents</th>
      </tr>
    </thead>
  `;

  const valuesBody = document.createElement("tbody");
  data.values.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <th scope="row">${item.label}</th>
      <td>${item.raw}</td>
      <td>${item.cents}</td>
    `;
    valuesBody.appendChild(row);
  });
  valuesTable.appendChild(valuesBody);
  values.appendChild(valuesTable);

  els.analysisPanel.append(cardinalities, values);
}

function renderModeSelect(scale) {
  const previous = scale.mode ?? 0;
  const order = orderedModes(scale, state.modeOrder);
  els.modeSelect.innerHTML = "";
  order.forEach((mode) => {
    const option = document.createElement("option");
    option.value = String(mode);
    option.textContent = String(mode);
    els.modeSelect.appendChild(option);
  });
  const fallback = order[0] ?? 0;
  els.modeSelect.value = String(order.includes(previous) ? previous : fallback);
}

function renderCycleStepOptions(scale) {
  const previous = Number(els.cycleStep.value || 2);
  const generatorOrder = state.modeOrder === MODE_ORDERS.generator;
  const span = trueGeneratorSpan(scale);
  const stepOrderStep = generatorOrder ? modularInverse(span, scale.cardinality) : 1;
  const generatorOrderStep = generatorOrder ? 1 : span;
  const specialCycles = [
    [stepOrderStep, "step order"],
    [scale.cardinality - stepOrderStep, "reverse step"],
    [generatorOrderStep, "generator order"],
    [scale.cardinality - generatorOrderStep, "reverse generator"],
  ];
  els.cycleStep.innerHTML = "";
  for (let step = 1; step < scale.cardinality; step += 1) {
    const option = document.createElement("option");
    option.value = String(step);
    const descriptions = specialCycles.filter(([value]) => value === step).map(([, label]) => label);
    option.textContent = descriptions.length ? `${step} — ${descriptions.join(", ")}` : String(step);
    els.cycleStep.appendChild(option);
  }
  const nextValue = state.cycleStepTouched && previous >= 1 && previous < scale.cardinality ? previous : 1;
  els.cycleStep.value = String(nextValue);
}

function cycleRowsForCurrentView(scale, { usePreview = false } = {}) {
  const rows = modalCycleRows(scale);
  return usePreview ? previewCircleRows(scale, rows) : rows;
}

function selectedCycleGroups(scale, { usePreview = false } = {}) {
  const rows = cycleRowsForCurrentView(scale, { usePreview });
  const size = rows.length;
  const step = mod(Number(els.cycleStep.value || 1), size);
  if (size === 0 || step === 0) {
    return [];
  }

  const visited = new Array(size).fill(false);
  const groups = [];

  for (let start = 0; start < size; start += 1) {
    if (visited[start]) continue;
    const group = [];
    let index = start;
    while (!visited[index]) {
      visited[index] = true;
      group.push(rows[index]);
      index = (index + step) % size;
    }
    groups.push(group);
  }

  return groups;
}

function renderCosetOptions(scale) {
  const groups = selectedCycleGroups(scale);
  const previous = Number(els.cosetSelect.value || 0);
  els.cosetSelect.innerHTML = "";

  groups.forEach((_, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = String(index);
    els.cosetSelect.appendChild(option);
  });

  const nextValue = previous >= 0 && previous < groups.length ? previous : 0;
  els.cosetSelect.value = String(nextValue);
  els.cosetControl.classList.toggle("hidden", groups.length <= 1);
}

function selectedCycleRows(scale, { usePreview = false } = {}) {
  const groups = selectedCycleGroups(scale, { usePreview });
  const cosetIndex = Number(els.cosetSelect.value || 0);
  return groups[cosetIndex] ?? groups[0] ?? [];
}

function cycleSegmentKinds(rows, scale) {
  if (rows.length <= 1) {
    return [];
  }

  const segments = rows.map((row, index) => {
    const next = rows[(index + 1) % rows.length];
    const gap = ((next.relativePitchClass - row.relativePitchClass) % 1 + 1) % 1;
    return {
      from: row.displayDegree,
      to: next.displayDegree,
      gap,
      letter: cycleIntervalLetter(scale, row.positionIndex, next.positionIndex),
    };
  });

  const distinctGaps = [...segments]
    .map((segment) => segment.gap)
    .sort((left, right) => left - right)
    .filter((gap, index, array) => index === 0 || Math.abs(gap - array[index - 1]) > 1e-10);

  if (distinctGaps.length <= 1) {
    return segments.map((segment) => ({ ...segment, kind: "single" }));
  }

  const smallGap = distinctGaps[0];
  const largeGap = distinctGaps[distinctGaps.length - 1];
  return segments.map((segment) => ({
    ...segment,
    kind: Math.abs(segment.gap - largeGap) <= Math.abs(segment.gap - smallGap) ? "large" : "small",
  }));
}

function cyclePlaybackEvents(scale) {
  const rows = selectedCycleRows(scale);
  if (rows.length === 0) return [];

  const step = Number(els.cycleStep.value || 1);
  const generatorStep = generatorCycleDefaultStep(scale);
  const reverseGeneratorStep = (scale.cardinality - generatorStep) % scale.cardinality;

  const secondRow = rows[1] ?? rows[0];
  const firstGap = ((secondRow.relativePitchClass - rows[0].relativePitchClass) % 1 + 1) % 1;

  const startHigh =
    step === reverseGeneratorStep
      ? true
      : step === generatorStep
        ? false
        : firstGap > 0.5;

  const firstRow = rows[0];
  const highFirst = {
    ...firstRow,
    frequency: firstRow.frequency * scale.period,
    activePitchClass: firstRow.pitchClass + 1,
    segmentFrom: null,
    segmentTo: null,
  };
  const lowFirst = {
    ...firstRow,
    activePitchClass: firstRow.pitchClass,
    segmentFrom: rows[rows.length - 1]?.displayDegree ?? firstRow.displayDegree,
    segmentTo: firstRow.displayDegree,
  };

  if (state.modeOrder === MODE_ORDERS.generator) {
    if (rows.length === 1) {
      return [lowFirst, lowFirst];
    }

    const middle = rows.slice(1).map((row, index) => ({
      ...row,
      activePitchClass: row.pitchClass,
      segmentFrom: rows[index].displayDegree,
      segmentTo: row.displayDegree,
    }));

    return [
      { ...firstRow, activePitchClass: firstRow.pitchClass, segmentFrom: null, segmentTo: null },
      ...middle,
      lowFirst,
    ];
  }

  if (rows.length === 1) {
    return startHigh ? [highFirst, lowFirst] : [lowFirst, highFirst];
  }

  const middle = rows.slice(1).map((row, index) => ({
    ...row,
    activePitchClass: row.pitchClass,
    segmentFrom: rows[index].displayDegree,
    segmentTo: row.displayDegree,
  }));

  return startHigh
    ? [highFirst, ...middle, lowFirst]
    : [
        { ...firstRow, activePitchClass: firstRow.pitchClass, segmentFrom: null, segmentTo: null },
        ...middle,
        {
          ...highFirst,
          segmentFrom: rows[rows.length - 1].displayDegree,
          segmentTo: firstRow.displayDegree,
        },
      ];
}

function cycleLegend(scale) {
  return `Generator span: ${generatorCycleDefaultStep(scale)}`;
}

function symbolCounts(text, firstSymbol, secondSymbol) {
  const firstCount = [...text].filter((char) => char === firstSymbol).length;
  const secondCount = [...text].filter((char) => char === secondSymbol).length;
  return `(${firstCount},${secondCount})`;
}

function cyclePatternText(scale) {
  const rows = selectedCycleRows(scale);
  const segments = cycleSegmentKinds(rows, scale);
  const pattern = segments
    .map((segment) => segment.letter)
    .join("");
  return `${pattern} ${symbolCounts(pattern, "a", "b")}`;
}

function cycleFoldingText(scale) {
  const rows = selectedCycleRows(scale);
  if (rows.length === 0) return "";

  const degrees = rows.map((row) => row.positionIndex);
  degrees.push(rows[0].positionIndex);

  const folding = degrees
    .slice(0, -1)
    .map((degree, index) => (degrees[index + 1] - degree > 0 ? "x" : "y"))
    .join("");
  return `${folding} ${symbolCounts(folding, "x", "y")}`;
}

function cycleIntervalRows(scale, { usePreview = false } = {}) {
  const rows = selectedCycleRows(scale, { usePreview });
  const segments = cycleSegmentKinds(rows, scale);
  return ["large", "small", "single"].flatMap(kind => {
    const segment = segments.find(item => item.kind === kind);
    if (!segment) return [];
    const gap = segment.gap;
    return [{
      kind,
      label: kind === "large" ? "Large" : kind === "small" ? "Small" : "Single",
      raw: displayNumber(scale.period ** gap, 6),
      cents: displayNumber(1200 * gap * Math.log2(scale.period), 3),
    }];
  });
}

function renderIntervalPanel(scale, { usePreview = false } = {}) {
  els.intervalPanel.innerHTML = "";
  const rows = cycleIntervalRows(scale, { usePreview });

  const table = document.createElement("table");
  table.className = "interval-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th scope="col">Interval</th>
        <th scope="col">Freq ratio</th>
        <th scope="col">Cents</th>
      </tr>
    </thead>
  `;

  const body = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <th scope="row">
        <span class="interval-cell">
          <span class="interval-dot ${row.kind}"></span>
          <span>${row.label}</span>
        </span>
      </th>
      <td>${row.raw}</td>
      <td>${row.cents}</td>
    `;
    body.appendChild(tr);
  });

  table.appendChild(body);
  els.intervalPanel.appendChild(table);
}

function keySummary(key) {
  const prefix = key.role === "color" ? "Auxiliary tone" : "Scale tone";
  return `${prefix} at ${displayNumber(key.displayFrequency)} Hz`;
}

function activateKeyboardPitch(pitchClass, displayDegree = null) {
  state.activePitchClasses.add(String(pitchClass));
  if (displayDegree !== null && displayDegree !== undefined) {
    state.activeDisplayDegrees.add(String(displayDegree));
  }
}

function deactivateKeyboardPitch(pitchClass, displayDegree = null) {
  const held = [...state.activeKeyboardKeys.values(), ...[...pointerNotes.values(), ...ringingPointerNotes].map(item => item.key)];
  if (!held.some(note => String(note.pitchClass) === String(pitchClass))) state.activePitchClasses.delete(String(pitchClass));
  if (displayDegree !== null && displayDegree !== undefined && !held.some(note => String(note.displayDegree) === String(displayDegree))) {
    state.activeDisplayDegrees.delete(String(displayDegree));
  }
}

async function prepareSound(epoch = audioEpoch) {
  const timbre = els.timbreSelect.value;
  try {
    if (timbre !== "sine" && !audio.instruments?.has(timbre)) setSummary("Loading instrument…");
    await audio.ensureInstrument(timbre);
    const ready = epoch === audioEpoch && timbre === els.timbreSelect.value;
    if (ready && els.summaryLine.textContent === "Loading instrument…") setSummary("Instrument ready.");
    return ready;
  } catch (error) {
    if (epoch === audioEpoch) setSummary(`Sound unavailable: ${error.message}`);
    return false;
  }
}

async function playScaleTone(noteId, frequency, summary) {
  const epoch = audioEpoch;
  if (!await prepareSound(epoch)) return false;
  audio.playTransient(noteId, [frequency], {
    timbre: els.timbreSelect.value,
    duration: cycleSpacing(),
  });
  setSummary(summary);
  return true;
}

function renderHeldNotes() {
  if (state.explorerView !== "keyboard") {
    if (state.scale) renderExplorerSurface(state.scale);
    return;
  }
  // Keep focused keys and active touch targets in the DOM while a chord is held.
  els.keyboard.querySelectorAll(".key").forEach(element => {
    element.classList.toggle("active", state.activePitchClasses.has(element.dataset.pitchClass));
  });
}

function releasePointerNote(event) {
  const held = pointerNotes.get(event.pointerId);
  if (!held) return;
  pointerNotes.delete(event.pointerId);
  const remaining = held.startedAt === undefined ? 0 : Math.max(0, held.minimumDuration - (audio.context.currentTime - held.startedAt));
  audio.stopSustainedNote(held.id, { minimumDuration: held.minimumDuration });
  const finish = () => {
    ringingPointerNotes.delete(held);
    deactivateKeyboardPitch(held.key.pitchClass, held.key.displayDegree);
    renderHeldNotes();
  };
  if (remaining > 0) {
    ringingPointerNotes.add(held);
    afterDelay(finish, remaining * 1000);
  } else finish();
}

function bindKeyboardPointer(element, key) {
  element.addEventListener("pointerdown", async event => {
    if (event.button !== 0) return;
    event.preventDefault();
    els.keyboard.focus({ preventScroll: true });
    releasePointerNote(event);
    const held = {id: `pointer:${event.pointerId}`, key, minimumDuration: event.pointerType === "mouse" ? cycleSpacing() : 0};
    pointerNotes.set(event.pointerId, held);
    const epoch = audioEpoch;
    if (!await prepareSound(epoch)) {
      if (pointerNotes.get(event.pointerId) === held) pointerNotes.delete(event.pointerId);
      return;
    }
    if (pointerNotes.get(event.pointerId) !== held) return;
    held.startedAt = audio.context?.currentTime;
    audio.startSustainedNote(held.id, [key.frequency], {timbre: els.timbreSelect.value});
    activateKeyboardPitch(key.pitchClass, key.displayDegree);
    setSummary(keySummary(key));
    renderHeldNotes();
  });
}

function renderKeyboard(scale) {
  els.keyboard.innerHTML = "";
  els.keyboard.classList.remove("circle-surface");
  const { whiteKeys, blackKeys, patternGaps } = keyboardItems(scale);
  const mappedKeys = KEYBOARD_KEYS.slice(0, whiteKeys.length);

  const stage = document.createElement("div");
  stage.className = "keyboard-stage";
  stage.style.setProperty("--white-key-count", String(whiteKeys.length));

  const whiteRow = document.createElement("div");
  whiteRow.className = "white-key-row";

  const colorLayer = document.createElement("div");
  colorLayer.className = "color-key-layer";

  const patternLayer = document.createElement("div");
  patternLayer.className = "pattern-layer";

  const cycleOverlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  cycleOverlay.setAttribute("class", "keyboard-cycle-overlay");
  cycleOverlay.setAttribute(
    "viewBox",
    `0 0 ${whiteKeys.length * 68} 206`
  );

  const cycleRows = selectedCycleRows(scale);
  const visibleCycleRows = cycleRows.filter((row) => row.positionIndex < scale.cardinality);
  const pointForPosition = (positionIndex) => ({
    x: (positionIndex + 0.5) * 68,
    y: 34,
  });

  if (visibleCycleRows.length > 1) {
    visibleCycleRows.forEach((row, index) => {
      const next = visibleCycleRows[(index + 1) % visibleCycleRows.length];
      const point = pointForPosition(row.positionIndex);
      const nextPoint = pointForPosition(next.positionIndex);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      const isActive =
        state.activeCycleSegment &&
        state.activeCycleSegment.from === row.displayDegree &&
        state.activeCycleSegment.to === next.displayDegree;
      line.setAttribute("class", `cycle-segment${isActive ? " active" : ""}`);
      line.setAttribute("x1", String(point.x));
      line.setAttribute("y1", String(point.y));
      line.setAttribute("x2", String(nextPoint.x));
      line.setAttribute("y2", String(nextPoint.y));
      cycleOverlay.appendChild(line);
    });
  }

  const playKey = async (key, indexPrefix) => {
    if (!await playScaleTone(`${indexPrefix}-${key.id}`, key.frequency, keySummary(key))) return;
    activateKeyboardPitch(key.pitchClass, key.displayDegree);
    renderHeldNotes();
    afterDelay(() => {
      deactivateKeyboardPitch(key.pitchClass, key.displayDegree);
      renderHeldNotes();
    }, cycleSpacing() * 900);
  };

  whiteKeys.forEach((key, index) => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "key white-key";
    element.dataset.pitchClass = String(key.pitchClass);
    element.setAttribute("aria-label", `Degree ${key.displayDegree}, ${displayNumber(key.frequency)} Hz${mappedKeys[index] ? `, computer key ${mappedKeys[index]}` : ""}`);
    if (key.highlighted) element.classList.add("highlighted");
    if (state.activePitchClasses.has(String(key.pitchClass))) element.classList.add("active");

    element.innerHTML = `
      <span class="key-degree">${mappedKeys[index] ?? ""}</span>
      <span class="key-label">${keyboardLabel(key, scale, els.labelMode.value)}</span>
    `;

    bindKeyboardPointer(element, key);
    element.addEventListener("click", event => {
      if (event.detail === 0) playKey(key, `mouse-${index}`);
    });

    whiteRow.appendChild(element);
  });

  blackKeys.forEach((key, index) => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "key color-key";
    element.dataset.pitchClass = String(key.pitchClass);
    element.setAttribute("aria-label", `Auxiliary tone, ${displayNumber(key.frequency)} Hz`);
    element.style.setProperty("--x", String(key.x));
    element.style.setProperty("--w", String(key.width));
    if (state.activePitchClasses.has(String(key.pitchClass))) element.classList.add("active");
    element.innerHTML = `<span class="color-key-degree">${shiftedKeyLabel(mappedKeys[key.gapIndex])}</span>`;

    bindKeyboardPointer(element, key);
    element.addEventListener("click", event => {
      if (event.detail === 0) playKey(key, `color-${index}`);
    });

    colorLayer.appendChild(element);
  });

  patternGaps.forEach((gap) => {
    const element = document.createElement("span");
    element.className = `pattern-gap pattern-gap-${gap.letter.toLowerCase()}`;
    element.style.setProperty("--x", String(gap.gapIndex + 1));
    element.textContent = gap.letter;
    patternLayer.appendChild(element);
  });

  stage.append(cycleOverlay, patternLayer, whiteRow, colorLayer);
  els.keyboard.appendChild(stage);
}

function circlePointPosition(relativePitchClass, radius, center) {
  const angle = Math.PI / 2 - 2 * Math.PI * relativePitchClass;
  return {
    x: center + radius * Math.cos(angle),
    y: center - radius * Math.sin(angle),
  };
}

function renderCircle(scale) {
  els.keyboard.innerHTML = "";
  els.keyboard.classList.add("circle-surface");

  const center = 310;
  const ringRadius = 220;
  const labelRadius = 260;
  const pointRadius = 18;
  const rows = cycleRowsForCurrentView(scale, { usePreview: true });
  const renderedRows = visibleCircleRows(rows, ringRadius);
  const cycleRows = selectedCycleRows(scale, { usePreview: true });
  const segmentKinds = cycleSegmentKinds(cycleRows, scale);
  const deformationInfo = circleDeformationInfoForScale(scale);
  const container = document.createElement("div");
  container.className = "circle-stage";

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 620 620");
  svg.setAttribute("class", "scale-circle-svg");
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", "Scale pitches");
  const tonicGeneratorIndex = rows[0]?.fromGeneratorIndex ?? 0;

  const playCircleTone = async (row, index, raised) => {
    const frequency = raised ? row.frequency * scale.period : row.frequency;
    const summary = `${raised ? "Raised scale tone" : "Scale tone"} at ${displayNumber(frequency)} Hz`;
    if (!await playScaleTone(`circle-${index}-${raised ? "raised" : "plain"}`, frequency, summary)) return;
    activateKeyboardPitch(row.pitchClass, row.displayDegree);
    renderExplorerSurface(scale);
    afterDelay(() => {
      deactivateKeyboardPitch(row.pitchClass, row.displayDegree);
      renderExplorerSurface(scale);
    }, cycleSpacing() * 900);
  };

  const commitCircleDeformation = (nextGeneratorValue) => {
    const committedGeneratorValue = clamp(
      nextGeneratorValue,
      deformationInfo?.minimum ?? nextGeneratorValue,
      deformationInfo?.maximum ?? nextGeneratorValue
    );
    clearCircleDeformationState();

    if (Math.abs(committedGeneratorValue - scale.generatorValue) <= 1e-10) {
      renderExplorerSurface(scale);
      return;
    }

    // A drag edits the applied scale, independently of unfinished builder inputs.
    const drafts = [generatorFields, stepFields].map(fields => readInputs(fields));
    const baselines = [appliedInputs?.generator, appliedInputs?.step];
    const nextScale = applyMode(preserveStepLabels(buildScaleFromGenerator({
      period: scale.period, generatorMode: "log", generatorInput: String(committedGeneratorValue),
      baseFrequency: scale.baseFrequency, cardinality: scale.cardinality,
    }), scale), scale.mode);
    stopPlaybackUi("");
    state.scale = nextScale;
    state.activeBuildMethod = "generator";
    syncGeneratorControlsFromScale(nextScale);
    syncStepControlsFromScale(nextScale);
    render();
    rememberAppliedInputs();
    drafts.forEach((draft, index) => {
      for (const [key, value] of Object.entries(draft)) {
        if (baselines[index] && value !== baselines[index][key]) els[key].value = value;
      }
    });
    renderStepInputMode();
    renderPending();
    setSummary(`Deformed scale applied at log_p(g) = ${displayNumber(committedGeneratorValue, 6)}`);
    recordEdit();
  };

  const ring = document.createElementNS(svgNS, "circle");
  ring.setAttribute("class", "circle-ring");
  ring.setAttribute("cx", String(center));
  ring.setAttribute("cy", String(center));
  ring.setAttribute("r", String(ringRadius));
  svg.appendChild(ring);

  if (cycleRows.length > 1) {
    segmentKinds.forEach((segment) => {
      const row = cycleRows.find((item) => item.displayDegree === segment.from);
      const next = cycleRows.find((item) => item.displayDegree === segment.to);
      if (!row || !next) return;
      const point = circlePointPosition(row.relativePitchClass, ringRadius, center);
      const nextPoint = circlePointPosition(next.relativePitchClass, ringRadius, center);
      const line = document.createElementNS(svgNS, "line");
      const isActive =
        state.activeCycleSegment &&
        state.activeCycleSegment.from === segment.from &&
        state.activeCycleSegment.to === segment.to;
      line.setAttribute(
        "class",
        `circle-generator-line ${segment.kind}${isActive ? " active" : ""}`
      );
      line.setAttribute("x1", String(point.x));
      line.setAttribute("y1", String(point.y));
      line.setAttribute("x2", String(nextPoint.x));
      line.setAttribute("y2", String(nextPoint.y));
      svg.appendChild(line);
    });
  }

  renderedRows.forEach((row) => {
    const point = circlePointPosition(row.relativePitchClass, ringRadius, center);
    const labelPoint = circlePointPosition(row.relativePitchClass, labelRadius, center);

    const node = document.createElementNS(svgNS, "circle");
    node.setAttribute("class", "circle-point");
    if (state.activeDisplayDegrees.has(String(row.displayDegree))) node.classList.add("active");
    node.setAttribute("cx", String(point.x));
    node.setAttribute("cy", String(point.y));
    node.setAttribute("r", String(pointRadius));
    svg.appendChild(node);

    const hit = document.createElementNS(svgNS, "circle");
    hit.setAttribute("class", "circle-hit");
    hit.setAttribute("cx", String(point.x));
    hit.setAttribute("cy", String(point.y));
    hit.setAttribute("r", "28");
    hit.setAttribute("tabindex", "0");
    hit.setAttribute("role", "button");
    hit.setAttribute("aria-label", `Degree ${row.displayDegree}, ${displayNumber(row.frequency)} Hz. Enter to play; Shift+Enter one period higher.`);
    hit.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        void playCircleTone(row, row.displayDegree, event.shiftKey);
      }
    });
    hit.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();

      const circleRect = svg.getBoundingClientRect();
      const centerPoint = {
        x: circleRect.left + circleRect.width / 2,
        y: circleRect.top + circleRect.height / 2,
      };
      const generatorDistance = row.generatorOrderIndex ?? mod(
        row.fromGeneratorIndex - tonicGeneratorIndex,
        scale.cardinality
      );
      const dragSession = {
        pointerId: event.pointerId,
        row,
        index: row.displayDegree,
        raised: event.shiftKey,
        startX: event.clientX,
        startY: event.clientY,
        centerPoint,
        generatorDistance,
        alphaStart: state.circleDeformation.previewGeneratorValue ?? scale.generatorValue,
        startedDrag: false,
        lastAngle: angleFromPointer(event.clientX, event.clientY, centerPoint),
        accumulatedTurns: 0,
      };

      state.circleDeformation.dragSession = dragSession;

      const handlePointerMove = (moveEvent) => {
        if (moveEvent.pointerId !== dragSession.pointerId || state.circleDeformation.dragSession !== dragSession) {
          return;
        }

        const distance = Math.hypot(
          moveEvent.clientX - dragSession.startX,
          moveEvent.clientY - dragSession.startY
        );

        if (!dragSession.startedDrag) {
          if (distance < CIRCLE_DRAG_THRESHOLD_PX) {
            return;
          }

          if (!deformationInfo || generatorDistance === 0) {
            dragSession.suppressedClick = true;
            return;
          }

          dragSession.startedDrag = true;
          dragSession.suppressedClick = true;
        }

        const angle = angleFromPointer(
          moveEvent.clientX,
          moveEvent.clientY,
          dragSession.centerPoint
        );
        dragSession.accumulatedTurns +=
          normalizeAngleDelta(angle - dragSession.lastAngle) / (2 * Math.PI);
        dragSession.lastAngle = angle;

        const previewValue = clamp(
          dragSession.alphaStart -
            (CIRCLE_DRAG_GAIN * dragSession.accumulatedTurns) / dragSession.generatorDistance,
          deformationInfo.minimum,
          deformationInfo.maximum
        );

        if (Math.abs(previewValue - (state.circleDeformation.previewGeneratorValue ?? scale.generatorValue)) <= 1e-10) {
          return;
        }

        state.circleDeformation.previewGeneratorValue = previewValue;
        renderExplorerSurface(scale);
        renderIntervalPanel(scale, { usePreview: true });
      };

      const finishInteraction = async (upEvent, cancelled = false) => {
        if (upEvent.pointerId !== dragSession.pointerId) {
          return;
        }

        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerCancel);
        if (state.circleDeformation.dragSession !== dragSession) return;
        state.circleDeformation.dragSession = null;

        if (cancelled) {
          clearCircleDeformationState();
          renderExplorerSurface(scale);
          renderIntervalPanel(scale);
          return;
        }

        if (dragSession.startedDrag) {
          const committedValue =
            state.circleDeformation.previewGeneratorValue ?? dragSession.alphaStart;
          commitCircleDeformation(committedValue);
          return;
        }

        clearCircleDeformationState();
        if (!dragSession.suppressedClick) {
          await playCircleTone(row, row.displayDegree, dragSession.raised || upEvent.shiftKey);
        } else {
          renderExplorerSurface(scale);
          renderIntervalPanel(scale);
        }
      };

      const handlePointerUp = (upEvent) => {
        void finishInteraction(upEvent, false);
      };
      const handlePointerCancel = (cancelEvent) => {
        void finishInteraction(cancelEvent, true);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerCancel);
    });
    svg.appendChild(hit);

    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("class", "circle-label");
    label.setAttribute("x", String(labelPoint.x));
    label.setAttribute("y", String(labelPoint.y));
    const primaryLabel = keyboardLabel(
      {
        role: "scale",
        displayDegree: row.displayDegree,
        displayFrequency: row.frequency,
        pitchClass: row.pitchClass,
      },
      scale,
      els.labelMode.value
    );
    label.textContent = primaryLabel;
    svg.appendChild(label);
  });

  container.appendChild(svg);
  els.keyboard.appendChild(container);
}

function shiftedKeyLabel(key) {
  const shifted = {
    ",": "<",
    ".": ">",
    "/": "?",
    ";": ":",
    "'": "\"",
    "[": "{",
    "]": "}",
  };
  if (!key) return "";
  return shifted[key] ?? key.toUpperCase();
}

function normalizedComputerKey(event) {
  const shiftedPunctuation = {
    "<": ",",
    ">": ".",
    "?": "/",
    ":": ";",
    "\"": "'",
    "{": "[",
    "}": "]",
  };
  const key = event.key.length === 1 ? event.key : "";
  return shiftedPunctuation[key] ?? key.toLowerCase();
}

function renderExplorerSurface(scale) {
  if (state.explorerView === "circle") {
    renderCircle(scale);
  } else {
    renderKeyboard(scale);
  }
}

function render() {
  const scale = state.scale;
  renderBuildMethod();
  renderExplorerView();
  renderPending();
  els.exportData.disabled = !scale;
  els.exportScala.disabled = !scale;
  els.playCycle.disabled = !scale;
  if (!scale) {
    updateScaleNamePlaceholder(null);
    els.generatorSpanLine.textContent = "";
    els.patternLine.textContent = "";
    els.cyclePatternLine.textContent = "";
    els.cycleFoldingLine.textContent = "";
    els.analysisPanel.innerHTML = "";
    els.intervalPanel.innerHTML = "";
    els.keyboard.innerHTML = "";
    return;
  }

  renderModeSelect(scale);
  renderCycleStepOptions(scale);
  renderCosetOptions(scale);
  updateScaleNamePlaceholder(scale);
  renderAnalysisPanel(scale);
  els.generatorSpanLine.textContent = String(trueGeneratorSpan(scale));
  els.patternLine.textContent = scale.displayStepWord || scale.stepWord || "";
  els.cyclePatternLine.textContent = cyclePatternText(scale);
  els.cycleFoldingLine.textContent = cycleFoldingText(scale);
  renderIntervalPanel(scale);
  renderExplorerSurface(scale);
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("input, textarea, select") ||
    target.isContentEditable
  );
}

function stopPlaybackUi(message = "Playback stopped.") {
  audioEpoch += 1;
  clearCircleDeformationState();
  uiTimers.forEach(timer => clearTimeout(timer));
  uiTimers.clear();
  audio.stopAll();
  pointerNotes.clear();
  ringingPointerNotes.clear();
  state.activeKeyboardKeys.clear();
  state.activeCycleSegment = null;
  state.activePitchClasses.clear();
  state.activeDisplayDegrees.clear();
  if (state.scale) {
    renderExplorerSurface(state.scale);
  } else {
    els.keyboard.innerHTML = "";
  }
  setSummary(message);
}

function cycleSpacing() {
  return 60 / state.tempo;
}
function updateTempoHint() {
  els.tempoInput.title = `${cycleSpacing().toFixed(3)} seconds per beat; one cycle note per beat`;
}
function applyTempo() {
  const tempo = Number(els.tempoInput.value);
  if (!Number.isFinite(tempo) || tempo < 30 || tempo > 500) {
    els.tempoInput.value = String(state.tempo);
    setStatus("Enter a tempo from 30 to 500 BPM.");
    updateTempoHint();
    return;
  }
  stopPlaybackUi("");
  state.tempo = tempo;
  setStatus("");
  updateTempoHint();
}

async function playCycleSequence(rows, label) {
  if (!state.scale || rows.length === 0) return;
  stopPlaybackUi("");
  const epoch = audioEpoch;
  if (!await prepareSound(epoch)) return;
  state.activeCycleSegment = null;
  const interval = cycleSpacing();
  audio.schedulePlayback(rows, {
    timbre: els.timbreSelect.value,
    duration: interval,
    interval,
    onStep: (row) => {
      const degree = row.displayDegree ?? row.scaleDegree;
      state.activeCycleSegment =
        row.segmentFrom === null || row.segmentFrom === undefined
          ? null
          : { from: row.segmentFrom, to: row.segmentTo };
      setSummary(`${label}: degree ${degree} at ${displayNumber(row.frequency)} Hz`);
      activateKeyboardPitch(row.activePitchClass ?? row.pitchClass, degree);
      renderExplorerSurface(state.scale);
      afterDelay(() => {
        deactivateKeyboardPitch(row.activePitchClass ?? row.pitchClass, degree);
        renderExplorerSurface(state.scale);
      }, interval * 900);
    },
  });
  afterDelay(() => {
    state.activeCycleSegment = null;
    renderExplorerSurface(state.scale);
  }, interval * 1000 * Math.max(1, rows.length));
}

async function handleComputerKeyDown(event) {
  if (state.explorerView !== "keyboard" || !state.scale || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  if (isEditableTarget(event.target)) return;
  const key = normalizedComputerKey(event);
  const { whiteKeys, blackKeys } = keyboardItems(state.scale);
  const index = KEYBOARD_KEYS.indexOf(key);
  const activeKey = event.shiftKey ? `shift:${key}` : key;
  const note = event.shiftKey
    ? blackKeys.find((item) => item.gapIndex === index)
    : whiteKeys[index];
  if (index === -1 || !note || state.activeKeyboardKeys.has(activeKey)) return;

  event.preventDefault();
  const epoch = audioEpoch;
  state.activeKeyboardKeys.set(activeKey, note);
  if (!await prepareSound(epoch) || state.activeKeyboardKeys.get(activeKey) !== note) {
    if (state.activeKeyboardKeys.get(activeKey) === note) state.activeKeyboardKeys.delete(activeKey);
    return;
  }
  activateKeyboardPitch(note.pitchClass, note.displayDegree);
  renderHeldNotes();

  audio.startSustainedNote(`computer:${activeKey}`, [note.frequency], {
    timbre: els.timbreSelect.value,
  });
  setSummary(`Computer key ${event.shiftKey ? "Shift+" : ""}${key}: ${keySummary(note)}`);
}

function handleComputerKeyUp(event) {
  const key = normalizedComputerKey(event);
  const releases = event.key === "Shift"
    ? [...state.activeKeyboardKeys.keys()].filter(active => active.startsWith("shift:"))
    : [key, `shift:${key}`];
  let changed = false;
  for (const active of releases) {
    const released = state.activeKeyboardKeys.get(active);
    if (!released) continue;
    changed = true;
    state.activeKeyboardKeys.delete(active);
    audio.stopSustainedNote(`computer:${active}`);
    deactivateKeyboardPitch(released.pitchClass, released.displayDegree);
  }
  if (!changed) return;
  renderHeldNotes();
}

function handleBuildApplyKeyDown(event) {
  if (event.key !== "Enter" || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
    return;
  }
  if (!(event.target instanceof HTMLElement)) {
    return;
  }

  const generatorPanel = event.target.closest("#generator-build-panel");
  const stepPanel = event.target.closest("#step-build-panel");
  if (!generatorPanel && !stepPanel) {
    return;
  }

  event.preventDefault();
  if (stepPanel && !stepPanel.classList.contains("hidden")) {
    els.applyStepBuild.click();
    return;
  }
  if (generatorPanel && !generatorPanel.classList.contains("hidden")) {
    els.applyGenerator.click();
  }
}

els.buildGenerator.addEventListener("click", () => {
  state.buildMethod = "generator";
  render();
});

els.buildStep.addEventListener("click", () => {
  state.buildMethod = "step";
  render();
});

els.viewKeyboard.addEventListener("click", () => {
  state.explorerView = "keyboard";
  stopPlaybackUi("");
  render();
});

els.viewCircle.addEventListener("click", () => {
  state.explorerView = "circle";
  stopPlaybackUi("");
  render();
});

els.applyGenerator.addEventListener("click", () => {
  rebuildScale({
    method: "generator",
    resetCycleSelection: true,
    preserveGeneratorCardinality: false,
  });
});
els.applyStepBuild.addEventListener("click", () => {
  rebuildScale({
    method: "step",
    resetCycleSelection: true,
    preserveGeneratorCardinality: false,
  });
});
els.modeSelect.addEventListener("change", () => {
  if (!state.scale) return;
  const mode = currentModeValue();
  stopPlaybackUi("");
  state.scale = applyMode(state.scale, mode);
  render();
  recordEdit();
});
els.modeOrder.addEventListener("change", () => {
  const nextOrder = els.modeOrder.value;
  if (nextOrder === state.modeOrder || !state.scale) {
    state.modeOrder = nextOrder;
    render();
    return;
  }

  const modulus = state.scale.cardinality;
  const currentCycle = Number(els.cycleStep.value || 1);
  const span = trueGeneratorSpan(state.scale);
  const inverseSpan = modularInverse(span, modulus);
  const nextCycle =
    nextOrder === MODE_ORDERS.generator
      ? mod(currentCycle * inverseSpan, modulus)
      : mod(currentCycle * span, modulus);

  state.modeOrder = nextOrder;
  els.cycleStep.value = String(nextCycle === 0 ? modulus : nextCycle);
  state.cycleStepTouched = true;
  stopPlaybackUi("");
  render();
  recordEdit();
});
els.cycleStep.addEventListener("change", () => {
  state.cycleStepTouched = true;
  stopPlaybackUi("");
  render();
  recordEdit();
});
els.cosetSelect.addEventListener("change", () => { stopPlaybackUi(""); render(); recordEdit(); });

els.labelMode.addEventListener("change", render);
els.generatorMode.addEventListener("change", () => {
  const previousMode = appliedInputs?.generator.generatorMode || "generator";
  const nextMode = els.generatorMode.value;
  const oldMode = els.generatorMode.dataset.previous || previousMode;
  try {
    const period = fieldValue(els.periodInput, evaluateExpression);
    if (!(period > 1)) throw new Error("Period must be greater than 1 to convert the generator.");
    const entered = fieldValue(els.generatorInput, evaluateExpression);
    const converted = oldMode === "generator" ? Math.log(entered) / Math.log(period) : period ** entered;
    if (!Number.isFinite(converted) || !(converted > 0)) throw new Error("Enter a positive generator value before changing units.");
    els.generatorInput.value = editableNumber(converted, 15);
    els.generatorMode.dataset.previous = nextMode;
    if (appliedInputs && els.periodInput.value === appliedInputs.generator.periodInput) {
      const applied = appliedInputs.generator;
      const original = oldMode === "generator" ? state.scale?.generator : state.scale?.generatorValue;
      if (original !== undefined && Math.abs(entered - original) < 1e-12) {
        applied.generatorMode = nextMode;
        applied.generatorInput = els.generatorInput.value;
      }
    }
    clearInputErrors();
    setStatus("");
    renderPending();
    automaticallyBuild("generatorMode", true);
    automaticEditField = null;
  } catch (error) {
    els.generatorMode.value = oldMode;
    reportInputError(error);
  }
});
els.stepInputMode.addEventListener("change", () => {
  const oldMode = els.stepInputMode.dataset.previous || "ratio";
  const nextMode = els.stepInputMode.value;
  try {
    const n = Number(els.stepCardinalityInput.value);
    const p = Number(els.typeACountInput.value);
    if (!Number.isInteger(n) || n < 2 || n > 60 || !Number.isInteger(p) || p < 0 || p > n) throw new Error("Enter valid step counts before changing input mode.");
    let a = 1 / n;
    let b = 1 / n;
    if (p > 0 && p < n) {
      if (oldMode === "ratio") {
        const ratioA = fieldValue(els.ratioAInput, evaluateExpression);
        const ratioB = fieldValue(els.ratioBInput, evaluateExpression);
        if (!(ratioA > 0 && ratioB > 0)) throw new Error("Step proportions must be positive.");
        const total = p * ratioA + (n - p) * ratioB;
        a = ratioA / total;
        b = ratioB / total;
      } else {
        a = fieldValue(els.typeASizeInput, evaluateExpression);
        b = (1 - p * a) / (n - p);
        if (!(a > 0 && b > 0)) throw new Error("Positive step sizes are needed to switch to proportion input.");
      }
    }
    if (nextMode === "size") els.typeASizeInput.value = editableNumber(a, 15);
    else { els.ratioAInput.value = editableNumber(a / b, 15); els.ratioBInput.value = "1"; }
    els.stepInputMode.dataset.previous = nextMode;
    if (state.scale && n === state.scale.cardinality && p === state.scale.summary.typeACount &&
        Math.abs(a - state.scale.summary.typeASize) < 1e-12 &&
        els.stepPeriodInput.value === appliedInputs?.step.stepPeriodInput &&
        els.stepBaseFrequencyInput.value === appliedInputs?.step.stepBaseFrequencyInput) {
      appliedInputs.step = readInputs(stepFields);
    }
    clearInputErrors();
    setStatus("");
    automaticallyBuild("stepInputMode", true);
    automaticEditField = null;
  } catch (error) {
    els.stepInputMode.value = oldMode;
    reportInputError(error);
  }
  renderStepInputMode();
  renderPending();
});
els.timbreSelect.addEventListener("change", async () => {
  stopPlaybackUi("");
  if (await prepareSound()) setSummary(`Timbre: ${els.timbreSelect.selectedOptions?.[0]?.textContent ?? els.timbreSelect.value}`);
});
els.tempoInput.addEventListener("change", applyTempo);
els.tempoInput.addEventListener("keydown", event => {
  if (event.key === "Enter") { event.preventDefault(); applyTempo(); }
});
els.exportScala.addEventListener("click", () => {
  if (!state.scale) return;
  const { filename, content } = buildScalaContent(state.scale);
  downloadTextFile(filename, content, "text/plain;charset=utf-8");
  setSummary(`Exported ${filename}`);
});
els.exportData.addEventListener("click", () => {
  if (!state.scale) return;
  const { filename, content } = buildScaleDataContent(state.scale);
  downloadTextFile(filename, content, "text/plain;charset=utf-8");
  setSummary(`Exported ${filename}`);
});
els.importData.addEventListener("click", () => {
  els.importDataFile.click();
});
els.importDataFile.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const metadata = parseScaleDataContent(text);
    importScaleData(metadata);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    els.importDataFile.value = "";
  }
});

els.playCycle.addEventListener("click", () => {
  if (!state.scale) return;
  const rows = cyclePlaybackEvents(state.scale);
  const step = Number(els.cycleStep.value || 1);
  const groups = selectedCycleGroups(state.scale);
  const cosetIndex = Number(els.cosetSelect.value || 0);
  const label =
    groups.length > 1 ? `cycle ${step}, coset ${cosetIndex}` : `cycle ${step}`;
  playCycleSequence(rows, label);
});
els.stopPlayback.addEventListener("click", () => stopPlaybackUi());

function restoreHistorySnapshot(saved) {
  // Undo mathematical edits without moving the user's view or changing sound preferences.
  restoreSavedSession({ ...saved, view: state.explorerView, labelMode: els.labelMode.value,
    timbre: els.timbreSelect.value, tempo: state.tempo, volume: Number(els.volume.value) }, false);
}
els.undo.addEventListener("click", () => {
  const previous = history.undo();
  if (previous) restoreHistorySnapshot(previous);
});
els.redo.addEventListener("click", () => {
  const next = history.redo();
  if (next) restoreHistorySnapshot(next);
});
window.addEventListener("keydown", event => {
  if (event.key === "Escape") { stopPlaybackUi(); return; }
  const textEditing = event.target instanceof HTMLElement && (event.target.closest('input, textarea') || event.target.isContentEditable);
  if (textEditing || !(event.metaKey || event.ctrlKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === "z" || key === "y") {
    event.preventDefault();
    if (key === "y" || event.shiftKey) els.redo.click();
    else els.undo.click();
  }
});
window.addEventListener("blur", () => stopPlaybackUi(""));
document.addEventListener("visibilitychange", () => { if (document.hidden) stopPlaybackUi(""); });
function automaticallyBuild(field, reportErrors = false) {
  const fields = state.buildMethod === "generator" ? generatorFields : stepFields;
  if (!fields.includes(field) || !appliedInputs) return;
  if (JSON.stringify(readInputs(fields)) === JSON.stringify(appliedInputs[state.buildMethod])) {
    clearInputErrors();
    setStatus("");
    return;
  }
  rebuildScale({ method: state.buildMethod, automaticField: field, reportErrors });
}
for (const key of [...generatorFields, ...stepFields]) {
  // Unit selectors must convert their values before rebuilding.
  if (["generatorMode", "stepInputMode"].includes(key)) continue;
  els[key].addEventListener("input", () => {
    if (automaticEditField !== key) automaticEditField = null;
    els[key].removeAttribute("aria-invalid");
    automaticallyBuild(key);
    renderPending();
  });
  els[key].addEventListener("change", () => {
    automaticallyBuild(key, true);
    automaticEditField = null;
  });
  els[key].addEventListener("blur", () => { automaticEditField = null; });
}
els.scaleNameInput.addEventListener("change", recordEdit);
els.volume.addEventListener("input", () => audio.setVolume(Number(els.volume.value)));

window.addEventListener("keydown", handleComputerKeyDown);
window.addEventListener("keydown", handleBuildApplyKeyDown);
window.addEventListener("keyup", handleComputerKeyUp);
window.addEventListener("pointerup", releasePointerNote);
window.addEventListener("pointercancel", releasePointerNote);

updateTempoHint();
renderStepInputMode();
rebuildScale({ syncPanels: true, resetCycleSelection: true });
