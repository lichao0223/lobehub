'use client';

import type { AdminDeviceSummary } from '@lobechat/types';
import {
  Button,
  Center,
  Empty,
  Flexbox,
  Pagination,
  SearchBar,
  Segmented,
  Select,
  Spin,
  Text,
  Tooltip,
} from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';
import { useDensityTokens } from '@/styles/density';
import { sx } from '@/styles/sx';

import { useAdminDevices, useAdminDeviceStats } from '../hooks/useAdminDevices';
import DeviceRow from './DeviceRow';
import { DEVICE_LIST_COLUMNS, styles } from './style';
import { useDeviceFilters } from './useDeviceFilters';
import type { OnlineFilter, ScopeFilter, VisibilityFilter } from './utils';
import {
  buildDeviceListParams,
  deviceRowKey,
  hasActiveDeviceFilters,
  isDevicePagePartial,
  PAGE_SIZE,
} from './utils';

const StatItem = memo<{ label: string; value: number }>(({ label, value }) => (
  <div {...sx(styles.statsItem)}>
    <span {...sx(styles.statsValue)}>{value}</span>
    <span {...sx(styles.statsLabel)}>{label}</span>
  </div>
));

StatItem.displayName = 'AdminDeviceStatItem';

const Devices = memo(() => {
  const { t } = useTranslation('adminConsole');
  const tokens = useDensityTokens();
  const navigate = useNavigate();

  const {
    filters,
    keyword,
    resetFilters,
    setKeyword,
    setOnline,
    setPage,
    setScope,
    setVisibility,
  } = useDeviceFilters();

  // `keyword` above is the raw input; the toolbar controls below read and write
  // the settled filter state.
  const { online, page, scope, visibility } = filters;

  const params = useMemo(() => buildDeviceListParams(filters), [filters]);

  const { data, error, isLoading, mutate } = useAdminDevices(params);
  const { data: stats } = useAdminDeviceStats();

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const onlineStats = data?.onlineStats;
  const hasFilters = hasActiveDeviceFilters(filters);
  const pagePartial = isDevicePagePartial(filters, items.length, total);

  const handleSelect = (device: AdminDeviceSummary) => {
    // The same deviceId can exist in two pools, so the row is addressed by the
    // pair as well; the detail page reads both from the query string.
    const params = new URLSearchParams();
    params.set('ownerId', device.owner.userId);
    if (device.workspace?.workspaceId) params.set('workspaceId', device.workspace.workspaceId);
    navigate(`/admin/devices/${encodeURIComponent(device.deviceId)}?${params.toString()}`);
  };

  return (
    <>
      <NavHeader>
        <Text weight={500}>{t('devices.title')}</Text>
      </NavHeader>
      <SettingContainer
        maxWidth={1024}
        paddingBlock={`${tokens.pagePaddingBlockStart}px 128px`}
        paddingInline={tokens.pagePaddingInline}
      >
        <Flexbox gap={16}>
          <div {...sx(styles.statsRow)}>
            <StatItem label={t('devices.stats.total')} value={stats?.total ?? 0} />
            <StatItem label={t('devices.stats.personal')} value={stats?.personal ?? 0} />
            <StatItem label={t('devices.stats.workspace')} value={stats?.workspace ?? 0} />
            <StatItem label={t('devices.stats.activeLast7d')} value={stats?.activeLast7d ?? 0} />
          </div>

          <Flexbox horizontal align={'center'} gap={12} justify={'space-between'} wrap={'wrap'}>
            <SearchBar
              allowClear
              placeholder={t('devices.searchPlaceholder')}
              style={{ flex: '1 1 220px', maxWidth: 320, minWidth: 220 }}
              value={keyword}
              variant={'filled'}
              onInputChange={(value) => setKeyword(value)}
            />
            {/*
             * Fixed geometry: every control is mounted in every scope, so
             * switching 全部/个人/工作空间 cannot reflow the bar. The workspace-only
             * visibility filter stays in place, disabled and explained, instead of
             * appearing and pushing the whole toolbar onto another line.
             */}
            <Flexbox horizontal align={'center'} gap={12} style={{ flex: 'none' }}>
              <Segmented
                size={'small'}
                value={scope}
                options={[
                  { label: t('devices.filter.scope.all'), value: 'all' },
                  { label: t('devices.filter.scope.personal'), value: 'personal' },
                  { label: t('devices.filter.scope.workspace'), value: 'workspace' },
                ]}
                onChange={(value) => setScope(value as ScopeFilter)}
              />
              <Select
                style={{ width: 148 }}
                value={online}
                options={[
                  { label: t('devices.filter.online.all'), value: 'all' },
                  { label: t('devices.online.online'), value: 'online' },
                  { label: t('devices.online.offline'), value: 'offline' },
                  { label: t('devices.online.unknown'), value: 'unknown' },
                ]}
                onChange={(value) => {
                  setOnline(typeof value === 'string' ? (value as OnlineFilter) : 'all');
                }}
              />
              <Tooltip
                title={scope === 'workspace' ? undefined : t('devices.filter.visibility.hint')}
              >
                <div style={{ display: 'flex' }}>
                  <Select
                    disabled={scope !== 'workspace'}
                    style={{ width: 148 }}
                    value={visibility}
                    options={[
                      { label: t('devices.filter.visibility.all'), value: 'all' },
                      { label: t('devices.visibility.private'), value: 'private' },
                      { label: t('devices.visibility.public'), value: 'public' },
                    ]}
                    onChange={(value) => {
                      setVisibility(
                        typeof value === 'string' ? (value as VisibilityFilter) : 'all',
                      );
                    }}
                  />
                </div>
              </Tooltip>
              <Text fontSize={12} style={{ whiteSpace: 'nowrap' }} type={'secondary'}>
                {t('devices.total', { count: total })}
              </Text>
            </Flexbox>
          </Flexbox>

          <Flexbox>
            <div {...sx(styles.headerRow, { gridTemplateColumns: DEVICE_LIST_COLUMNS })}>
              <span>{t('devices.column.device')}</span>
              <span>{t('devices.column.owner')}</span>
              <span>{t('devices.column.scope')}</span>
              <span>{t('devices.column.online')}</span>
              <span>{t('devices.column.platform')}</span>
              <span>{t('devices.column.lastSeen')}</span>
              <span />
            </div>

            {isLoading && items.length === 0 ? (
              <Center height={240}>
                <Spin />
              </Center>
            ) : error ? (
              <Empty
                action={<Button onClick={() => void mutate()}>{t('devices.empty.retry')}</Button>}
                description={t('devices.error.generic')}
                title={t('devices.empty.title')}
              />
            ) : items.length === 0 ? (
              scope === 'workspace' && (stats?.workspace ?? 0) === 0 ? (
                /* Empty because the deployment has no workspace devices yet — not
                 * because the filters are wrong. Point at the flow that creates them. */
                <Empty
                  description={t('devices.empty.workspaceDescription')}
                  title={t('devices.empty.workspaceTitle')}
                  action={
                    <Button type={'primary'} onClick={() => navigate('/admin/workspaces')}>
                      {t('devices.empty.goWorkspaces')}
                    </Button>
                  }
                />
              ) : (
                <Empty
                  description={t('devices.empty.description')}
                  title={t('devices.empty.title')}
                  action={
                    hasFilters && <Button onClick={resetFilters}>{t('devices.empty.clear')}</Button>
                  }
                />
              )
            ) : (
              <>
                {pagePartial && (
                  <Text fontSize={12} style={{ paddingBlock: 8 }} type={'secondary'}>
                    {t('devices.pagePartial', { shown: items.length, total })}
                  </Text>
                )}
                {items.map((device) => (
                  <DeviceRow device={device} key={deviceRowKey(device)} onSelect={handleSelect} />
                ))}
              </>
            )}
          </Flexbox>

          {onlineStats && (
            <Text fontSize={12} type={'secondary'}>
              {t('devices.onlineStats', {
                offline: onlineStats.offline,
                online: onlineStats.online,
                unknown: onlineStats.unknown,
              })}
            </Text>
          )}

          {total > PAGE_SIZE && (
            <Pagination
              align={'end'}
              current={page}
              pageSize={PAGE_SIZE}
              showSizeChanger={false}
              total={total}
              onChange={(nextPage) => setPage(nextPage)}
            />
          )}
        </Flexbox>
      </SettingContainer>
    </>
  );
});

Devices.displayName = 'AdminDeviceOverview';

export default Devices;
