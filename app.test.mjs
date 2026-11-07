import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as scale from './scale.js';
import * as session from './session.js';

// A small DOM adapter exercises app transactions without replacing scale/session logic.
function app() {
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {};
      this._value = ''; this.className = ''; this.disabled = false; this.textContent = '';
      this.style = {setProperty() {}};
      this.classList = {add() {}, remove() {}, toggle() {}, contains: name => this.className.split(' ').includes(name)};
    }
    set value(value) { this._value = String(value); }
    get value() { return this._value; }
    set innerHTML(value) { this.children = []; if (this.tagName === 'SELECT') this.value = ''; this.html = value; }
    get innerHTML() { return this.html || ''; }
    appendChild(child) { this.children.push(child); if (this.tagName === 'SELECT' && !this.value) this.value = child.value; return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
    click() { if (!this.disabled) this.fire('click'); }
    fire(name, data = {}) { for (const cb of this.listeners[name] || []) cb({target:this, preventDefault(){}, ...data}); }
    focus() { this.focused = true; }
    closest(selector) { return selector.split(',').some(tag => tag.trim().toUpperCase() === this.tagName) ? this : null; }
    querySelectorAll(selector) {
      const all = this.children.flatMap(child => [child, ...child.querySelectorAll(selector)]);
      return all.filter(child => selector === '.key' && child.className.split(' ').includes('key'));
    }
  }
  const elements = {};
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const element = new Element(match[1]); elements[match[3]] = element;
    const value = match[2].match(/\bvalue="([^"]*)"/); if (value) element.value = value[1];
  }
  for (const [id, value] of Object.entries({'generator-mode':'generator', 'step-input-mode':'ratio', 'mode-order':'step', 'label-mode':'notes', 'timbre-select':'clarinet'})) elements[id].value = value;
  elements['scale-name-input'].value = '';
  const windowListeners = {};
  class Audio {
    constructor() { this.stops = 0; this.voices = new Map(); this.context = {currentTime: 10}; }
    get sustained() { return [...this.voices.values()].flat(); }
    stopAll() { this.stops++; this.voices.clear(); }
    stopSustainedNote(id) { this.voices.delete(id); }
    setVolume() {} async resume() {} async ensureInstrument() {} playTransient() {}
    schedulePlayback(rows, options) { this.scheduled = {rows, options}; }
    startSustainedNote(id, frequencies) { this.voices.set(id, frequencies); }
  }
  const document = {
    querySelector: selector => elements[selector.slice(1)],
    querySelectorAll: () => Object.values(elements).filter(element => element.attributes['aria-invalid'] === 'true'),
    createElement: tag => new Element(tag), createElementNS: (ns, tag) => new Element(tag), addEventListener() {},
  };
  const context = vm.createContext({...scale, ...session, AudioEngine: Audio, document, HTMLElement: Element,
    window: {addEventListener(name, cb) { (windowListeners[name] ||= []).push(cb); }},
    setTimeout, clearTimeout, URL, Blob, console,
  });
  const source = fs.readFileSync(new URL('./app.js', import.meta.url),'utf8').replace(/^import[\s\S]*?from ["'][^"'\n]+["'];/gm,'');
  vm.runInContext(source, context);
  return {elements, run: code => vm.runInContext(code, context)};
}

test('invalid builder edits retain the applied scale; modes do not apply drafts', () => {
  const {elements: e, run} = app();
  const before = run('state.scale.generatorValue');
  e['generator-input'].value = 'oops'; e['apply-generator'].click();
  assert.equal(run('state.scale.generatorValue'), before);
  assert.match(e['status-line'].textContent, /number.*ratio/);
  assert.equal(e['generator-input'].getAttribute('aria-invalid'), 'true');
  e['mode-select'].value = '3'; e['mode-select'].fire('change');
  assert.equal(run('state.scale.generatorValue'), before);
  assert.equal(run('state.scale.mode'), 3);
  assert.equal(e['generator-input'].value, 'oops');
});

