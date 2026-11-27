'use client';

import type { AdminDeviceDetail, AdminDeviceTarget } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  ActivityIcon,
  BotIcon,
  CableIcon,
  CalendarClockIcon,
  CpuIcon,
  FolderIcon,
  GaugeIcon,
  HardDriveIcon,
  HeartPulseIcon,
  LayersIcon,
  MemoryStickIcon,
  MonitorIcon,
  PlayIcon,
  PowerIcon,
  ServerCogIcon,
  ServerIcon,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatSize } from '@/utils/format';

import { useAdminDeviceActivity, useAdminDeviceOverview } from '../../hooks/useAdminDevices';
import { platformIcon, platformLabel } from '../platform';
import PresenceBadge from '../PresenceBadge';
import { DetailCard, EmptyValue, InfoRow, StatCard } from './cards';
import { LOAD_THRESHOLDS } from './format';
import { HealthCharts, HealthLegend } from './Health';
import { ShareCard } from './ShareCard';
import { buildMetricTimeline } from './timeline';

const styles = stylex.create({
  // Two info cards side by side, stacking once the column gets narrow.
  infoGrid: {
    display: 'grid',
    gap: 16,
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
  },
  statGrid: {
    display: 'grid',
    gap: 16,
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
  },
  code: {
    overflow: 'hidden',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 13,
    minWidth: 0,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

interface OverviewTabProps {
  device: AdminDeviceDetail;
  target: AdminDeviceTarget;
}

/**
 * Overview of one device, shown to an administrator: the same readings the
 * owner sees on `/settings/devices/:id` — runtime, specs, current usage with
 * its trend, health history, running topics and bound agents — plus the
 * console-only sharing controls.
 *
 * Everything is read as the device's OWNER (see the server's
 * `adminConsole.deviceDetail`), so an offline or managed-cloud device degrades
 * to "no live metrics" instead of an error page.
 */
const OverviewTab = memo<OverviewTabProps>(({ device, target }) => {
  const { t } = useTranslation(['adminConsole', 'setting']);
  const { data: overview, error, isLoading } = useAdminDeviceOverview(target);
  const { data: activity } = useAdminDeviceActivity(target);

  const metrics = overview?.metrics;
  const timeline = useMemo(
    () => (metrics && metrics.points.length > 0 ? buildMetricTimeline(metrics) : null),
    [metrics],
  );

  const latest = timeline?.latest ?? null;
  const newest = metrics?.points.at(-1);
  const cores = metrics?.cpuCount ?? null;
  const memoryTotal = metrics?.memoryTotalBytes ?? null;
  const diskTotal = metrics?.diskTotalBytes ?? null;
  const memoryUsed = newest?.memoryUsedBytes ?? null;
  const diskUsed = newest?.diskUsedBytes ?? null;
  const reportsLoad = !!timeline?.slots.some((slot) => slot.loadPercent !== null);

  const runningTopics = activity?.runningTopics ?? [];
  const agents = activity?.agents ?? [];
  const workingDirs = device.workingDirs ?? [];

  const coresLabel = cores ? t('devices.detail.cores', { count: cores, ns: 'setting' }) : undefined;

  return (
    <Flexbox gap={16}>
      <div {...stylex.props(styles.infoGrid)}>
        <DetailCard icon={ActivityIcon} padded={false} title={t('devices.detail.runtime')}>
          <InfoRow icon={PowerIcon} label={t('devices.detail.presence')}>
            <PresenceBadge state={device.online ?? 'unknown'} />
          </InfoRow>
          <InfoRow icon={MonitorIcon} label={t('devices.detail.platform')}>
            {device.platform ? (
              <>
                <span style={{ color: cssVar.colorTextSecondary, display: 'flex' }}>
                  {platformIcon(device.platform, 14)}
                </span>
                <Text>{platformLabel(device.platform, device.architecture)}</Text>
              </>
            ) : (
              <EmptyValue />
            )}
          </InfoRow>
          <InfoRow icon={CableIcon} label={t('devices.detail.channels')}>
            <Text>{device.channels?.length ?? 0}</Text>
          </InfoRow>
          <InfoRow icon={CalendarClockIcon} label={t('devices.detail.lastSeenAt')}>
            <Text>{new Date(device.lastSeenAt).toLocaleString()}</Text>
          </InfoRow>
        </DetailCard>

        <DetailCard icon={ServerCogIcon} padded={false} title={t('devices.detail.specs')}>
          <InfoRow icon={ServerIcon} label={t('devices.detail.hostname')}>
            {device.hostname ? (
              <span {...stylex.props(styles.code)} title={device.hostname}>
                {device.hostname}
              </span>
            ) : (
              <EmptyValue />
            )}
          </InfoRow>
          <InfoRow icon={LayersIcon} label={t('devices.detail.architecture')}>
            {device.architecture ? <Text>{device.architecture}</Text> : <EmptyValue />}
          </InfoRow>
          <InfoRow icon={CpuIcon} label={t('devices.detail.cpu')}>
            {coresLabel ? <Text>{coresLabel}</Text> : <EmptyValue />}
          </InfoRow>
          <InfoRow icon={MemoryStickIcon} label={t('devices.detail.memory')}>
            {memoryTotal ? <Text>{formatSize(memoryTotal)}</Text> : <EmptyValue />}
          </InfoRow>
          <InfoRow icon={HardDriveIcon} label={t('devices.detail.disk')}>
            {diskTotal ? <Text>{formatSize(diskTotal)}</Text> : <EmptyValue />}
          </InfoRow>
          <InfoRow icon={FolderIcon} label={t('devices.detail.workingDirs')}>
            {(device.defaultCwd ?? workingDirs[0]?.path) ? (
              <span
                {...stylex.props(styles.code)}
                title={device.defaultCwd ?? workingDirs[0]?.path}
              >
                {device.defaultCwd ?? workingDirs[0]?.path}
              </span>
            ) : (
              <EmptyValue />
            )}
          </InfoRow>
        </DetailCard>
      </div>

      <div {...stylex.props(styles.statGrid)}>
        <StatCard
          detail={coresLabel}
          icon={CpuIcon}
          loading={isLoading}
          title={t('devices.detail.cpuUsage')}
          value={latest?.cpuPercent}
        />
        <StatCard
          icon={MemoryStickIcon}
          loading={isLoading}
          title={t('devices.detail.memoryUsage')}
          value={latest?.memoryPercent}
          detail={
            memoryUsed !== null && memoryTotal
              ? `${formatSize(memoryUsed)} / ${formatSize(memoryTotal)}`
              : undefined
          }
        />
        {(reportsLoad || isLoading) && (
          <StatCard
            icon={GaugeIcon}
            loading={isLoading}
            thresholds={LOAD_THRESHOLDS}
            title={t('devices.detail.loadUsage')}
            value={latest?.loadPercent}
            detail={
              newest?.load1 !== null && newest?.load1 !== undefined && coresLabel
                ? `${newest.load1.toFixed(2)} / ${coresLabel}`
                : undefined
            }
          />
        )}
        {(diskTotal || isLoading) && (
          <StatCard
            icon={HardDriveIcon}
            loading={isLoading}
            title={t('devices.detail.diskUsage')}
            value={latest?.diskPercent}
            detail={
              diskUsed !== null && diskTotal
                ? `${formatSize(diskUsed)} / ${formatSize(diskTotal)}`
                : undefined
            }
          />
        )}
      </div>

      <DetailCard
        padded
        extra={timeline ? <HealthLegend /> : undefined}
        icon={HeartPulseIcon}
        title={t('devices.health.title', { ns: 'setting' })}
      >
        {isLoading ? (
          <Text type={'secondary'}>{t('devices.health.loading', { ns: 'setting' })}</Text>
        ) : !metrics ? (
          // A failed read with nothing cached is a real state to name; an
          // offline device and a managed cloud device both land here.
          <Text type={'secondary'}>
            {error
              ? t('devices.detail.metricsUnavailable')
              : t('devices.health.empty', { ns: 'setting' })}
          </Text>
        ) : !timeline ? (
          <Text type={'secondary'}>{t('devices.health.empty', { ns: 'setting' })}</Text>
        ) : (
          <HealthCharts series={metrics} timeline={timeline} />
        )}
      </DetailCard>

      <div {...stylex.props(styles.infoGrid)}>
        <DetailCard icon={PlayIcon} padded={false} title={t('devices.detail.runningTopics')}>
          {runningTopics.length === 0 ? (
            <Flexbox padding={16}>
              <Text type={'secondary'}>{t('devices.detail.emptyTopics')}</Text>
            </Flexbox>
          ) : (
            runningTopics.map((topic) => (
              <InfoRow icon={PlayIcon} key={topic.id} label={topic.title ?? topic.id}>
                <Text>{topic.user?.username ?? topic.userId}</Text>
              </InfoRow>
            ))
          )}
        </DetailCard>
        <DetailCard icon={BotIcon} padded={false} title={t('devices.detail.boundAgents')}>
          {agents.length === 0 ? (
            <Flexbox padding={16}>
              <Text type={'secondary'}>{t('devices.detail.emptyAgents')}</Text>
            </Flexbox>
          ) : (
            agents.map((agent) => (
              <InfoRow icon={BotIcon} key={agent.id} label={agent.name ?? agent.title ?? agent.id}>
                <Text>{agent.visibility}</Text>
              </InfoRow>
            ))
          )}
        </DetailCard>
      </div>

      <ShareCard device={device} target={target} />
    </Flexbox>
  );
});

OverviewTab.displayName = 'AdminDeviceOverviewTab';

export default OverviewTab;
