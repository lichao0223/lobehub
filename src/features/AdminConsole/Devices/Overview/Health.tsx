'use client';

import type { DeviceMetricSeries } from '@lobechat/types';
import { AreaChart, Tracker } from '@lobehub/charts';
import { cssVar, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatSize } from '@/utils/format';

import {
  formatPercent,
  LOAD_THRESHOLDS,
  peakUsageLevel,
  type UsageLevel,
  usageLevel,
  type UsageThresholds,
} from './format';
import type { MetricSlot, MetricSlotStatus, MetricStripBlock, MetricTimeline } from './timeline';
import { groupStripBlocks } from './timeline';
import { USAGE_COLOR, usageTextColor } from './usage';

/**
 * Status-strip block span. The strip spans the full-width detail page, so a
 * 5-minute block keeps each tick narrow (~144 over 12 hours).
 */
const STRIP_BLOCK_MS = 5 * 60_000;

const styles = stylex.create({
  charts: {
    display: 'grid',
    gap: 16,
    gridTemplateColumns:
      'repeat(auto-fill, minmax(max(min(100%, 320px), calc((100% - 16px) / 2)), 1fr))',
  },
});

/**
 * Non-running states stay grey so green / yellow / red keep meaning how loaded
 * a running machine is: a disconnect is a bright grey (the machine was still
 * running), no data a faint one.
 */
const STATUS_COLOR: Record<Exclude<MetricSlotStatus, 'online'>, string> = {
  missing: cssVar.colorFillTertiary,
  offline: cssVar.colorTextQuaternary,
  pending: cssVar.colorFillQuaternary,
};

const blockColor = (block: MetricStripBlock) =>
  block.status === 'online'
    ? USAGE_COLOR[
        peakUsageLevel(
          usageLevel(block.peak.cpuPercent),
          usageLevel(block.peak.memoryPercent),
          usageLevel(block.peak.loadPercent, LOAD_THRESHOLDS),
        ) ?? 'normal'
      ]
    : STATUS_COLOR[block.status];

const formatClock = (ms: number) => dayjs(ms).format('HH:mm');

const LEGEND: {
  color: string;
  key: `devices.health.level.${UsageLevel | 'offline' | 'missing'}`;
}[] = [
  { color: USAGE_COLOR.normal, key: 'devices.health.level.normal' },
  { color: USAGE_COLOR.high, key: 'devices.health.level.high' },
  { color: USAGE_COLOR.critical, key: 'devices.health.level.critical' },
  { color: STATUS_COLOR.offline, key: 'devices.health.level.offline' },
  { color: STATUS_COLOR.missing, key: 'devices.health.level.missing' },
];

/**
 * One-line key for the strip colors. The strings are upstream-owned
 * (`setting` namespace), the same ones the personal device page shows.
 */
export const HealthLegend = () => {
  const { t } = useTranslation('setting');
  return (
    <Flexbox horizontal align={'center'} gap={8}>
      {LEGEND.map(({ color, key }) => (
        <Flexbox horizontal align={'center'} gap={4} key={key}>
          <span style={{ background: color, borderRadius: 2, height: 8, width: 8 }} />
          <Text fontSize={11} type={'secondary'}>
            {t(key)}
          </Text>
        </Flexbox>
      ))}
    </Flexbox>
  );
};

interface MetricChartProps {
  ceiling: number;
  data: { time: string; value: number | null }[];
  label: string;
  latest: number | null | undefined;
  thresholds?: UsageThresholds;
}

/** Left: what is measured (with its size); right: the latest share, colored by level. */
const MetricChart = ({ ceiling, data, label, latest, thresholds }: MetricChartProps) => (
  <Flexbox gap={4}>
    <Flexbox horizontal align={'baseline'} distribution={'space-between'}>
      <Text fontSize={12} type={'secondary'}>
        {label}
      </Text>
      <Text
        fontSize={12}
        style={{ color: usageTextColor(usageLevel(latest, thresholds)) }}
        weight={500}
      >
        {formatPercent(latest)}
      </Text>
    </Flexbox>
    <AreaChart
      startEndOnly
      categories={['value']}
      customCategories={{ value: label }}
      data={data}
      height={72}
      index={'time'}
      showLegend={false}
      showYAxis={false}
      valueFormatter={formatPercent}
      yAxisDomain={[0, ceiling]}
    />
  </Flexbox>
);

interface HealthChartsProps {
  series: DeviceMetricSeries;
  timeline: MetricTimeline;
}

/** The machine's recent CPU / memory / load, with the status strip above them. */
export const HealthCharts = ({ series, timeline }: HealthChartsProps) => {
  const { t } = useTranslation('setting');

  const blockTooltip = useMemo(() => {
    const statusLabel: Record<MetricSlotStatus, string> = {
      missing: t('devices.health.status.missing'),
      offline: t('devices.health.status.offline'),
      online: t('devices.health.status.online'),
      pending: t('devices.health.status.pending'),
    };

    return (block: MetricStripBlock) => {
      const head = `${formatClock(block.start)}–${formatClock(block.end)} · ${statusLabel[block.status]}`;
      if (block.status !== 'online' && block.status !== 'offline') return head;
      return `${head} · ${t('devices.health.cpu')} ${formatPercent(
        block.peak.cpuPercent,
      )} · ${t('devices.health.memory')} ${formatPercent(
        block.peak.memoryPercent,
      )} · ${t('devices.health.loadShort')} ${formatPercent(block.peak.loadPercent)}`;
    };
  }, [t]);

  const rows = (pick: (slot: MetricSlot) => number | null) =>
    timeline.slots.map((slot) => ({ time: formatClock(slot.start), value: pick(slot) }));

  const cores = series.cpuCount ?? 1;

  return (
    <Flexbox gap={16}>
      <Flexbox gap={6}>
        <Tracker
          blockGap={1}
          blockHeight={12}
          blockWidth={'100%'}
          width={'100%'}
          data={groupStripBlocks(
            timeline.slots,
            series.bucketMs,
            Math.max(series.bucketMs, STRIP_BLOCK_MS),
          ).map((block) => ({
            color: blockColor(block),
            key: block.start,
            tooltip: blockTooltip(block),
          }))}
        />
        <Flexbox horizontal distribution={'space-between'}>
          <Text fontSize={11} type={'secondary'}>
            {formatClock(series.from)}
          </Text>
          <Text fontSize={11} type={'secondary'}>
            {t('devices.health.now')}
          </Text>
        </Flexbox>
      </Flexbox>

      <div {...stylex.props(styles.charts)}>
        <MetricChart
          ceiling={100}
          data={rows((slot) => slot.cpuPercent)}
          label={t('devices.health.cpuCores', { count: cores })}
          latest={timeline.latest?.cpuPercent}
        />
        <MetricChart
          ceiling={100}
          data={rows((slot) => slot.memoryPercent)}
          latest={timeline.latest?.memoryPercent}
          label={
            series.memoryTotalBytes
              ? `${t('devices.health.memory')} · ${formatSize(series.memoryTotalBytes)}`
              : t('devices.health.memory')
          }
        />
        {timeline.slots.some((slot) => slot.loadPercent !== null) && (
          <MetricChart
            ceiling={timeline.loadCeiling}
            data={rows((slot) => slot.loadPercent)}
            label={t('devices.health.load', { count: cores })}
            latest={timeline.latest?.loadPercent}
            thresholds={LOAD_THRESHOLDS}
          />
        )}
      </div>
    </Flexbox>
  );
};
