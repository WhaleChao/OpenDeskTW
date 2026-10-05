// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recentPaths, readPreference, writePreference, themePreference, resolvedTheme } from '../src/preferences.mjs';
const stored = value => ({ getItem: () => value });
test('corrupt recent records never interrupt application startup', () => {
  for (const raw of ['{broken', 'null', '{}', '42', '"string"']) assert.deepEqual(recentPaths(stored(raw)), []);
});
test('recent paths reject objects, duplicates and blank entries and limit history', () => {
  const paths = ['a.pdf', {}, '', 'a.pdf', ...Array.from({length:20}, (_,i)=>`file-${i}.docx`)];
  const result = recentPaths(stored(JSON.stringify(paths)));
  assert.equal(result.length,12); assert.equal(result[0],'a.pdf'); assert.equal(new Set(result).size,12);
});
test('storage denial and quota exhaustion retain usable defaults', () => {
  const storage = { getItem(){throw new Error('denied');}, setItem(){throw new Error('quota');} };
  assert.equal(readPreference(storage,'theme','system'),'system'); assert.equal(writePreference(storage,'theme','dark'),false);
  assert.deepEqual(recentPaths(storage),[]); assert.deepEqual(recentPaths(null),[]);
});
test('explicit day and night remain independent of the system preference', () => {
  assert.equal(resolvedTheme('light',true),'light'); assert.equal(resolvedTheme('dark',false),'dark');
  assert.equal(resolvedTheme('system',true),'dark'); assert.equal(resolvedTheme('system',false),'light');
  assert.equal(themePreference('corrupt'),'system');
});
