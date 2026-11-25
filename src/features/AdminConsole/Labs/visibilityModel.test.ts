import { describe, expect, it } from 'vitest';

import { shouldHideLabs } from './visibilityModel';

describe('shouldHideLabs', () => {
  it('hides the per-user page from a normal user on an admin-managed deployment', () => {
    expect(shouldHideLabs({ isAdmin: false, labsMode: 'admin' })).toBe(true);
    // A missing role flag is never treated as "administrator".
    expect(shouldHideLabs({ labsMode: 'admin' })).toBe(true);
  });

  it('keeps the per-user page for administrators', () => {
    expect(shouldHideLabs({ isAdmin: true, labsMode: 'admin' })).toBe(false);
  });

  it('never hides the page in the upstream user mode', () => {
    expect(shouldHideLabs({ isAdmin: false, labsMode: 'user' })).toBe(false);
    expect(shouldHideLabs({ isAdmin: true, labsMode: 'user' })).toBe(false);
  });

  it('fails open before user state names a mode', () => {
    // `undefined` = user state not loaded yet, or a server predating the field.
    expect(shouldHideLabs({})).toBe(false);
    expect(shouldHideLabs({ isAdmin: false })).toBe(false);
  });
});
