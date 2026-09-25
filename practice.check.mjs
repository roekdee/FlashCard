// Run: node practice.check.mjs — fails loudly if the mode helpers regress.
import assert from 'node:assert/strict';
import { makeCloze, judgeWord, compareSentence, gradeFromRatio, headword } from './practice.js';

assert.equal(makeCloze('The sailors had to abandon the sinking ship.', 'abandon').answer, 'abandon');
assert.equal(makeCloze('They abandoned the house.', 'abandon').answer, 'abandoned');
assert.equal(makeCloze('She studies every night.', 'study').answer, 'studies');
assert.equal(makeCloze('We are making dinner.', 'make').answer, 'making');
assert.equal(makeCloze('He stopped the car.', 'stop').answer, 'stopped');
assert.equal(makeCloze('I keep money in the bank.', 'bank (money)').answer, 'bank');
assert.equal(makeCloze('Nothing to see here.', 'apron'), null);
assert.equal(makeCloze('Scatter the seeds.', 'cat'), null);            // no match inside another word

assert.equal(headword('bank (money)'), 'bank');
assert.equal(judgeWord('Abandon', 'abandon'), 'exact');
assert.equal(judgeWord('abandn', 'abandon'), 'close');
assert.equal(judgeWord('cap', 'cat'), 'wrong');                     // short words must be exact
assert.equal(judgeWord('', 'cat'), 'wrong');
assert.equal(judgeWord('abandoned', ['abandon', 'abandoned']), 'exact');

const full = compareSentence('I have never been to Japan.', 'i have never been to japan');
assert.equal(full.ratio, 1);
const part = compareSentence('I have never been to Japan.', 'I never been Japan');
assert.equal(part.ratio, 4 / 6);
assert.deepEqual(part.words.map((w) => w.hit), [true, false, true, true, false, true]);
assert.equal(compareSentence("Don't worry.", 'dont worry').ratio, 0.5); // apostrophe matters

assert.equal(gradeFromRatio(1), 5);
assert.equal(gradeFromRatio(0.85), 4);
assert.equal(gradeFromRatio(0.6), 3);
assert.equal(gradeFromRatio(0.3), 1);
console.log('practice helpers ok');
