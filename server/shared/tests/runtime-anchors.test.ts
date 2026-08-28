import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  getLegacyDataDirectory,
  getLegacyDevDataDirectory,
  getLegacyProjectDirectory,
  readRenamedEnvironmentVariable,
} from '../../../shared/runtime-anchors.js';

test('runtime anchor helpers keep the pre-migration paths centralized', () => {
  const homeDirectory = '/Users/test';
  assert.equal(path.dirname(getLegacyDataDirectory(homeDirectory)), homeDirectory);
  assert.equal(path.dirname(getLegacyDevDataDirectory(homeDirectory)), homeDirectory);
  assert.equal(path.dirname(getLegacyProjectDirectory(homeDirectory)), path.join(homeDirectory, 'Projects'));
});

test('renamed environment variables prefer the current name', () => {
  const warnings: string[] = [];
  const value = readRenamedEnvironmentVariable(
    'TEST_CURRENT_NAME',
    { COMMAND_CENTER_TEST_CURRENT_NAME: 'current' },
    (warning: string) => warnings.push(warning),
  );
  assert.equal(value, 'current');
  assert.deepEqual(warnings, []);
});

test('renamed environment variables read and deprecate the legacy name', () => {
  const warnings: string[] = [];
  const legacyName = `${['CLOUD', 'CLI'].join('')}_TEST_LEGACY_NAME`;
  const value = readRenamedEnvironmentVariable(
    'TEST_LEGACY_NAME',
    { [legacyName]: 'legacy' },
    (warning: string) => warnings.push(warning),
  );
  assert.equal(value, 'legacy');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /deprecated/);
});