test('generator unit switching converts the field and preserves the applied tuning', () => {
  const {elements: e, run} = app();
  const before = run('state.scale.generatorValue');
  e['generator-mode'].value = 'log'; e['generator-mode'].fire('change');
  assert.ok(Math.abs(Number(e['generator-input'].value) - before) < 1e-14);
  assert.equal(run('state.scale.generatorValue'), before);
  e['generator-mode'].value = 'generator'; e['generator-mode'].fire('change');
  assert.ok(Math.abs(Number(e['generator-input'].value)-1.5)<1e-14);
  assert.equal(run('state.scale.cardinality'), 7);
});

test('Undo/Redo restores an applied scale and its labels, not the default', () => {
  const {elements: e, run} = app();
  e['generator-input'].value = '1.49'; e['apply-generator'].click();
  const previous = run('state.scale.generatorValue');
  e['generator-input'].value = '1.48'; e['apply-generator'].click();
  const current = run('state.scale.generatorValue');
  e['undo-edit'].click(); assert.ok(Math.abs(run('state.scale.generatorValue') - previous) < 1e-14);
  e['redo-edit'].click(); assert.ok(Math.abs(run('state.scale.generatorValue') - current) < 1e-14);
});

test('export ignores draft inputs and import restores the complete applied session atomically', () => {
  const {elements: e, run} = app();
  e['mode-select'].value = '3'; e['mode-select'].fire('change');
  e['cycle-step'].value = '4'; e['cycle-step'].fire('change');
  e['generator-input'].value = 'oops';
  const content = run('buildScaleDataContent(state.scale).content');
  assert.match(content, /^WFSE scale data v2/);
  assert.ok(!content.includes('oops'));
  run(`importScaleData(parseScaleDataContent(${JSON.stringify(content)}))`);
  assert.equal(run('state.scale.mode'), 3);
  assert.equal(e['cycle-step'].value, '4');
  assert.equal(e['generator-input'].value, '1.5');
  const before = run('JSON.stringify(snapshot())');
  assert.throws(() => run('importScaleData({session: JSON.stringify({...snapshot(), mode: 100})})'));
  assert.equal(run('JSON.stringify(snapshot())'), before);
});

test('Stop clears held keys and release is handled even when focus has moved', async () => {
  const {elements: e, run} = app();
  await run('handleComputerKeyDown({key:"z", target:null, preventDefault(){}})');
  assert.equal(run('state.activeKeyboardKeys.size'), 1);
  run('handleComputerKeyUp({key:"z", target:els.generatorInput, preventDefault(){}})');
  assert.equal(run('state.activeKeyboardKeys.size'), 0);
  await run('handleComputerKeyDown({key:"z", target:null, preventDefault(){}})');
  e['stop-playback'].click();
  assert.equal(run('state.activeKeyboardKeys.size'), 0);
  assert.equal(run('audio.sustained.length'), 0);
});

test('step input modes convert sizes and cardinality choices build automatically', () => {
  const {elements: e, run} = app();
  const a = run('state.scale.summary.typeASize');
  e['step-input-mode'].value = 'size'; e['step-input-mode'].fire('change');
  assert.ok(Math.abs(Number(e['type-a-size-input'].value) - a) < 1e-12);
  e['step-input-mode'].value = 'ratio'; e['step-input-mode'].fire('change');
  assert.ok(Math.abs(Number(e['ratio-a-input'].value) - run('state.scale.summary.ratio')) < 1e-12);
  e['cardinality-input'].value = '5'; e['cardinality-input'].fire('change');
  assert.equal(run('state.scale.cardinality'), 5);
});

test('legacy v1 scale files remain readable without applying unrelated controls', () => {
  const {elements: e, run} = app();
  const metadata = {
    scale_name: 'Old scale', active_build_method: 'generator', selected_mode: '2', mode_order: 'step',
    generator_period: '2', generator_mode: 'generator', generator_input: '3/2', generator_cardinality: '7', generator_base_frequency: 'F3',
    step_period: '2', step_cardinality: '7', step_type_a_count: '5', step_input_mode: 'ratio', step_ratio_a: '2', step_ratio_b: '1', step_type_a_size: '.16', step_base_frequency: '220',
  };
  e['generator-input'].value = 'oops';
  run(`importScaleData(${JSON.stringify(metadata)})`);
  assert.equal(run('state.scale.mode'), 2);
  assert.equal(run('state.scale.generator'), 1.5);
  assert.equal(e['scale-name-input'].value, 'Old scale');
});


