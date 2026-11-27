import type { DeviceMetricPoint, DeviceMetricSeries } from '@lobechat/types';

import { loadPercentOf } from './format';

/**
 * The device's recent CPU / memory / load series, turned into what the overview
 * charts: one slot per bucket, plus the newest reading for the stat cards.
 *
 * Port of `src/features/DeviceManager/DeviceHealth/buildHealthTimeline.ts`.
 * CUST-010 deliberately does not import the personal device feature (see
 * `../platform.tsx`), so the console keeps its own copy of this pure logic.
 * Keep the two in sync when the personal page's timeline changes.
 */

/**
 * What the device was doing during one bucket:
 * - `online` — running and connected to LobeHub.
 * - `offline` — running (it took samples) but not connected: a network or
 *   gateway problem rather than a machine problem.
 * - `missing` — no samples: the machine was asleep / off, or LobeHub was not
 *   running on it.
 * - `pending` — the most recent buckets, whose samples may simply not have
 *   been uploaded yet.
 */
export type MetricSlotStatus = 'online' | 'offline' | 'missing' | 'pending';

/** CPU / memory / load, each as a percentage (load relative to the core count). */
export interface MetricUsage {
  cpuPercent: number | null;
  loadPercent: number | null;
  memoryPercent: number | null;
}

/** The newest reading: the charted metrics plus the disk, which answers "is it filling up?". */
export interface LatestDeviceUsage extends MetricUsage {
  diskPercent: number | null;
}

export interface MetricSlot extends MetricUsage {
  memoryUsedBytes: number | null;
  start: number;
  status: MetricSlotStatus;
}

export interface MetricTimeline {
  /** Newest reading of each metric, for the stat cards. */
  latest: LatestDeviceUsage | null;
  /** Upper bound for the load chart — at least 100%, so an overloaded machine still fits. */
  loadCeiling: number;
  slots: MetricSlot[];
}

/**
 * Devices upload every few minutes, so the tail of the window is expected to
 * be empty for a while; only call it missing once it is older than this.
 */
export const UPLOAD_GRACE_MS = 10 * 60_000;

export const buildMetricTimeline = (series: DeviceMetricSeries): MetricTimeline => {
  const { bucketMs, cpuCount, from, points, to } = series;
  const byStart = new Map(points.map((point) => [point.observedAt, point]));
  const firstStart = Math.floor(from / bucketMs) * bucketMs;

  const slots: MetricSlot[] = [];
  for (let start = firstStart; start <= to; start += bucketMs) {
    const point = byStart.get(start);
    const status: MetricSlotStatus = point
      ? point.connected
        ? 'online'
        : 'offline'
      : start + bucketMs > to - UPLOAD_GRACE_MS
        ? 'pending'
        : 'missing';
    slots.push({
      cpuPercent: point?.cpuPercent ?? null,
      loadPercent: loadPercentOf(point?.load1, cpuCount),
      memoryPercent: point?.memoryPercent ?? null,
      memoryUsedBytes: point?.memoryUsedBytes ?? null,
      start,
      status,
    });
  }

  const newest: DeviceMetricPoint | undefined = points.at(-1);
  const maxLoad = Math.max(0, ...slots.map((slot) => slot.loadPercent ?? 0));

  return {
    latest: newest
      ? {
          cpuPercent: newest.cpuPercent,
          // A series cached before devices reported the disk has no such field.
          diskPercent: newest.diskPercent ?? null,
          loadPercent: loadPercentOf(newest.load1, cpuCount),
          memoryPercent: newest.memoryPercent,
        }
      : null,
    loadCeiling: Math.max(100, Math.ceil(maxLoad)),
    slots,
  };
};

export interface MetricStripBlock {
  end: number;
  /** Highest CPU / memory / load inside the block — what its color reflects. */
  peak: MetricUsage;
  start: number;
  status: MetricSlotStatus;
}

/** Most to least telling when slots of different kinds share one block. */
const STRIP_PRIORITY: MetricSlotStatus[] = ['offline', 'online', 'pending', 'missing'];

const maxOf = (values: (number | null)[]) => {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : Math.max(...present);
};

/**
 * Merge consecutive slots into blocks wide enough to see and hover. Blocks sit
 * on wall-clock boundaries so their hover times read naturally, and take their
 * most telling slot status: a disconnect anywhere in the block shows.
 */
export const groupStripBlocks = (
  slots: MetricSlot[],
  bucketMs: number,
  blockMs: number,
): MetricStripBlock[] => {
  const groups = new Map<number, MetricSlot[]>();
  for (const slot of slots) {
    const key = Math.floor(slot.start / blockMs) * blockMs;
    const group = groups.get(key) ?? [];
    group.push(slot);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const status =
      STRIP_PRIORITY.find((candidate) => group.some((slot) => slot.status === candidate)) ??
      'missing';
    return {
      end: group.at(-1)!.start + bucketMs,
      peak: {
        cpuPercent: maxOf(group.map((slot) => slot.cpuPercent)),
        loadPercent: maxOf(group.map((slot) => slot.loadPercent)),
        memoryPercent: maxOf(group.map((slot) => slot.memoryPercent)),
      },
      start: group[0].start,
      status,
    };
  });
};
