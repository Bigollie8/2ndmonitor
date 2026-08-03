import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldPinTopBar } from './topBar';
import type { TopBarPinInputs } from './topBar';

const NONE: TopBarPinInputs = {
  editMode: false,
  showSettings: false,
  showContentLibrary: false,
  showSwitcher: false,
  showOnboarding: false,
  showShortcuts: false,
  menuOpen: false,
};

test('shouldPinTopBar: nothing open → not pinned', () => {
  assert.equal(shouldPinTopBar(NONE), false);
});

test('shouldPinTopBar: each condition alone pins the bar', () => {
  for (const key of Object.keys(NONE) as (keyof TopBarPinInputs)[]) {
    assert.equal(shouldPinTopBar({ ...NONE, [key]: true }), true, `${key} should pin`);
  }
});

test('shouldPinTopBar: bar-local menuOpen composes with App-level flags', () => {
  assert.equal(shouldPinTopBar({ ...NONE, menuOpen: true }), true);
  assert.equal(shouldPinTopBar({ ...NONE, editMode: true, menuOpen: true }), true);
});
