import { describe, expect, it } from 'vitest';

import {
  formatPercent,
  LOAD_THRESHOLDS,
  loadPercentOf,
  peakUsageLevel,
  usageLevel,
} from './format';

describe('formatPercent', () => {
  it('rounds a raw metric float to a whole percent', () => {
    // The gateway sends the measured share verbatim: 26.87555344066099.
    expect(formatPercent(26.875_553_440_660_99)).toBe('27%');
    expect(formatPercent(42.093_171_156_095_46)).toBe('42%');
    expect(formatPercent(58.890_880_546_002_7)).toBe('59%');
  });

  it('rounds halves up instead of truncating', () => {
    expect(formatPercent(0.5)).toBe('1%');
    expect(formatPercent(99.5)).toBe('100%');
  });

  it('keeps a missing reading visible as an em dash', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(undefined)).toBe('—');
  });

  it('formats zero as 0%, not as missing', () => {
    expect(formatPercent(0)).toBe('0%');
  });
});

describe('usageLevel', () => {
  it('separates normal, high and critical shares', () => {
    expect(usageLevel(79.9)).toBe('normal');
    expect(usageLevel(80)).toBe('high');
    expect(usageLevel(95)).toBe('critical');
    expect(usageLevel(null)).toBeUndefined();
  });

  it('judges load against its own per-core thresholds', () => {
    expect(usageLevel(120, LOAD_THRESHOLDS)).toBe('high');
    expect(usageLevel(120)).toBe('critical');
  });

  it('takes the hottest of several readings', () => {
    expect(peakUsageLevel(usageLevel(10), usageLevel(85), usageLevel(50))).toBe('high');
    expect(peakUsageLevel(undefined, undefined)).toBeUndefined();
  });
});

describe('loadPercentOf', () => {
  it('expresses load as a share of the cores', () => {
    expect(loadPercentOf(8, 8)).toBe(100);
    expect(loadPercentOf(2, 4)).toBe(50);
  });

  it('is null when the load or the core count is unknown', () => {
    expect(loadPercentOf(null, 8)).toBeNull();
    expect(loadPercentOf(2, null)).toBeNull();
    expect(loadPercentOf(undefined, 8)).toBeNull();
  });
});
