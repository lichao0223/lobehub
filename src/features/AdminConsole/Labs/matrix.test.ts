import { describe, expect, it } from 'vitest';

import { ALL_LAB_FEATURES } from '@/features/Settings/labs/features';
import { labPreferSelectors } from '@/store/user/slices/preference/selectors/labPrefer';

import {
  getLabExtraSwitches,
  getLabMatrixRows,
  getLabRowAvailability,
  getLabRowBadges,
  LAB_EXTRA_COPY_STEM,
  LAB_FLAG_READ_ONLY,
  type LabMatrixRow,
} from './matrix';

const extraRows = (rows: LabMatrixRow[]) =>
  rows.flatMap((row) => (row.kind === 'extra' ? [row] : []));

describe('admin Labs matrix', () => {
  it('renders every upstream lab feature once, in upstream order', () => {
    const rows = getLabMatrixRows();

    // The matrix mirrors the catalog exactly: same length, same order, no extras.
    expect(rows).toHaveLength(ALL_LAB_FEATURES.length);
    expect(rows.map(({ flag }) => flag)).toEqual(ALL_LAB_FEATURES.map(({ flag }) => flag));
    expect(new Set(rows.map(({ flag }) => flag)).size).toBe(rows.length);
    expect(extraRows(rows)).toEqual([]);
  });

  it('keeps labs the current deployment hides (business / desktop / workspace only)', () => {
    const rows = getLabMatrixRows();
    const flags = new Set(rows.map(({ flag }) => flag));

    for (const feature of ALL_LAB_FEATURES) {
      expect(flags.has(feature.flag)).toBe(true);
    }

    // The user-facing list filters business-only labs; the admin matrix must not.
    expect(ALL_LAB_FEATURES.some(({ businessOnly }) => businessOnly)).toBe(true);
  });

  it('lists selectors that have no Labs settings entry outside the matrix', () => {
    const matrixFlags = new Set<string>(getLabMatrixRows().map(({ flag }) => flag));
    const flags = new Set(ALL_LAB_FEATURES.map(({ flag }) => flag));
    const expectedExtras = (Object.keys(labPreferSelectors) as string[])
      .filter((flag) => !flags.has(flag))
      .sort();

    expect(getLabExtraSwitches().map(({ flag }) => flag)).toEqual(expectedExtras);
    // Separating them keeps the matrix row count equal to the upstream catalog.
    for (const flag of expectedExtras) expect(matrixFlags.has(flag)).toBe(false);
    // Upstream has no Labs page entry for this flag; it is the regression anchor
    // for "a selector can still be controlled here".
    expect(expectedExtras).toContain('enableTaskVerify');
  });

  it('derives the rows only from the upstream catalog and selectors', () => {
    const known = new Set<string>([
      ...ALL_LAB_FEATURES.map(({ flag }) => flag),
      ...Object.keys(labPreferSelectors),
    ]);

    for (const row of [...getLabMatrixRows(), ...getLabExtraSwitches()]) {
      expect(known.has(row.flag)).toBe(true);
    }
  });
});

describe('admin Labs row availability', () => {
  const businessRow: LabMatrixRow = {
    feature: {
      businessOnly: true,
      flag: 'enableTopicBugReport',
      i18nKey: 'topicBugReport',
      searchKeywords: [],
      stage: 'alpha',
    },
    flag: 'enableTopicBugReport',
    kind: 'feature',
  };

  it('marks business-only labs unavailable until the deployment enables business features', () => {
    expect(getLabRowAvailability(businessRow, false)).toEqual({
      readOnly: false,
      unavailable: true,
    });
    expect(getLabRowAvailability(businessRow, true)).toEqual({
      readOnly: false,
      unavailable: false,
    });
  });

  it('marks page collaboration read-only because a deployment gate also applies', () => {
    const row = getLabMatrixRows().find(({ flag }) => flag === 'enablePageCollab')!;

    expect(LAB_FLAG_READ_ONLY.enablePageCollab).toBe('pageCollabDeployment');
    expect(getLabRowAvailability(row, true)).toEqual({ readOnly: true, unavailable: false });
  });

  it('leaves plain labs editable', () => {
    const row = getLabMatrixRows().find(({ flag }) => flag === 'enableProjects')!;

    expect(getLabRowAvailability(row, false)).toEqual({ readOnly: false, unavailable: false });
  });

  it('never marks selector-only rows unavailable', () => {
    const row = getLabExtraSwitches().find(({ flag }) => flag === 'enableTaskVerify')!;

    expect(getLabRowAvailability(row, false)).toEqual({ readOnly: false, unavailable: false });
  });
});

describe('admin Labs row badges', () => {
  const rowOf = (flag: string) => {
    const row = getLabMatrixRows().find((candidate) => candidate.flag === flag);
    if (!row) throw new Error(`No matrix row for ${flag}`);
    return row;
  };

  const extraOf = (flag: string) => {
    const row = getLabExtraSwitches().find((candidate) => candidate.flag === flag);
    if (!row) throw new Error(`No selector-only row for ${flag}`);
    return row;
  };

  it('labels a lab upstream narrows to the desktop shell', () => {
    expect(rowOf('enableDesktopSplitView').kind).toBe('feature');
    expect(getLabRowBadges(rowOf('enableDesktopSplitView'))).toEqual(['desktopOnly']);
    expect(getLabRowBadges(rowOf('enableImessage'))).toEqual(['desktopOnly']);
  });

  it('labels workspace-only and business-only labs', () => {
    expect(getLabRowBadges(rowOf('enablePageCollab'))).toEqual(['workspaceOnly', 'businessOnly']);
    expect(getLabRowBadges(rowOf('enableTopicBugReport'))).toEqual(['businessOnly']);
  });

  it('labels every selector-only row, with or without upstream copy', () => {
    // `enableTaskVerify` has upstream copy, but its switch still exists only
    // here, so the row keeps the "no settings entry" marker.
    expect(extraOf('enableTaskVerify').kind).toBe('extra');
    expect(getLabRowBadges(extraOf('enableTaskVerify'))).toEqual(['noSettingsEntry']);

    const undocumented = getLabExtraSwitches().find((row) => !(row.flag in LAB_EXTRA_COPY_STEM));
    if (undocumented) expect(getLabRowBadges(undocumented)).toEqual(['noSettingsEntry']);
  });

  it('describes every narrowing badge the catalog can produce', () => {
    // A lab flagged in the catalog must render a badge, otherwise the admin
    // matrix silently claims the experiment is available everywhere.
    const narrowed = ALL_LAB_FEATURES.filter(
      ({ businessOnly, desktopOnly, workspaceOnly }) =>
        businessOnly || desktopOnly || workspaceOnly,
    );

    expect(narrowed.length).toBeGreaterThan(0);
    for (const feature of narrowed) {
      const row = getLabMatrixRows().find(({ flag }) => flag === feature.flag)!;
      expect(getLabRowBadges(row).length).toBeGreaterThan(0);
    }
  });

  it('gives plain labs no narrowing badge', () => {
    expect(getLabRowBadges(rowOf('enableProjects'))).toEqual([]);
    expect(getLabRowBadges(rowOf('enableSelfLearning'))).toEqual([]);
  });

  it('resolves upstream copy for every selector it declares copy for', () => {
    // The map is read by the admin page through `features.${stem}.title`; a
    // stale entry would render a raw locale key.
    for (const [flag, stem] of Object.entries(LAB_EXTRA_COPY_STEM)) {
      expect(extraOf(flag).kind, `${flag} is no longer a selector-only row`).toBe('extra');
      expect(stem).toMatch(/^[a-z][\w]*$/);
    }
  });
});
