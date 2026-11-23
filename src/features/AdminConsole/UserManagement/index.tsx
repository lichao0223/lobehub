'use client';

import {
  Button,
  Center,
  Empty,
  Flexbox,
  Pagination,
  SearchBar,
  Segmented,
  Spin,
  Text,
} from '@lobehub/ui';
import { useDebounce } from 'ahooks';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';
import { useDensityTokens } from '@/styles/density';
import { sx } from '@/styles/sx';

import { useAdminUsers } from '../hooks/useAdminUsers';
import { styles, USER_LIST_COLUMNS } from './style';
import UserDetailDrawer from './UserDetailDrawer';
import UserRow from './UserRow';

type UserFilter = 'all' | 'admin' | 'banned';

const PAGE_SIZE = 20;

const UserManagement = memo(() => {
  const { t } = useTranslation('setting');
  const tokens = useDensityTokens();

  const [keyword, setKeyword] = useState('');
  const debouncedKeyword = useDebounce(keyword, { wait: 300 }).trim();
  const [filter, setFilter] = useState<UserFilter>('all');
  const [page, setPage] = useState(1);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const params = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedKeyword || undefined,
      role: filter === 'admin' ? ('admin' as const) : undefined,
      status: filter === 'banned' ? ('banned' as const) : undefined,
    }),
    [debouncedKeyword, filter, page],
  );

  const { data, error, isLoading, mutate } = useAdminUsers(params);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasFilters = Boolean(debouncedKeyword) || filter !== 'all';

  const resetFilters = () => {
    setKeyword('');
    setFilter('all');
    setPage(1);
  };

  return (
    <>
      <NavHeader>
        <Text weight={500}>{t('adminConsole.users.title')}</Text>
      </NavHeader>
      <SettingContainer
        maxWidth={1024}
        paddingBlock={`${tokens.pagePaddingBlockStart}px 128px`}
        paddingInline={tokens.pagePaddingInline}
      >
        <Flexbox gap={16}>
          <Flexbox horizontal align={'center'} gap={12} justify={'space-between'} wrap={'wrap'}>
            <SearchBar
              allowClear
              placeholder={t('adminConsole.users.searchPlaceholder')}
              style={{ maxWidth: 320, minWidth: 220 }}
              value={keyword}
              variant={'filled'}
              onInputChange={(value) => {
                setKeyword(value);
                setPage(1);
              }}
            />
            <Flexbox horizontal align={'center'} gap={12}>
              <Segmented
                size={'small'}
                value={filter}
                options={[
                  { label: t('adminConsole.users.filter.all'), value: 'all' },
                  { label: t('adminConsole.users.filter.admin'), value: 'admin' },
                  { label: t('adminConsole.users.filter.banned'), value: 'banned' },
                ]}
                onChange={(value) => {
                  setFilter(value as UserFilter);
                  setPage(1);
                }}
              />
              <Text fontSize={12} type={'secondary'}>
                {t('adminConsole.users.total', { count: total })}
              </Text>
            </Flexbox>
          </Flexbox>

          <Flexbox>
            <div {...sx(styles.headerRow, { gridTemplateColumns: USER_LIST_COLUMNS })}>
              <span>{t('adminConsole.users.column.user')}</span>
              <span>{t('adminConsole.users.column.account')}</span>
              <span>{t('adminConsole.users.column.role')}</span>
              <span>{t('adminConsole.users.column.status')}</span>
              <span>{t('adminConsole.users.column.lastActive')}</span>
              <span />
            </div>

            {isLoading && items.length === 0 ? (
              <Center height={240}>
                <Spin />
              </Center>
            ) : error ? (
              <Empty
                description={t('adminConsole.users.error.generic')}
                title={t('adminConsole.users.empty.title')}
                action={
                  <Button onClick={() => void mutate()}>
                    {t('adminConsole.users.empty.clear')}
                  </Button>
                }
              />
            ) : items.length === 0 ? (
              <Empty
                description={t('adminConsole.users.empty.description')}
                title={t('adminConsole.users.empty.title')}
                action={
                  hasFilters && (
                    <Button onClick={resetFilters}>{t('adminConsole.users.empty.clear')}</Button>
                  )
                }
              />
            ) : (
              items.map((user) => (
                <UserRow key={user.id} user={user} onSelect={setSelectedUserId} />
              ))
            )}
          </Flexbox>

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

      <UserDetailDrawer
        userId={selectedUserId}
        onChanged={() => void mutate()}
        onClose={() => setSelectedUserId(null)}
      />
    </>
  );
});

UserManagement.displayName = 'AdminUserManagement';

export default UserManagement;
