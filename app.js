import {
  KEYBOARD_KEYS,
  analysisPanelData,
  applyMode,
  buildScaleFromGenerator,
  buildScaleFromStepStructure,
  displayNumber,
  editableNumber,
  evaluateExpression,
  formatBaseFrequencyInput,
  keyboardItems,
  keyboardLabel,
  MODE_ORDERS,
  orderedModes,
  parseGeneratorConfiguration,
  parseBaseFrequencyInput,
  playbackRowsForMode,
} from "./scale.js?v=9";
import { AudioEngine } from "./audio.js?v=2";

const state = {
  buildMethod: "generator",
  activeBuildMethod: "generator",
  periodInput: "2",
  generatorMode: "generator",
  generatorInput: "3/2",
  baseFrequencyInput: "174.6141157165",
  cardinality: 7,
  mode: 0,
  modeOrder: MODE_ORDERS.step,
  labelMode: "notes",
  timbre: "organ",
  duration: 0.45,
  keyboardEnabled: true,
  scale: null,
  activeKeyboardKeys: new Map(),
  activePitchClasses: new Set(),
};

const audio = new AudioEngine();

const els = {
  buildGenerator: document.querySelector("#build-generator"),
  buildStep: document.querySelector("#build-step"),
  generatorBuildPanel: document.querySelector("#generator-build-panel"),
  stepBuildPanel: document.querySelector("#step-build-panel"),
  applyGenerator: document.querySelector("#apply-generator"),
  playUp: document.querySelector("#play-up"),
  playDown: document.querySelector("#play-down"),
  playUpDown: document.querySelector("#play-updown"),
  playGeneratorOrder: document.querySelector("#play-generator-order"),
  stopPlayback: document.querySelector("#stop-playback"),
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
  durationSlider: document.querySelector("#duration-slider"),
  durationReadout: document.querySelector("#duration-readout"),
  keyboardEnabled: document.querySelector("#keyboard-enabled"),
  keyboard: document.querySelector("#keyboard"),
  analysisPanel: document.querySelector("#analysis-panel"),
  statusLine: document.querySelector("#status-line"),
  patternLine: document.querySelector("#pattern-line"),
  keyboardLegend: document.querySelector("#keyboard-legend"),
  summaryLine: document.querySelector("#summary-line"),
};

function setStatus(message) {
  els.statusLine.textContent = message;
}

function setSummary(message) {
  els.summaryLine.textContent = message;
}

function renderBuildMethod() {
  const generatorActive = state.buildMethod === "generator";
  els.generatorBuildPanel.classList.toggle("hidden", !generatorActive);
  els.stepBuildPanel.classList.toggle("hidden", generatorActive);
  els.buildGenerator.classList.toggle("is-active", generatorActive);
  els.buildStep.classList.toggle("is-active", !generatorActive);
}

function renderStepInputMode() {
  const ratioMode = els.stepInputMode.value === "ratio";
  els.ratioALabel.classList.toggle("hidden", !ratioMode);
  els.ratioBLabel.classList.toggle("hidden", !ratioMode);
  els.typeASizeLabel.classList.toggle("hidden", ratioMode);
}

function currentModeValue() {
  return Number(els.modeSelect.value || 0);
}

function numericGeneratorInputs() {
  return {
    period: evaluateExpression(els.periodInput.value),
    generatorMode: els.generatorMode.value,
    generatorInput: els.generatorInput.value,
    baseFrequency: parseBaseFrequencyInput(els.baseFrequencyInput.value),
  };
}

function numericStepInputs() {
  return {
    period: evaluateExpression(els.stepPeriodInput.value),
    baseFrequency: parseBaseFrequencyInput(els.stepBaseFrequencyInput.value),
    cardinality: Number(els.stepCardinalityInput.value),
    typeACount: Number(els.typeACountInput.value),
    inputMode: els.stepInputMode.value,
    ratioA: els.ratioAInput.value,
    ratioB: els.ratioBInput.value,
    typeASize: els.typeASizeInput.value,
  };
}

function buildCurrentScale() {
  let baseScale;

  if (state.activeBuildMethod === "step") {
    baseScale = buildScaleFromStepStructure(numericStepInputs());
  } else {
    const parsed = parseGeneratorConfiguration(numericGeneratorInputs());
    baseScale = buildScaleFromGenerator({
      period: parsed.period,
      generatorMode: els.generatorMode.value,
      generatorInput: els.generatorInput.value,
      baseFrequency: parsed.baseFrequency,
      cardinality: Number(els.cardinalityInput.value),
    });
  }

  return applyMode(baseScale, currentModeValue());
}

function populateCardinalityOptions(options, selectedValue) {
  if (options.length === 0) {
    throw new Error("No well-formed cardinalities were found for this generator.");
  }

  const nextValue = options.includes(selectedValue) ? selectedValue : options[0];
  els.cardinalityInput.innerHTML = "";
  options.forEach((value) => {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = String(value);
    els.cardinalityInput.appendChild(option);
  });
  els.cardinalityInput.value = String(nextValue);
  state.cardinality = nextValue;
}

