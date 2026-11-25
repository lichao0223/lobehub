import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFERENCE } from '@/const/user';

import { defaultFlagValue, flagsFingerprint, toSparseFlags } from './draft';

describe('admin Labs draft', () => {
  it('reads the upstream default for a flag', () => {
    expect(defaultFlagValue('enableOAuthApps')).toBe(
      DEFAULT_PREFERENCE.lab?.enableOAuthApps === true,
    );
    expect(defaultFlagValue('enableProjects')).toBe(false);
    expect(defaultFlagValue('not-a-real-flag')).toBe(false);
  });

  it('stores only values that differ from the upstream default', () => {
    expect(
      toSparseFlags({
        enableOAuthApps: false, // default is false → not stored
        enableProjects: true, // default is false → stored
      }),
    ).toEqual({ enableProjects: true });
  });

  it('keeps an explicit false for a flag the upstream default turns on', () => {
    const defaultOn = Object.entries(DEFAULT_PREFERENCE.lab ?? {}).find(([, value]) => value);

    if (!defaultOn) return; // upstream has no default-on lab; nothing to assert.

    expect(toSparseFlags({ [defaultOn[0]]: false })).toEqual({ [defaultOn[0]]: false });
  });

  it('treats switch order as irrelevant', () => {
    expect(flagsFingerprint({ enableProjects: true, enableOAuthApps: false })).toBe(
      flagsFingerprint({ enableOAuthApps: false, enableProjects: true }),
    );
  });

  it('is not dirty when a switch is flipped back to its stored value', () => {
    const stored = { enableOAuthApps: false };
    const edited = { ...stored, enableProjects: true };

    expect(flagsFingerprint(edited)).not.toBe(flagsFingerprint(stored));
    expect(flagsFingerprint({ ...edited, enableProjects: false })).toBe(flagsFingerprint(stored));
  });
});
