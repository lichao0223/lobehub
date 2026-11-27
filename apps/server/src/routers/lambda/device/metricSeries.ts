import type { DeviceMetricSeries } from '@lobechat/types';
import {
  bucketDeviceMetrics,
  DEVICE_METRIC_SAMPLE_INTERVAL_MS,
  DEVICE_METRIC_VIEW_WINDOW_MS,
} from '@lobechat/types';

import { deviceGateway } from '@/server/services/deviceGateway';

/** Aim for about this many points per chart, whatever the window. */
const TARGET_POINTS = 144;

export interface DeviceMetricSeriesRequest {
  deviceId: string;
  /** Principal the metrics live under — the owner, never the console reader. */
  userId: string;
  windowMs?: number;
  /** Owner's workspace when the device row is a workspace enrollment. */
  workspaceId?: string;
}

/**
 * One device's CPU / memory / load / disk series, read from the gateway (the
 * only store — it keeps two days) and averaged into buckets sized so the
 * window renders as roughly {@link TARGET_POINTS} points.
 *
 * Shared by the personal device page and the admin console detail page so the
 * two render the exact same shape; only the principal differs.
 */
export const buildDeviceMetricSeries = async ({
  deviceId,
  userId,
  workspaceId,
  windowMs = DEVICE_METRIC_VIEW_WINDOW_MS,
}: DeviceMetricSeriesRequest): Promise<DeviceMetricSeries> => {
  const to = Date.now();
  const from = to - windowMs;
  const bucketMs = Math.max(
    DEVICE_METRIC_SAMPLE_INTERVAL_MS,
    Math.ceil(windowMs / TARGET_POINTS / DEVICE_METRIC_SAMPLE_INTERVAL_MS) *
      DEVICE_METRIC_SAMPLE_INTERVAL_MS,
  );

  const samples = await deviceGateway.queryDeviceMetrics({
    deviceId,
    since: from,
    userId,
    workspaceId,
  });
  const latest = samples.at(-1);

  return {
    bucketMs,
    cpuCount: latest?.cpuCount ?? null,
    diskTotalBytes: samples.findLast((s) => s.diskTotalBytes)?.diskTotalBytes ?? null,
    from,
    memoryTotalBytes: latest?.memoryTotalBytes ?? null,
    points: bucketDeviceMetrics(samples, { bucketMs, from, to }),
    to,
  };
};
