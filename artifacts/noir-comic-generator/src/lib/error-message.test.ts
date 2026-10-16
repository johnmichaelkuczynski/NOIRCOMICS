import test from 'node:test';
import assert from 'node:assert/strict';
import { comicRequestError } from './error-message';

test('style network failures explicitly say generation was not sent', () => {
  assert.match(comicRequestError(new TypeError('Failed to fetch'), 'style'), /No comic generation request was sent/);
});

test('generation network failures do not imply a provider rejection or a safe retry', () => {
  for (const message of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.']) {
    const result = comicRequestError(new TypeError(message), 'generation');
    assert.match(result, /server may still be generating/);
    assert.match(result, /Do not immediately resubmit/);
  }
});

test('provider and validation errors retain their original explanation', () => {
  assert.equal(comicRequestError({ data: { error: 'Venice rejected the generation request.' } }, 'generation'), 'Venice rejected the generation request.');
  assert.equal(comicRequestError(new Error('Could not load the noir style reference.'), 'style'), 'Could not load the noir style reference.');
});

test('HTML gateway pages never appear as raw markup in generation errors', () => {
  for (const status of [502, 503, 504]) {
    const result = comicRequestError({ status, data: '<!DOCTYPE html><title>Bad Gateway</title>' }, 'generation');
    assert.match(result, new RegExp(`HTTP ${status}`));
    assert.doesNotMatch(result, /DOCTYPE|<title>/);
  }
  assert.equal(comicRequestError({ status: 503, data: { error: 'Generation capacity is full.' } }, 'generation'), 'Generation capacity is full.');
});
