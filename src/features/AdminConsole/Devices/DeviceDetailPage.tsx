'use client';

import type { AdminDeviceDetail, AdminDeviceTarget } from '@lobechat/types';
import {
  Button,
  Center,
  CopyButton,
  Empty,
  Flexbox,
  Icon,
  Select,
  Spin,
  Tabs,
  Tag,
  Text,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeftIcon, BotIcon, FolderIcon, InfoIcon, RefreshCwIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import {
  useAdminDevice,
  useAdminDeviceActivity,
  useAdminDeviceAgents,
  useAdminDeviceOverview,
  useAdminProjectDirectory,
} from '../hooks/useAdminDevices';
import PresenceBadge from './PresenceBadge';

const styles = stylex.create({
  card: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: 16,
  },
  entry: {
    alignItems: 'center',
    borderRadius: cssVar.borderRadius,
    cursor: 'pointer',
    display: 'flex',
    gap: 8,
    paddingBlock: 8,
    paddingInline: 12,
  },
  page: {
    height: '100%',
    overflow: 'auto',
    paddingBlock: 24,
    paddingInline: 32,
  },
  row: {
    alignItems: 'center',
    display: 'flex',
    gap: 12,
    justifyContent: 'space-between',
    minWidth: 0,
  },
  value: {
    minWidth: 0,
    overflow: 'hidden',
    textAlign: 'right',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

const formatBytes = (bytes?: number | null) => {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
};

const Row = memo<{ children?: React.ReactNode; label: string }>(({ label, children }) => (
  <div {...stylex.props(styles.row)}>
    <Text type={'secondary'}>{label}</Text>
    <span {...stylex.props(styles.value)}>{children ?? '—'}</span>
  </div>
));

Row.displayName = 'AdminDeviceDetailRow';

const Card = memo<{ children: React.ReactNode; icon: typeof InfoIcon; title: string }>(
  ({ children, icon, title }) => (
    <Flexbox {...stylex.props(styles.card)}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Icon icon={icon} size={16} />
        <Text weight={500}>{title}</Text>
      </Flexbox>
      {children}
    </Flexbox>
  ),
);

Card.displayName = 'AdminDeviceDetailCard';

interface OverviewProps {
  device: AdminDeviceDetail;
  target: AdminDeviceTarget;
}

const OverviewTab = memo<OverviewProps>(({ device, target }) => {
  const { t } = useTranslation(['adminConsole', 'common']);
  const { data: overview } = useAdminDeviceOverview(target);
  const { data: activity } = useAdminDeviceActivity(target);

  const metrics = overview?.metrics;
  const latest = metrics?.points?.at(-1);
  const runningTopics = activity?.runningTopics ?? [];
  const agents = activity?.agents ?? [];
  const workingDirs = device.workingDirs ?? [];

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal gap={16} wrap={'wrap'}>
        <Flexbox flex={1} style={{ minWidth: 320 }}>
          <Card icon={InfoIcon} title={t('devices.detail.runtime')}>
            <Row label={t('devices.detail.presence')}>
              <PresenceBadge state={device.online ?? 'unknown'} />
            </Row>
            <Row label={t('devices.detail.platform')}>{device.platform ?? '—'}</Row>
            <Row label={t('devices.detail.channels')}>{device.channels?.length ?? 0}</Row>
            <Row label={t('devices.detail.lastSeenAt')}>
              {new Date(device.lastSeenAt).toLocaleString()}
            </Row>
          </Card>
        </Flexbox>
        <Flexbox flex={1} style={{ minWidth: 320 }}>
          <Card icon={InfoIcon} title={t('devices.detail.specs')}>
            <Row label={t('devices.detail.hostname')}>{device.hostname ?? '—'}</Row>
            <Row label={t('devices.detail.architecture')}>{device.architecture ?? '—'}</Row>
            <Row label={t('devices.detail.cpu')}>
              {metrics?.cpuCount ? t('devices.detail.cores', { count: metrics.cpuCount }) : '—'}
            </Row>
            <Row label={t('devices.detail.memory')}>{formatBytes(metrics?.memoryTotalBytes)}</Row>
            <Row label={t('devices.detail.disk')}>{formatBytes(metrics?.diskTotalBytes)}</Row>
            <Row label={t('devices.detail.workingDirs')}>
              {device.defaultCwd ?? workingDirs[0]?.path ?? '—'}
            </Row>
          </Card>
        </Flexbox>
      </Flexbox>

      {latest && (
        <Flexbox horizontal gap={16} wrap={'wrap'}>
          <Flexbox {...stylex.props(styles.card)} flex={1}>
            <Text type={'secondary'}>{t('devices.detail.cpuUsage')}</Text>
            <Text fontSize={24}>{latest.cpuPercent == null ? '—' : `${latest.cpuPercent}%`}</Text>
          </Flexbox>
          <Flexbox {...stylex.props(styles.card)} flex={1}>
            <Text type={'secondary'}>{t('devices.detail.memoryUsage')}</Text>
            <Text fontSize={24}>
              {latest.memoryPercent == null ? '—' : `${latest.memoryPercent}%`}
            </Text>
          </Flexbox>
          <Flexbox {...stylex.props(styles.card)} flex={1}>
            <Text type={'secondary'}>{t('devices.detail.diskUsage')}</Text>
            <Text fontSize={24}>{latest.diskPercent == null ? '—' : `${latest.diskPercent}%`}</Text>
          </Flexbox>
        </Flexbox>
      )}

      <Flexbox horizontal gap={16} wrap={'wrap'}>
        <Flexbox flex={1} style={{ minWidth: 320 }}>
          <Card icon={InfoIcon} title={t('devices.detail.runningTopics')}>
            {runningTopics.length === 0 ? (
              <Text type={'secondary'}>{t('devices.detail.emptyTopics')}</Text>
            ) : (
              runningTopics.map((topic) => (
                <Row key={topic.id} label={topic.title ?? topic.id}>
                  {topic.user?.username ?? topic.userId}
                </Row>
              ))
            )}
          </Card>
        </Flexbox>
        <Flexbox flex={1} style={{ minWidth: 320 }}>
          <Card icon={BotIcon} title={t('devices.detail.boundAgents')}>
            {agents.length === 0 ? (
              <Text type={'secondary'}>{t('devices.detail.emptyAgents')}</Text>
            ) : (
              agents.map((agent) => (
                <Row key={agent.id} label={agent.name ?? agent.title ?? agent.id}>
                  {agent.visibility}
                </Row>
              ))
            )}
          </Card>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

OverviewTab.displayName = 'AdminDeviceOverviewTab';

const FilesTab = memo<{ device: AdminDeviceDetail; target: AdminDeviceTarget }>(
  ({ device, target }) => {
    const { t } = useTranslation(['adminConsole', 'common']);
    const roots = useMemo(
      () => (device.workingDirs ?? []).map((dir) => ({ label: dir.path, value: dir.path })),
      [device.workingDirs],
    );
    const [root, setRoot] = useState(device.defaultCwd ?? roots[0]?.value ?? '');
    const [relativePath, setRelativePath] = useState('');

    const { data, isLoading } = useAdminProjectDirectory(
      root ? { ...target, relativePath, root } : null,
    );

    return (
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={12}>
          <Text type={'secondary'}>{t('devices.detail.root')}</Text>
          {roots.length > 1 ? (
            <Select
              options={roots}
              style={{ minWidth: 320 }}
              value={root}
              onChange={(value) => {
                setRoot(value as string);
                setRelativePath('');
              }}
            />
          ) : (
            <Text code>{root || '—'}</Text>
          )}
          <Tag>{t('devices.detail.readonly')}</Tag>
        </Flexbox>

        <Text type={'secondary'}>{`${root}/${relativePath}`}</Text>

        {isLoading ? (
          <Center style={{ padding: 24 }}>
            <Spin />
          </Center>
        ) : !data?.entries?.length ? (
          <Empty description={t('devices.detail.emptyFiles')} />
        ) : (
          <Flexbox>
            {relativePath && (
              <div
                {...stylex.props(styles.entry)}
                onClick={() => setRelativePath(relativePath.split('/').slice(0, -1).join('/'))}
              >
                <Icon icon={FolderIcon} />
                <Text>..</Text>
              </div>
            )}
            {data.entries.map((entry) => (
              <div
                {...stylex.props(styles.entry)}
                key={entry.path}
                onClick={() => {
                  if (entry.isDirectory) setRelativePath(entry.relativePath);
                }}
              >
                <Icon icon={entry.isDirectory ? FolderIcon : InfoIcon} size={16} />
                <Text>{entry.name}</Text>
              </div>
            ))}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

FilesTab.displayName = 'AdminDeviceFilesTab';

const AgentsTab = memo<{ target: AdminDeviceTarget }>(({ target }) => {
  const { t } = useTranslation(['adminConsole', 'common']);
  const { data, isLoading, mutate } = useAdminDeviceAgents(target);
  const entries = Object.entries(data?.agents ?? {});

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Text type={'secondary'}>{t('devices.detail.agentsInstalled')}</Text>
        <Button icon={<Icon icon={RefreshCwIcon} />} loading={isLoading} onClick={() => mutate()}>
          {t('devices.detail.rescan')}
        </Button>
      </Flexbox>

      {data?.error && <Text type={'danger'}>{data.error}</Text>}

      {isLoading ? (
        <Center style={{ padding: 24 }}>
          <Spin />
        </Center>
      ) : entries.length === 0 ? (
        <Empty description={t('devices.detail.emptyRuntimes')} />
      ) : (
        <Flexbox>
          {entries.map(([type, status]) => (
            <Flexbox horizontal align={'center'} justify={'space-between'} key={type} padding={8}>
              <Text>{type}</Text>
              <Flexbox horizontal gap={8}>
                {status.version && <Text code>{status.version}</Text>}
                <Tag>{status.available ? '✓' : '—'}</Tag>
              </Flexbox>
            </Flexbox>
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

AgentsTab.displayName = 'AdminDeviceAgentsTab';

const DeviceDetailPage = memo(() => {
  const { t } = useTranslation(['adminConsole', 'common']);
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const deviceId = params.deviceId ?? null;
  const ownerId = searchParams.get('ownerId');
  const workspaceId = searchParams.get('workspaceId');
  const tabParam = searchParams.get('tab');
  const tab = tabParam === 'files' || tabParam === 'agents' ? tabParam : 'overview';

  const { data: device, error, isLoading } = useAdminDevice(deviceId, workspaceId, ownerId);

  const target = useMemo<AdminDeviceTarget | null>(
    () => (deviceId ? { deviceId, ownerId, workspaceId } : null),
    [deviceId, ownerId, workspaceId],
  );

  const setTab = (next: string) => {
    setSearchParams(
      (prev) => {
        const nextParams = new URLSearchParams(prev);
        if (next === 'overview') nextParams.delete('tab');
        else nextParams.set('tab', next);
        return nextParams;
      },
      { replace: true },
    );
  };

  if (isLoading) {
    return (
      <Center height={'100%'} width={'100%'}>
        <Spin />
      </Center>
    );
  }

  if (error || !device || !target) {
    return (
      <Flexbox {...stylex.props(styles.page)} gap={12}>
        <Button
          icon={<Icon icon={ArrowLeftIcon} />}
          size={'small'}
          type={'text'}
          onClick={() => navigate('/admin/devices')}
        >
          {t('devices.detail.back')}
        </Button>
        <Empty description={t('devices.detail.loadFailedDesc')} />
        <Text type={'secondary'}>{t('devices.detail.loadFailed')}</Text>
      </Flexbox>
    );
  }

  const displayName = device.friendlyName || device.hostname || device.deviceId;

  return (
    <Flexbox {...stylex.props(styles.page)} gap={20}>
      <Flexbox horizontal>
        <Button
          icon={<Icon icon={ArrowLeftIcon} />}
          size={'small'}
          type={'text'}
          onClick={() => navigate('/admin/devices')}
        >
          {t('devices.detail.back')}
        </Button>
      </Flexbox>

      <Flexbox horizontal align={'center'} gap={12} wrap={'wrap'}>
        <Text as={'h2'} fontSize={22} style={{ margin: 0 }} weight={600}>
          {displayName}
        </Text>
        <Flexbox horizontal align={'center'} gap={2}>
          <Text code>{device.deviceId}</Text>
          <CopyButton content={device.deviceId} size={'small'} />
        </Flexbox>
        <PresenceBadge state={device.online ?? 'unknown'} />
        <Tag>{t(`devices.scope.${device.scope}`)}</Tag>
        {device.owner?.username && <Tag>{device.owner.username}</Tag>}
      </Flexbox>

      <Tabs
        activeKey={tab}
        items={[
          {
            icon: <Icon icon={InfoIcon} />,
            key: 'overview',
            label: t('devices.detail.tabs.overview'),
          },
          {
            icon: <Icon icon={FolderIcon} />,
            key: 'files',
            label: t('devices.detail.tabs.files'),
          },
          {
            icon: <Icon icon={BotIcon} />,
            key: 'agents',
            label: t('devices.detail.tabs.agents'),
          },
        ]}
        onChange={setTab}
      />

      {tab === 'overview' && <OverviewTab device={device} target={target} />}
      {tab === 'files' && <FilesTab device={device} target={target} />}
      {tab === 'agents' && <AgentsTab target={target} />}
    </Flexbox>
  );
});

DeviceDetailPage.displayName = 'AdminDeviceDetailPage';

export default DeviceDetailPage;
