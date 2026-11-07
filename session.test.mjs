import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreSession, EditHistory } from './session.js';
import { applyMode, buildScaleFromStepStructure, evaluateExpression } from './scale.js';

const saved = (a = 2, b = 1, n = 7, p = 5) => {
  const scale = buildScaleFromStepStructure({period: 3, baseFrequency: 220, cardinality: n, typeACount: p, inputMode: 'ratio', ratioA: String(a), ratioB: String(b)});
  return {version: 2, model: {period: scale.period, generatorValue: scale.generatorValue, cardinality: n, baseFrequency: 220, stepWord: scale.stepWord}, mode: n - 1, modeOrder: 'generator', cycle: 1, coset: 0, buildMethod: 'step', generatorMode: 'log', view: 'circle', labelMode: 'cents', timbre: 'organ', tempo: 120, volume: .4, name: 'Example'};
};

test('session round trips preserve labels, frequencies, mode, coset and settings', () => {
  for (const [a, b] of [[2, 1], [1, 1], [1, 2]]) {
    for (const [n, p] of [[7,5], [8,3], [12,5], [19,12]]) {
      const session = saved(a,b,n,p);
      if (n === 8) {session.cycle = 2; session.coset = 1;}
      const restored = restoreSession(JSON.parse(JSON.stringify(session)));
      assert.deepEqual(restored.saved, session);
      assert.equal(restored.scale.stepWord, session.model.stepWord);
      const expected = applyMode(buildScaleFromStepStructure({period: 3, baseFrequency: 220, cardinality: n, typeACount: p, inputMode: 'ratio', ratioA: String(a), ratioB: String(b)}), n - 1);
      assert.equal(restored.scale.displayStepWord, expected.displayStepWord);
      restored.scale.rows.forEach((row, i) => assert.ok(Math.abs(row.frequency - expected.rows[i].frequency) < 1e-8));
      assert.equal(restored.scale.summary.typeACount, p);
    }
  }
});

test('corrupt or inconsistent imports are rejected', () => {
  for (const change of [s => s.model.cardinality = 1000000000, s => s.model.period = 1, s => s.model.stepWord = 'AAAAAAA', s => s.model.stepWord = 'ABAABAA', s => s.mode = 7, s => s.coset = 1, s => s.volume = -1, s => s.tempo = Infinity, s => s.name = 'name\nfield: junk']) {
    const session = saved(); change(session);
    assert.throws(() => restoreSession(session));
  }
});

test('Undo/Redo restores earlier edits, discards a replaced future and ignores duplicate states', () => {
  const history = new EditHistory();
  history.record(saved());
  assert.equal(history.canUndo, false);
  history.record(saved());
  assert.equal(history.canUndo, false);
  history.record(saved(1,2));
  assert.deepEqual(history.undo(), saved());
  assert.deepEqual(history.redo(), saved(1,2));
  history.undo(); history.record(saved(1,1));
  assert.equal(history.canRedo, false);
  assert.deepEqual(history.undo(), saved());
});

test('expressions retain supported mathematics and give readable errors for invalid text', () => {
  for (const [input, expected] of [['3/2', 1.5], ['sqrt(5)', Math.sqrt(5)], ['log(3/2)/log(2)', Math.log2(1.5)], ['2^(-1/12)', 2**(-1/12)], ['1e3',1000], ['goldenratio',(1+Math.sqrt(5))/2]]) assert.ok(Math.abs(evaluateExpression(input)-expected)<1e-10);
  for (const input of ['oops', '3/', 'globalThis', 'Math.random()', 'Infinity', '(()=>1)()']) assert.throws(() => evaluateExpression(input));
});


test('legacy Duration session values convert to BPM without changing note spacing', () => {
  const session = saved();
  delete session.tempo;
  session.duration = .75;
  const restored = restoreSession(session);
  assert.ok(Math.abs(60 / restored.saved.tempo - .36) < 1e-12);
  assert.equal(restored.saved.duration, undefined);
});

test('new instrument choices save; retired timbres import as their replacements', () => {
  for (const timbre of ['piano','marimba','clarinet','organ','sine']) {
    assert.equal(restoreSession({...saved(),timbre}).saved.timbre,timbre);
  }
  assert.equal(restoreSession({...saved(),timbre:'flute'}).saved.timbre,'clarinet');
  assert.equal(restoreSession({...saved(),timbre:'plucked'}).saved.timbre,'marimba');
});
