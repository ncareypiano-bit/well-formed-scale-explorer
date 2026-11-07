import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMode, buildScaleFromGenerator, buildScaleFromStepStructure,
  circleRows, cycleGroupsForCircle, cycleIntervalLetter, keyboardItems, preserveStepLabels,
} from './scale.js';

const build = (ratioA, ratioB, cardinality = 7, typeACount = 5) => buildScaleFromStepStructure({
  period: 2, baseFrequency: 220, cardinality, typeACount,
  inputMode: 'ratio', ratioA: String(ratioA), ratioB: String(ratioB),
});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('A/B words and counts survive size reversal and equality in every mode', () => {
  const reference = build(2, 1);
  for (const [a, b] of [[2, 1], [1, 1], [1, 2]]) {
    const scale = build(a, b);
    assert.equal(scale.stepWord, reference.stepWord);
    assert.equal(scale.summary.typeACount, 5);
    assert.equal(scale.summary.typeBCount, 2);
    close(scale.summary.ratio, a / b);
    assert.equal(scale.summary.degenerate, a === b);
    for (let mode = 0; mode < 7; mode++) {
      const modal = applyMode(scale, mode);
      assert.equal(modal.displayStepWord, scale.stepWord.slice(mode) + scale.stepWord.slice(0, mode));
      const rows = circleRows(modal);
      rows.forEach((row, i) => {
        const gap = (rows[(i + 1) % 7].relativePitchClass - row.relativePitchClass + 1) % 1;
        close(gap, modal.displayStepWord[i] === 'A' ? scale.summary.typeASize : scale.summary.typeBSize);
      });
      const keys = keyboardItems(modal);
      assert.equal(keys.blackKeys.length, a === b ? 0 : 2 * (a > b ? 5 : 2));
      for (const key of keys.blackKeys) {
        assert.ok(key.pitchClass > keys.whiteKeys[key.gapIndex].pitchClass);
        assert.ok(key.pitchClass < keys.whiteKeys[key.gapIndex + 1].pitchClass);
      }
    }
  }
});

test('a/b compositions obey a-b = A-B for all admissible structures through N=60', () => {
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  for (let n = 2; n <= 60; n++) {
    for (let p = 1; p < n; p++) {
      if (gcd(n, p) !== 1) continue;
      const scales = [[2, 1], [1, 1], [1, 2]].map(([a, b]) => applyMode(build(a, b, n, p), n - 1));
      for (let span = 1; span < n; span++) {
        let referenceLetters;
        for (const scale of scales) {
          const values = { a: [], b: [] };
          const letters = [];
          const rows = circleRows(scale);
          for (let i = 0; i < n; i++) {
            const j = (i + span) % n;
            const letter = cycleIntervalLetter(scale, i, j);
            letters.push(letter);
            values[letter].push((rows[j].relativePitchClass - rows[i].relativePitchClass + 1) % 1);
          }
          if (referenceLetters) assert.deepEqual(letters, referenceLetters);
          referenceLetters = letters;
          assert.ok(values.a.length && values.b.length);
          for (const letter of ['a', 'b']) values[letter].forEach(value => close(value, values[letter][0]));
          close(values.a[0] - values.b[0], scale.summary.typeASize - scale.summary.typeBSize);
        }
      }
    }
  }
});

test('selected cosets keep their composition label even when only one type occurs', () => {
  const scale = applyMode(build(1, 2, 5, 2), 0);
  // Also verify the non-coprime cycle case using a composite cardinality.
  const composite = applyMode(build(1, 2, 8, 3), 2);
  for (const s of [scale, composite]) {
    for (let span = 1; span < s.cardinality; span++) {
      for (const group of cycleGroupsForCircle(s, span)) {
        for (let i = 0; i < group.length; i++) {
          const from = group[i].displayDegree;
          const to = group[(i + 1) % group.length].displayDegree;
          assert.equal(cycleIntervalLetter(s, from, to), cycleIntervalLetter(s, from, (from + span) % s.cardinality));
        }
      }
    }
  }
});

test('generator deformation retains identities through equality and into A<B', () => {
  let previous = buildScaleFromGenerator({period: 2, generatorMode: 'log', generatorInput: '0.585', baseFrequency: 220, cardinality: 7});
  const word = previous.stepWord;
  for (const tau of [4 / 7, 0.56]) {
    previous = preserveStepLabels(buildScaleFromGenerator({period: 2, generatorMode: 'log', generatorInput: String(tau), baseFrequency: 220, cardinality: 7}), previous);
    assert.equal(previous.stepWord, word);
    assert.equal(previous.summary.typeACount, 5);
  }
  assert.ok(previous.summary.typeASize < previous.summary.typeBSize);
});

test('unlabeled equal-step scales and the existing collapsed boundary stay normalized', () => {
  for (const p of [0, 7]) {
    const scale = build(1, 1, 7, p);
    close(scale.stepPattern.reduce((sum, x) => sum + x, 0), 1);
    assert.equal(keyboardItems(applyMode(scale, 0)).blackKeys.length, 0);
  }
  const boundary = buildScaleFromStepStructure({period: 2, baseFrequency: 220, cardinality: 7, typeACount: 5, inputMode: 'size', typeASize: '1/5'});
  close(boundary.stepPattern.reduce((sum, x) => sum + x, 0), 1);
});
