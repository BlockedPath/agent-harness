import test from 'node:test';
import assert from 'node:assert/strict';
import { hello } from '../src/index.ts';

test('hello', () => {
  assert.equal(hello(), 'hi');
});
