import {
  KEYBOARD_KEYS,
  analysisPanelData,
  applyMode,
  buildScaleFromGenerator,
  buildScaleFromStepStructure,
  circleRows,
  cycleGroupsForCircle,
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
} from "./scale.js?v=11";
import { AudioEngine } from "./audio.js?v=2";

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
  duration: 0.75,
  scale: null,
  cycleStepTouched: false,
  activeKeyboardKeys: new Map(),
  activePitchClasses: new Set(),
  activeDisplayDegrees: new Set(),
  activeCycleSegment: null,
};

const audio = new AudioEngine();

const els = {
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
  durationSlider: document.querySelector("#duration-slider"),
  durationReadout: document.querySelector("#duration-readout"),
  keyboard: document.querySelector("#keyboard"),
  analysisPanel: document.querySelector("#analysis-panel"),
  statusLine: document.querySelector("#status-line"),
  generatorSpanLine: document.querySelector("#generator-span-line"),
  patternLine: document.querySelector("#pattern-line"),
  cyclePatternLine: document.querySelector("#cycle-pattern-line"),
  intervalPanel: document.querySelector("#interval-panel"),
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

function generatorCycleDefaultStep(scale) {
  const rows = circleRows(scale);
  const tonicGeneratorIndex = rows[0]?.fromGeneratorIndex ?? 0;
  const generatorRow = rows.find((row) => {
    const distance =
      ((row.fromGeneratorIndex - tonicGeneratorIndex) % scale.cardinality + scale.cardinality) %
      scale.cardinality;
    return distance === 1;
  });
  return generatorRow?.displayDegree ?? 1;
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
    audio.stopAll();
    if (state.activeBuildMethod === "generator") {
      refreshCardinalityOptions();
    }
    state.scale = buildCurrentScale();
    state.cycleStepTouched = false;
    state.activeKeyboardKeys.clear();
    state.activePitchClasses.clear();
    state.activeDisplayDegrees.clear();
    state.activeCycleSegment = null;
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

function renderCycleStepOptions(scale) {
  const previous = Number(els.cycleStep.value || 2);
  els.cycleStep.innerHTML = "";
  for (let step = 1; step < scale.cardinality; step += 1) {
    const option = document.createElement("option");
    option.value = String(step);
    option.textContent = String(step);
    els.cycleStep.appendChild(option);
  }
  const fallback = generatorCycleDefaultStep(scale);
  const nextValue =
    state.cycleStepTouched && previous >= 1 && previous < scale.cardinality ? previous : fallback;
  els.cycleStep.value = String(nextValue);
}

function selectedCycleGroups(scale) {
  return cycleGroupsForCircle(scale, Number(els.cycleStep.value || 1));
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

function selectedCycleRows(scale) {
  const groups = selectedCycleGroups(scale);
  const cosetIndex = Number(els.cosetSelect.value || 0);
  return groups[cosetIndex] ?? groups[0] ?? [];
}

function cycleSegmentKinds(rows) {
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

function cyclePatternText(scale) {
  const rows = selectedCycleRows(scale);
  const segments = cycleSegmentKinds(rows);
  return segments
    .map((segment) => {
      if (segment.kind === "small") return "Y";
      return "X";
    })
    .join("");
}

function cycleIntervalRows(scale) {
  const rows = selectedCycleRows(scale);
  const segments = cycleSegmentKinds(rows);
  const kinds = [...new Set(segments.map((segment) => segment.kind))];
  const orderedKinds = ["large", "small", "single"].filter((kind) => kinds.includes(kind));

  return orderedKinds.map((kind) => {
    const segment = segments.find((item) => item.kind === kind);
    const gap = segment?.gap ?? 0;
    const ratio = scale.period ** gap;
    const cents = 1200 * gap * Math.log2(scale.period);
    return {
      kind,
      label: kind === "large" ? "Large" : kind === "small" ? "Small" : "Single",
      raw: displayNumber(ratio, 6),
      cents: displayNumber(cents, 3),
    };
  });
}

function renderIntervalPanel(scale) {
  els.intervalPanel.innerHTML = "";
  const rows = cycleIntervalRows(scale);

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
  state.activePitchClasses.delete(String(pitchClass));
  if (displayDegree !== null && displayDegree !== undefined) {
    state.activeDisplayDegrees.delete(String(displayDegree));
  }
}

async function playScaleTone(noteId, frequency, summary) {
  await audio.resume();
  audio.playTransient(noteId, [frequency], {
    timbre: els.timbreSelect.value,
    duration: Number(els.durationSlider.value),
  });
  setSummary(summary);
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
  const visibleCycleRows = cycleRows.filter((row) => row.displayDegree < scale.cardinality);
  const pointForDegree = (degree) => ({
    x: (degree + 0.5) * 68,
    y: 34,
  });

  if (visibleCycleRows.length > 1) {
    visibleCycleRows.forEach((row, index) => {
      const next = visibleCycleRows[(index + 1) % visibleCycleRows.length];
      const point = pointForDegree(row.displayDegree);
      const nextPoint = pointForDegree(next.displayDegree);
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
    await playScaleTone(`${indexPrefix}-${key.id}`, key.frequency, keySummary(key));
    activateKeyboardPitch(key.pitchClass, key.displayDegree);
    renderExplorerSurface(scale);
    setTimeout(() => {
      deactivateKeyboardPitch(key.pitchClass, key.displayDegree);
      renderExplorerSurface(scale);
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

  const rows = circleRows(scale);
  const cycleRows = selectedCycleRows(scale);
  const segmentKinds = cycleSegmentKinds(cycleRows);
  const container = document.createElement("div");
  container.className = "circle-stage";

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 620 620");
  svg.setAttribute("class", "scale-circle-svg");

  const center = 310;
  const ringRadius = 220;
  const labelRadius = 260;
  const pointRadius = 18;

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

  rows.forEach((row, index) => {
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
    hit.addEventListener("mousedown", async (event) => {
      event.preventDefault();
      const raised = event.shiftKey;
      const frequency = raised ? row.frequency * scale.period : row.frequency;
      const summary = `${raised ? "Raised scale tone" : "Scale tone"} at ${displayNumber(frequency)} Hz`;
      await playScaleTone(`circle-${index}-${raised ? "raised" : "plain"}`, frequency, summary);
      activateKeyboardPitch(row.pitchClass, row.displayDegree);
      renderExplorerSurface(scale);
      setTimeout(() => {
        deactivateKeyboardPitch(row.pitchClass, row.displayDegree);
        renderExplorerSurface(scale);
      }, Number(els.durationSlider.value) * 900);
    });
    svg.appendChild(hit);

    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("class", "circle-label");
    label.setAttribute("x", String(labelPoint.x));
    label.setAttribute("y", String(labelPoint.y));
    label.textContent = keyboardLabel(
      {
        role: "scale",
        displayDegree: row.displayDegree,
        displayFrequency: row.frequency,
        pitchClass: row.pitchClass,
      },
      scale,
      els.labelMode.value
    );
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
  if (!scale) {
    els.generatorSpanLine.textContent = "";
    els.patternLine.textContent = "";
    els.cyclePatternLine.textContent = "";
    els.analysisPanel.innerHTML = "";
    els.intervalPanel.innerHTML = "";
    els.keyboard.innerHTML = "";
    return;
  }

  renderModeSelect(scale);
  renderCycleStepOptions(scale);
  renderCosetOptions(scale);
  renderAnalysisPanel(scale);
  els.generatorSpanLine.textContent = String(generatorCycleDefaultStep(scale));
  els.patternLine.textContent = scale.displayStepWord || scale.stepWord || "";
  els.cyclePatternLine.textContent = cyclePatternText(scale);
  renderIntervalPanel(scale);
  renderExplorerSurface(scale);
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("input, textarea, select, button") ||
    target.isContentEditable
  );
}

function stopPlaybackUi(message = "Playback stopped.") {
  audio.stopAll();
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

async function playCycleSequence(rows, label) {
  if (!state.scale || rows.length === 0) return;
  await audio.resume();
  state.activeCycleSegment = null;
  const interval = Math.max(0.12, Number(els.durationSlider.value) * 0.48);
  audio.schedulePlayback(rows, {
    timbre: els.timbreSelect.value,
    duration: Math.max(Number(els.durationSlider.value), interval * 1.25),
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
      setTimeout(() => {
        deactivateKeyboardPitch(row.activePitchClass ?? row.pitchClass, degree);
        renderExplorerSurface(state.scale);
      }, interval * 900);
    },
  });
  setTimeout(() => {
    state.activeCycleSegment = null;
    renderExplorerSurface(state.scale);
  }, interval * 1000 * Math.max(1, rows.length));
}

async function handleComputerKeyDown(event) {
  if (state.explorerView !== "keyboard" || !state.scale) return;
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
  activateKeyboardPitch(note.pitchClass, note.displayDegree);
  renderExplorerSurface(state.scale);

  const frequencies = [...state.activeKeyboardKeys.values()].map((item) => item.frequency);
  audio.startSustainedNote("computer", frequencies, {
    timbre: els.timbreSelect.value,
  });
  setSummary(`Computer key ${event.shiftKey ? "Shift+" : ""}${key}: ${keySummary(note)}`);
}

function handleComputerKeyUp(event) {
  if (state.explorerView !== "keyboard") return;
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
    deactivateKeyboardPitch(released.pitchClass, released.displayDegree);
  }

  if (state.activeKeyboardKeys.size === 0) {
    audio.stopSustainedNote("computer");
  } else {
    const frequencies = [...state.activeKeyboardKeys.values()].map((item) => item.frequency);
    audio.startSustainedNote("computer", frequencies, {
      timbre: els.timbreSelect.value,
    });
  }

  renderExplorerSurface(state.scale);
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
  render();
});

els.viewCircle.addEventListener("click", () => {
  state.explorerView = "circle";
  state.activeKeyboardKeys.clear();
  audio.stopSustainedNote("computer");
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
els.cycleStep.addEventListener("change", () => {
  state.cycleStepTouched = true;
  render();
});
els.cosetSelect.addEventListener("change", render);
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

window.addEventListener("keydown", handleComputerKeyDown);
window.addEventListener("keyup", handleComputerKeyUp);

els.durationReadout.textContent = Number(els.durationSlider.value).toFixed(2);
renderStepInputMode();
rebuildScale({ syncPanels: true });