test('all four special cycles are labeled in step and generator order', () => {
  const {elements: e, run} = app();
  const options = () => Object.fromEntries(e['cycle-step'].children.map(option => [option.value, option.textContent]));
  let labels = options();
  assert.equal(labels['1'], '1 — step order');
  assert.equal(labels['6'], '6 — reverse step');
  assert.equal(labels['4'], '4 — generator order');
  assert.equal(labels['3'], '3 — reverse generator');
  e['mode-order'].value = 'generator'; e['mode-order'].fire('change');
  labels = options();
  assert.equal(labels['2'], '2 — step order');
  assert.equal(labels['5'], '5 — reverse step');
  assert.equal(labels['1'], '1 — generator order');
  assert.equal(labels['6'], '6 — reverse generator');
  assert.equal(e['cycle-step'].value, '2');
  e['mode-order'].value = 'step'; e['mode-order'].fire('change');
  assert.equal(e['cycle-step'].value, '1');
});

test('interval table uses Large/Small in size order even when A is smaller', () => {
  const {elements: e, run} = app();
  e['ratio-a-input'].value = '1'; e['ratio-b-input'].value = '2';
  e['apply-step-build'].click();
  const rows = JSON.parse(run('JSON.stringify(cycleIntervalRows(state.scale))'));
  assert.deepEqual(rows.map(row => row.label), ['Large', 'Small']);
  assert.ok(Number(rows[0].cents) > Number(rows[1].cents));
});

test('metronome tempo schedules one cycle note per beat', async () => {
  const {elements: e, run} = app();
  assert.equal(e['tempo-input'].value, '160');
  for (const bpm of [60, 120, 160, 240]) {
    e['tempo-input'].value = String(bpm); e['tempo-input'].fire('change');
    await run('playCycleSequence(cyclePlaybackEvents(state.scale), "test")');
    assert.ok(Math.abs(run('audio.scheduled.options.interval') - 60 / bpm) < 1e-12);
    run('stopPlaybackUi("")');
  }
  e['tempo-input'].value = '0'; e['tempo-input'].fire('change');
  assert.equal(e['tempo-input'].value, '240');
  assert.equal(run('state.tempo'), 240);
});

test('sample loading cancels on Stop or key release and reports failures', async () => {
  const {run,elements:e}=app();
  run('let finishSound; audio.ensureInstrument = () => new Promise(resolve => finishSound=resolve);');
  const pending=run('handleComputerKeyDown({key:"z",target:null,preventDefault(){}})');
  run('handleComputerKeyUp({key:"z"}); finishSound();');await pending;
  assert.equal(run('audio.sustained.length'),0);
  const cycle=run('playCycleSequence(cyclePlaybackEvents(state.scale),"test")');
  run('stopPlaybackUi();finishSound();');await cycle;
  assert.equal(run('audio.scheduled'),undefined);
  run('audio.ensureInstrument = async () => {throw new Error("Download failed");};');
  await run('playScaleTone("test",440,"Played")');
  assert.match(e['summary-line'].textContent,/Sound unavailable/);
});

test('screen keys release cleanly during loading and held notes start after loading', async () => {
  const {run}=app();
  run('let finishSound; audio.ensureInstrument = () => new Promise(resolve => finishSound=resolve); let element = document.createElement("button"); let note = keyboardItems(state.scale).whiteKeys[0]; bindKeyboardPointer(element,note);');
  run('element.fire("pointerdown",{pointerId:1,button:0});releasePointerNote({pointerId:1});finishSound();');
  await Promise.resolve();await Promise.resolve();
  assert.equal(run('pointerNotes.size'),0);assert.equal(run('audio.sustained.length'),0);
  run('element.fire("pointerdown",{pointerId:2,button:0});finishSound();');
  await Promise.resolve();await Promise.resolve();
  assert.equal(run('audio.sustained.length'),1);
  run('releasePointerNote({pointerId:2});');assert.equal(run('audio.sustained.length'),0);
});


