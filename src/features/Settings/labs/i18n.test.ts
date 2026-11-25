import { describe, expect, it } from 'vitest';

import enUS from '../../../../locales/en-US/labs.json';
import zhCN from '../../../../locales/zh-CN/labs.json';
import { ALL_LAB_FEATURES } from './features';

/**
 * CUST-009 gate (test time): every lab in the catalog must be fully translated
 * in the two locales shipped by hand, because the Labs page and the admin
 * deployment matrix both render straight from `ALL_LAB_FEATURES`.
 *
 * A missing key would show the raw key in the toggle title (and the admin row
 * would be unreadable), so this is asserted against the locale files instead of
 * a rendered component.
 */
const LOCALES: Record<string, Record<string, string>> = {
  'en-US': enUS as Record<string, string>,
  'zh-CN': zhCN as Record<string, string>,
};

/** Every `labs` namespace key the catalog drives. */
const requiredKeys = (): string[] => {
  const keys = new Set<string>(['description', 'title']);

  for (const feature of ALL_LAB_FEATURES) {
    keys.add(`features.${feature.i18nKey}.title`);
    keys.add(`features.${feature.i18nKey}.desc`);
    if (feature.noteI18nKey) keys.add(`features.${feature.noteI18nKey}.note`);

    // The stage badge is rendered per row from the same catalog entry.
    keys.add(`stage.${feature.stage}.label`);
    keys.add(`stage.${feature.stage}.desc`);
  }

  // The Labs page groups its rows; the admin matrix needs no group copy.
  keys.add('group.general');
  keys.add('group.workspace');
  keys.add('group.desktop');

  return [...keys].sort();
};

describe('Labs catalog i18n', () => {
  const keys = requiredKeys();

  it('requires a title and a description for every lab', () => {
    // Guards the derivation above: an empty catalog would make every locale
    // assertion below pass vacuously.
    expect(keys.length).toBeGreaterThan(ALL_LAB_FEATURES.length * 2);
  });

  for (const [locale, messages] of Object.entries(LOCALES)) {
    it(`defines every required key in ${locale}`, () => {
      const missing = keys.filter((key) => typeof messages[key] !== 'string');
      const blank = keys.filter((key) => messages[key]?.trim() === '');

      expect(
        [...missing, ...blank],
        [
          `Missing or empty ${locale} labs keys: ${[...missing, ...blank].join(', ')}`,
          'Fix: packages/locales/src/default/labs.ts mirrors en-US; add the same keys to',
          `locales/${locale}/labs.json (en-US and zh-CN are shipped by hand, never generated).`,
        ].join('\n'),
      ).toEqual([]);
    });
  }
});
