import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MAX_AUDIO_BYTES, panelTiming, readComicAudio } from './comic-video';

test('two minutes across eight panels gives exactly fifteen seconds each', () => {
  for (let i = 0; i < 8; i++) assert.deepEqual(panelTiming(120, 8, i), { start: i * 15, duration: 15 });
});

test('fractional audio duration is covered without gaps, overlap or a shortened final panel', () => {
  const duration = 17.123456789;
  let previousEnd = 0;
  for (let i = 0; i < 24; i++) {
    const frame = panelTiming(duration, 24, i);
    assert.ok(Math.abs(frame.start - previousEnd) < 1e-12);
    assert.ok(Math.abs(frame.duration - duration / 24) < 1e-12);
    previousEnd = frame.start + frame.duration;
  }
  assert.equal(previousEnd, duration);
});

test('a single panel fills the complete audio duration', () => {
  assert.deepEqual(panelTiming(4.25, 1, 0), { start: 0, duration: 4.25 });
});

test('invalid durations, panel counts and indices fail explicitly', () => {
  for (const duration of [0, -1, NaN, Infinity]) assert.throws(() => panelTiming(duration, 4, 0));
  for (const count of [0, -1, 1.5, NaN]) assert.throws(() => panelTiming(30, count, 0));
  for (const index of [-1, 4, 0.5, NaN]) assert.throws(() => panelTiming(30, 4, index));
});

test('empty and oversized files are rejected before browser decoding', async () => {
  await assert.rejects(readComicAudio(new File([], 'empty.wav')), /empty/);
  await assert.rejects(readComicAudio({ size: MAX_AUDIO_BYTES + 1 } as File), /100 MB/);
});
