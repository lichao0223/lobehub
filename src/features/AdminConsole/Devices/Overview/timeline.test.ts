import type { DeviceMetricPoint, DeviceMetricSeries } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildMetricTimeline, groupStripBlocks, UPLOAD_GRACE_MS } from './timeline';

const BUCKET = 5 * 60_000;

const point = (
  observedAt: number,
  connected: boolean,
  cpuPercent: number | null = 10,
): DeviceMetricPoint => ({
  connected,
  cpuPercent,
  diskPercent: null,
  diskUsedBytes: null,
  load1: 2,
  memoryPercent: 20,
  memoryUsedBytes: 2048,
  observedAt,
});

const series = (points: DeviceMetricPoint[], to: number): DeviceMetricSeries => ({
  bucketMs: BUCKET,
  cpuCount: 4,
  diskTotalBytes: null,
  from: 0,
  memoryTotalBytes: 4096,
  points,
  to,
});

describe('buildMetricTimeline', () => {
  it('marks connected, disconnected, missing and not-yet-uploaded buckets', () => {
    const timeline = buildMetricTimeline(
      series([point(0, true), point(BUCKET, false), point(6 * BUCKET, true)], 6 * BUCKET),
    );

    expect(timeline.slots.map((slot) => slot.status)).toEqual([
      'online',
      'offline',
      // An upload grace of 10 minutes keeps the last buckets pending.
      'missing',
      'missing',
      'pending',
      'pending',
      'online',
    ]);
  });

  it('keeps the tail pending inside the upload grace window', () => {
    const to = 6 * BUCKET;
    const timeline = buildMetricTimeline(series([point(0, true)], to));

    expect(timeline.slots.at(-1)?.status).toBe('pending');
    // Old enough to be a real gap, not a late upload.
    expect(timeline.slots[1]?.status).toBe('missing');
    expect(UPLOAD_GRACE_MS).toBeLessThan(BUCKET * 3);
  });

  it('reports the newest reading and normalizes load by cores', () => {
    const timeline = buildMetricTimeline(
      series([point(0, true, 42.5), point(BUCKET, true, 26.875_553_440_660_99)], BUCKET),
    );

    expect(timeline.latest?.cpuPercent).toBe(26.875_553_440_660_99);
    expect(timeline.latest?.loadPercent).toBe(50);
    expect(timeline.loadCeiling).toBe(100);
  });

  it('has no latest reading for an empty series', () => {
    expect(buildMetricTimeline(series([], BUCKET)).latest).toBeNull();
  });
});

describe('groupStripBlocks', () => {
  it('merges slots on wall-clock boundaries and keeps the most telling status', () => {
    const timeline = buildMetricTimeline(
      series([point(0, true), point(BUCKET, false), point(2 * BUCKET, true)], 2 * BUCKET),
    );

    const blocks = groupStripBlocks(timeline.slots, BUCKET, BUCKET * 3);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].status).toBe('offline');
    expect(blocks[0].start).toBe(0);
    expect(blocks[0].end).toBe(3 * BUCKET);
    expect(blocks[0].peak.cpuPercent).toBe(10);
  });
});