test('valid generator input builds immediately, preserves typed text and groups typing for Undo', () => {
  const {elements:e,run}=app();
  const before=run('state.scale.generatorValue');
  for(const value of ['1.49','1.48','1.47']) {
    e['generator-input'].value=value;e['generator-input'].fire('input');
    assert.ok(Math.abs(run('state.scale.generator')-Number(value))<1e-12);
    assert.equal(e['generator-input'].value,value);
  }
  assert.equal(run('history.entries.length'),2);
  e['undo-edit'].click();assert.ok(Math.abs(run('state.scale.generatorValue')-before)<1e-12);
  e['redo-edit'].click();assert.ok(Math.abs(run('state.scale.generator')-1.47)<1e-12);
  e['generator-input'].value='1.46';e['generator-input'].fire('input');e['generator-input'].fire('change');
  e['generator-input'].value='1.45';e['generator-input'].fire('input');e['generator-input'].fire('blur');
  e['undo-edit'].click();assert.ok(Math.abs(run('state.scale.generator')-1.46)<1e-12);
});

test('incomplete automatic edits retain the scale and resume building when corrected', () => {
  const {elements:e,run}=app();
  const before=run('state.scale.generatorValue');
  e['generator-input'].value='3/';e['generator-input'].fire('input');
  assert.equal(run('state.scale.generatorValue'),before);
  assert.equal(e['generator-input'].value,'3/');
  assert.match(e['pending-line'].textContent,/last valid scale/);
  assert.equal(e['status-line'].textContent,'');
  e['generator-input'].fire('change');assert.ok(e['status-line'].textContent);
  e['generator-input'].value='3/2';e['generator-input'].fire('input');
  assert.ok(Math.abs(run('state.scale.generator')-1.5)<1e-12);
  assert.equal(e['pending-line'].textContent,'');assert.equal(e['status-line'].textContent,'');
});

test('step ratios, sizes and base frequency update automatically without rewriting the active field', () => {
  const {elements:e,run}=app();e['build-step'].click();
  e['ratio-a-input'].value='1';e['ratio-a-input'].fire('input');
  e['ratio-b-input'].value='2';e['ratio-b-input'].fire('input');
  assert.ok(run('state.scale.summary.typeASize < state.scale.summary.typeBSize'));
  e['step-input-mode'].value='size';e['step-input-mode'].fire('change');
  e['type-a-size-input'].value='0.1000';e['type-a-size-input'].fire('input');
  assert.ok(Math.abs(run('state.scale.summary.typeASize')-.1)<1e-12);
  assert.equal(e['type-a-size-input'].value,'0.1000');
  e['step-base-frequency-input'].value='A4';e['step-base-frequency-input'].fire('input');
  assert.equal(run('state.scale.baseFrequency'),440);
  assert.equal(e['step-base-frequency-input'].value,'A4');
  e['step-cardinality-input'].value='4';e['step-cardinality-input'].fire('input');
  assert.equal(run('state.scale.cardinality'),7);
  e['type-a-count-input'].value='3';e['type-a-count-input'].fire('input');
  assert.equal(run('state.scale.cardinality'),4);
});

test('automatic generator building preserves expressions and notation in every editable field', () => {
  const {elements:e,run}=app();
  e['period-input'].value='2.000';e['period-input'].fire('input');
  assert.equal(e['period-input'].value,'2.000');
  e['base-frequency-input'].value='440/2';e['base-frequency-input'].fire('input');
  assert.equal(e['base-frequency-input'].value,'440/2');assert.equal(run('state.scale.baseFrequency'),220);
  e['generator-input'].value='1.49';e['generator-input'].fire('input');
  assert.equal(e['period-input'].value,'2.000');assert.equal(e['base-frequency-input'].value,'440/2');
});


