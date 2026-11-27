'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useSize } from 'ahooks';
import { useRef } from 'react';

import { sx } from '@/styles/sx';

import { type UsageLevel, usageLevel, type UsageThresholds } from './format';

/**
 * Whole-pixel tick geometry. Splitting the bar into a fixed tick count gives
 * fractional widths that the browser snaps to alternating 3px / 4px ticks, so
 * the count follows the bar width instead.
 */
const SEGMENT_WIDTH = 3;
const SEGMENT_GAP = 1;

/** Ticks that fit a bar of `width` px. */
export const segmentCount = (width: number) =>
  Math.max(0, Math.floor((width + SEGMENT_GAP) / (SEGMENT_WIDTH + SEGMENT_GAP)));

/** Lit ticks for a reading: any non-zero usage lights at least one. */
export const litSegments = (value: number | null | undefined, segments: number) => {
  if (segments <= 0 || value === null || value === undefined || value <= 0) return 0;
  return Math.min(segments, Math.max(1, Math.round((value / 100) * segments)));
};

const styles = stylex.create({
  bar: {
    display: 'flex',
    flexShrink: 0,
    gap: SEGMENT_GAP,
    minWidth: 0,
    width: '100%',
  },
  segment: {
    borderRadius: 1,
    flexShrink: 0,
    width: SEGMENT_WIDTH,
  },
});

export const USAGE_COLOR: Record<UsageLevel, string> = {
  critical: cssVar.colorError,
  high: cssVar.colorWarning,
  normal: cssVar.colorSuccess,
};

/** Text color for a reading — the same green / yellow / red as the bar; no reading keeps the default. */
export const usageTextColor = (level: UsageLevel | undefined) =>
  level ? USAGE_COLOR[level] : undefined;

interface UsageBarProps {
  /** Bar height in px. */
  height?: number;
  /** Where the bar turns yellow / red; CPU-style shares by default. */
  thresholds?: UsageThresholds;
  value: number | null | undefined;
}

/** The segmented bar alone, colored by the normal / high / critical thresholds. */
export const UsageBar = ({ height = 8, thresholds, value }: UsageBarProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const segments = segmentCount(size?.width ?? 0);
  const level = usageLevel(value, thresholds);
  const lit = litSegments(value, segments);
  const color = level ? USAGE_COLOR[level] : cssVar.colorFillSecondary;

  return (
    <div aria-hidden {...sx(styles.bar, { height })} ref={ref}>
      {Array.from({ length: segments }, (_, index) => (
        <span
          {...sx(styles.segment, {
            backgroundColor: index < lit ? color : cssVar.colorFillQuaternary,
            height,
          })}
          key={index}
        />
      ))}
    </div>
  );
};