function refreshCardinalityOptions(preferredValue = Number(els.cardinalityInput.value || state.cardinality)) {
  const parsed = parseGeneratorConfiguration(numericGeneratorInputs());
  populateCardinalityOptions(parsed.availableCardinalities, preferredValue);
}

function syncStepControlsFromScale(scale) {
  els.stepPeriodInput.value = editableNumber(scale.period);
  els.stepCardinalityInput.value = String(scale.cardinality);
  els.stepBaseFrequencyInput.value = formatBaseFrequencyInput(scale.baseFrequency);

  if (scale.summary.degenerate) {
    els.typeACountInput.value = String(scale.cardinality);
    els.stepInputMode.value = "size";
    els.ratioAInput.value = "1";
    els.ratioBInput.value = "1";
    els.typeASizeInput.value = editableNumber(1 / scale.cardinality);
  } else {
    els.typeACountInput.value = String(scale.summary.typeACount);
    els.stepInputMode.value = "ratio";
    els.ratioAInput.value = editableNumber(scale.summary.ratio, 8);
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

function rebuildScale({ syncPanels = false } = {}) {
  try {
    if (state.activeBuildMethod === "generator") {
      refreshCardinalityOptions();
    }
    state.scale = buildCurrentScale();
    state.activeKeyboardKeys.clear();
    state.activePitchClasses.clear();
    if (syncPanels) {
      if (state.activeBuildMethod === "generator") {
        syncStepControlsFromScale(state.scale);
      } else {
        syncGeneratorControlsFromScale(state.scale);
      }
    }
    setStatus("");
    render();
  } catch (error) {
    state.scale = null;
    setStatus(error instanceof Error ? error.message : String(error));
    render();
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
  const previous = currentModeValue();
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

function keySummary(key) {
  const prefix = key.role === "color" ? "Auxiliary tone" : "Scale tone";
  return `${prefix} at ${displayNumber(key.displayFrequency)} Hz`;
}

function activateKeyboardPitch(pitchClass) {
  state.activePitchClasses.add(String(pitchClass));
}

function deactivateKeyboardPitch(pitchClass) {
  state.activePitchClasses.delete(String(pitchClass));
}

function renderKeyboard(scale) {
  els.keyboard.innerHTML = "";
  const { whiteKeys, blackKeys, patternGaps } = keyboardItems(scale);
  const mappedKeys = KEYBOARD_KEYS.slice(0, whiteKeys.length);
  els.keyboardLegend.textContent = "";

  const stage = document.createElement("div");
  stage.className = "keyboard-stage";
  stage.style.setProperty("--white-key-count", String(whiteKeys.length));

  const whiteRow = document.createElement("div");
  whiteRow.className = "white-key-row";

  const colorLayer = document.createElement("div");
  colorLayer.className = "color-key-layer";

  const patternLayer = document.createElement("div");
  patternLayer.className = "pattern-layer";

  const playKey = async (key, indexPrefix) => {
    await audio.resume();
    audio.playTransient(`${indexPrefix}-${key.id}`, [key.frequency], {
      timbre: els.timbreSelect.value,
      duration: Number(els.durationSlider.value),
    });
    setSummary(keySummary(key));
    activateKeyboardPitch(key.pitchClass);
    renderKeyboard(scale);
    setTimeout(() => {
      deactivateKeyboardPitch(key.pitchClass);
      renderKeyboard(scale);
    }, Number(els.durationSlider.value) * 900);
  };

  whiteKeys.forEach((key, index) => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "key white-key";
    if (key.highlighted) element.classList.add("highlighted");
    if (state.activePitchClasses.has(String(key.pitchClass))) element.classList.add("active");

    element.innerHTML = `
      <span class="key-degree">${mappedKeys[index] ?? ""}</span>
      <span class="key-label">${keyboardLabel(key, scale, els.labelMode.value)}</span>
    `;

    element.addEventListener("mousedown", async () => {
      playKey(key, `mouse-${index}`);
    });

    whiteRow.appendChild(element);
  });

  blackKeys.forEach((key, index) => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "key color-key";
    element.style.setProperty("--x", String(key.x));
    element.style.setProperty("--w", String(key.width));
    if (state.activePitchClasses.has(String(key.pitchClass))) element.classList.add("active");
    element.innerHTML = `<span class="color-key-degree">${shiftedKeyLabel(mappedKeys[key.gapIndex])}</span>`;

    element.addEventListener("mousedown", async (event) => {
      event.preventDefault();
      playKey(key, `color-${index}`);
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

  stage.append(patternLayer, whiteRow, colorLayer);
  els.keyboard.appendChild(stage);
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

function render() {
  const scale = state.scale;
  renderBuildMethod();
  if (!scale) {
    els.patternLine.textContent = "";
    els.keyboardLegend.textContent = "";
    els.analysisPanel.innerHTML = "";
    els.keyboard.innerHTML = "";
    return;
  }

  renderModeSelect(scale);
  renderAnalysisPanel(scale);
  els.patternLine.textContent = "";
  renderKeyboard(scale);
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("input, textarea, select, button") ||
    target.isContentEditable
  );
}

async function playSequence(mode) {
  if (!state.scale) return;
  await audio.resume();
  const rows = playbackRowsForMode(state.scale, mode);
  const interval = Math.max(0.1, Number(els.durationSlider.value) * 0.44);
  audio.schedulePlayback(rows, {
    timbre: els.timbreSelect.value,
    duration: Math.max(Number(els.durationSlider.value), interval * 1.2),
    interval,
    onStep: (row) => {
      setSummary(`${mode}: degree ${row.scaleDegree} at ${displayNumber(row.frequency)} Hz`);
      activateKeyboardPitch(row.pitchClass);
      renderKeyboard(state.scale);
      setTimeout(() => {
        deactivateKeyboardPitch(row.pitchClass);
        renderKeyboard(state.scale);
      }, interval * 900);
    },
  });
}

async function handleComputerKeyDown(event) {
  if (!els.keyboardEnabled.checked || !state.scale) return;
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
  await audio.resume();
  state.activeKeyboardKeys.set(activeKey, note);
  activateKeyboardPitch(note.pitchClass);
  renderKeyboard(state.scale);

  const frequencies = [...state.activeKeyboardKeys.values()].map((item) => item.frequency);
  audio.startSustainedNote("computer", frequencies, {
    timbre: els.timbreSelect.value,
  });
  setSummary(`Computer key ${event.shiftKey ? "Shift+" : ""}${key}: ${keySummary(note)}`);
}

function handleComputerKeyUp(event) {
  if (isEditableTarget(event.target)) return;
  const key = normalizedComputerKey(event);
  if (event.key === "Shift") {
    for (const activeKey of [...state.activeKeyboardKeys.keys()]) {
      if (activeKey.startsWith("shift:")) {
        const released = state.activeKeyboardKeys.get(activeKey);
        state.activeKeyboardKeys.delete(activeKey);
        if (released) deactivateKeyboardPitch(released.pitchClass);
      }
    }
  }

  const activeKey = event.shiftKey ? `shift:${key}` : key;
  const fallbackShiftKey = `shift:${key}`;
  const releaseKey = state.activeKeyboardKeys.has(activeKey)
    ? activeKey
    : fallbackShiftKey;
  if (!state.activeKeyboardKeys.has(releaseKey)) return;
  event.preventDefault();

  const released = state.activeKeyboardKeys.get(releaseKey);
  state.activeKeyboardKeys.delete(releaseKey);
  if (released) {
    deactivateKeyboardPitch(released.pitchClass);
  }

  if (state.activeKeyboardKeys.size === 0) {
    audio.stopSustainedNote("computer");
  } else {
    const frequencies = [...state.activeKeyboardKeys.values()].map((item) => item.frequency);
    audio.startSustainedNote("computer", frequencies, {
      timbre: els.timbreSelect.value,
    });
  }

  renderKeyboard(state.scale);
}

els.buildGenerator.addEventListener("click", () => {
  state.buildMethod = "generator";
  render();
});

els.buildStep.addEventListener("click", () => {
  state.buildMethod = "step";
  render();
});

els.applyGenerator.addEventListener("click", () => {
  state.activeBuildMethod = "generator";
  rebuildScale({ syncPanels: true });
});
els.applyStepBuild.addEventListener("click", () => {
  state.activeBuildMethod = "step";
  rebuildScale({ syncPanels: true });
});
els.modeSelect.addEventListener("change", () => rebuildScale());
els.modeOrder.addEventListener("change", () => {
  state.modeOrder = els.modeOrder.value;
  render();
});
els.cardinalityInput.addEventListener("change", () => {
  state.activeBuildMethod = "generator";
  rebuildScale({ syncPanels: true });
});
els.labelMode.addEventListener("change", render);
els.generatorMode.addEventListener("change", () => {
  rebuildScale({ syncPanels: state.activeBuildMethod === "generator" });
});
els.stepInputMode.addEventListener("change", renderStepInputMode);
els.timbreSelect.addEventListener("change", () => {
  setSummary(`Timbre: ${els.timbreSelect.value}`);
});
els.durationSlider.addEventListener("input", () => {
  els.durationReadout.textContent = Number(els.durationSlider.value).toFixed(2);
});

els.playUp.addEventListener("click", () => playSequence("up"));
els.playDown.addEventListener("click", () => playSequence("down"));
els.playUpDown.addEventListener("click", () => playSequence("updown"));
els.playGeneratorOrder.addEventListener("click", () => playSequence("generator"));
els.stopPlayback.addEventListener("click", () => {
  audio.stopAll();
  setSummary("Playback stopped.");
});

window.addEventListener("keydown", handleComputerKeyDown);
window.addEventListener("keyup", handleComputerKeyUp);

els.durationReadout.textContent = Number(els.durationSlider.value).toFixed(2);
renderStepInputMode();
rebuildScale({ syncPanels: true });
