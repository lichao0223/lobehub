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
} from '@lobehub/ui';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';
import { useDensityTokens } from '@/styles/density';
import { sx } from '@/styles/sx';

import { useAdminDevices, useAdminDeviceStats } from '../hooks/useAdminDevices';
import DeviceDetailDrawer from './DeviceDetailDrawer';
import DeviceRow from './DeviceRow';
import { DEVICE_LIST_COLUMNS, styles } from './style';
import { useDeviceFilters } from './useDeviceFilters';
import type { DeviceSelection, OnlineFilter, ScopeFilter, VisibilityFilter } from './utils';
import {
  buildDeviceListParams,
  deviceRowKey,
  deviceSelection,
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

  // The same deviceId can exist in two pools, so the open row is identified by
  // the pair, not the id alone.
  const [selectedDevice, setSelectedDevice] = useState<DeviceSelection | null>(null);

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
    setSelectedDevice(deviceSelection(device));
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
              style={{ maxWidth: 320, minWidth: 220 }}
              value={keyword}
              variant={'filled'}
              onInputChange={(value) => setKeyword(value)}
            />
            <Flexbox horizontal align={'center'} gap={12} wrap={'wrap'}>
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
                style={{ minWidth: 132 }}
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
              {scope === 'workspace' && (
                <Select
                  style={{ minWidth: 132 }}
                  value={visibility}
                  options={[
                    { label: t('devices.filter.visibility.all'), value: 'all' },
                    { label: t('devices.visibility.private'), value: 'private' },
                    { label: t('devices.visibility.public'), value: 'public' },
                  ]}
                  onChange={(value) => {
                    setVisibility(typeof value === 'string' ? (value as VisibilityFilter) : 'all');
                  }}
                />
              )}
              <Text fontSize={12} type={'secondary'}>
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
              <Empty
                description={t('devices.empty.description')}
                title={t('devices.empty.title')}
                action={
                  hasFilters && <Button onClick={resetFilters}>{t('devices.empty.clear')}</Button>
                }
              />
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
      <DeviceDetailDrawer
        selected={selectedDevice}
        onClose={() => {
          setSelectedDevice(null);
        }}
      />
    </>
  );
});

Devices.displayName = 'AdminDeviceOverview';

export default Devices;