test('typing back to the starting value removes the redundant Undo step safely', () => {
  const {elements:e,run}=app();
  for(const value of ['1.49','1.5']) {e['generator-input'].value=value;e['generator-input'].fire('input');}
  assert.equal(run('history.entries.length'),1);assert.equal(e['undo-edit'].disabled,true);
  e['generator-input'].value='1.48';e['generator-input'].fire('input');
  e['undo-edit'].click();assert.ok(Math.abs(run('state.scale.generator')-1.5)<1e-12);
});


test('computer chords keep independent voices and release only the released key', async () => {
  const {run}=app();
  await Promise.all(['z','c','b'].map(key=>run(`handleComputerKeyDown({key:${JSON.stringify(key)},target:null,preventDefault(){}})`)));
  assert.equal(run('audio.voices.size'),3);
  assert.equal(run('state.activeKeyboardKeys.size'),3);
  run('handleComputerKeyUp({key:"c"})');
  assert.equal(run('audio.voices.size'),2);
  assert.equal(run('audio.voices.has("computer:z") && audio.voices.has("computer:b")'),true);
  run('stopPlaybackUi()');assert.equal(run('audio.voices.size'),0);
});

test('two simultaneous pointers and a computer key can sound together', async () => {
  const {run}=app();
  run('let keys=keyboardItems(state.scale).whiteKeys; let first=document.createElement("button"); let second=document.createElement("button"); bindKeyboardPointer(first,keys[0]); bindKeyboardPointer(second,keys[2]);');
  run('first.fire("pointerdown",{pointerId:1,button:0});second.fire("pointerdown",{pointerId:2,button:0});');
  await run('handleComputerKeyDown({key:"b",target:null,preventDefault(){}})');
  assert.equal(run('audio.voices.size'),3);
  run('releasePointerNote({pointerId:1});');assert.equal(run('audio.voices.size'),2);
  assert.equal(run('audio.voices.has("pointer:2") && audio.voices.has("computer:b")'),true);
  run('stopPlaybackUi()');
});


test('computer chords work with button focus but leave text editing alone', async () => {
  const {run}=app();
  await run('handleComputerKeyDown({key:"z",target:els.applyGenerator,preventDefault(){}})');
  await run('handleComputerKeyDown({key:"c",target:els.applyGenerator,preventDefault(){}})');
  assert.equal(run('audio.voices.size'),2);
  await run('handleComputerKeyDown({key:"b",target:els.generatorInput,preventDefault(){}})');
  assert.equal(run('audio.voices.size'),2);run('stopPlaybackUi()');
});

test('playing a chord preserves screen key elements and moves focus out of builder inputs', async () => {
  const {run}=app();
  run('let firstKey=els.keyboard.querySelectorAll(".key")[0];');
  run('firstKey.fire("pointerdown",{pointerId:1,button:0,pointerType:"touch"});');
  await run('handleComputerKeyDown({key:"c",target:els.keyboard,preventDefault(){}})');
  assert.equal(run('els.keyboard.focused'),true);
  assert.equal(run('els.keyboard.querySelectorAll(".key")[0] === firstKey'),true);
  run('handleComputerKeyUp({key:"c"});releasePointerNote({pointerId:1});');
  assert.equal(run('audio.voices.size'),0);
});


test('quick mouse clicks overlap visually and Stop cancels their pending gates', async () => {
  const {run}=app();
  run('let screenKeys=els.keyboard.querySelectorAll(".key");screenKeys[0].fire("pointerdown",{pointerId:1,button:0,pointerType:"mouse"});');
  await new Promise(setImmediate);
  run('releasePointerNote({pointerId:1});screenKeys[2].fire("pointerdown",{pointerId:1,button:0,pointerType:"mouse"});');
  await new Promise(setImmediate);
  run('releasePointerNote({pointerId:1});');
  assert.equal(run('ringingPointerNotes.size'),2);
  assert.equal(run('state.activePitchClasses.size'),2);
  run('stopPlaybackUi()');
  assert.equal(run('ringingPointerNotes.size'),0);assert.equal(run('uiTimers.size'),0);
});
