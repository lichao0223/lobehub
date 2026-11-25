import { describe, expect, it } from 'vitest';

import { labPreferSelectors } from '@/store/user/slices/preference/selectors/labPrefer';

import { ALL_LAB_FEATURES } from './features';

/**
 * CUST-009 gate (test time): the client's lab selectors and the Labs page
 * catalog must not drift apart.
 *
 * The admin console derives its deployment matrix from `ALL_LAB_FEATURES`, so a
 * selector that has no catalog entry is a lab the administrator can no longer
 * switch. The catalog is the single registration point; this gate fails when a
 * new selector arrives without one.
 *
 * A selector that genuinely has no toggle on the Labs page belongs here, with
 * the reason — `enableTaskVerify` is read by the thread UI only.
 */
const NO_SETTINGS_ENTRY_SELECTORS: Record<string, string> = {
  enableTaskVerify: 'no Labs toggle upstream; the admin page renders it as a bare row',
};

describe('Labs catalog', () => {
  it('has an entry for every lab selector', () => {
    const catalog = new Set(ALL_LAB_FEATURES.map(({ flag }) => flag as string));
    const missing = Object.keys(labPreferSelectors).filter(
      (flag) => !catalog.has(flag) && !(flag in NO_SETTINGS_ENTRY_SELECTORS),
    );

    expect(
      missing,
      [
        `Lab selectors without a Labs page entry: ${missing.join(', ')}`,
        'Fix: add the flag to ALL_LAB_FEATURES in src/features/Settings/labs/features.ts,',
        'and add features.<i18nKey>.title/.desc to packages/locales/src/default/labs.ts',
        'plus locales/{en-US,zh-CN}/labs.json.',
        'Or, if it has no toggle on purpose, list it in NO_SETTINGS_ENTRY_SELECTORS above with the reason.',
      ].join('\n'),
    ).toEqual([]);
  });

  it('registers each flag once', () => {
    const flags = ALL_LAB_FEATURES.map(({ flag }) => flag as string);
    const duplicates = flags.filter((flag, index) => flags.indexOf(flag) !== index);

    expect(
      duplicates,
      `Flags registered twice in ALL_LAB_FEATURES: ${duplicates.join(', ')}`,
    ).toEqual([]);
  });

  it('registers each locale stem once', () => {
    const stems = ALL_LAB_FEATURES.map(({ i18nKey }) => i18nKey as string);
    const duplicates = stems.filter((stem, index) => stems.indexOf(stem) !== index);

    expect(
      duplicates,
      `Two labs share a locale stem, so their title/desc copy collides: ${duplicates.join(', ')}`,
    ).toEqual([]);
  });

  it('points every entry at a real selector', () => {
    // `flag` is typed as `keyof typeof labPreferSelectors`, this catches a
    // selector that was deleted upstream while its catalog entry survived.
    const unknown = ALL_LAB_FEATURES.map(({ flag }) => flag as string).filter(
      (flag) => !(flag in labPreferSelectors),
    );

    expect(unknown, `Catalog entries reference missing selectors: ${unknown.join(', ')}`).toEqual(
      [],
    );
  });
});
