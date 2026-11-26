'use client';

import type { AdminUserSummary } from '@lobechat/types';
import { Icon, Tag, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/Avatar';
import { useDensityTokens } from '@/styles/density';
import { sx } from '@/styles/sx';

import { styles, USER_LIST_COLUMNS } from './style';
import { formatDateTime, userDisplayName } from './utils';

interface UserRowProps {
  onSelect: (userId: string) => void;
  user: AdminUserSummary;
}

const UserRow = memo<UserRowProps>(({ user, onSelect }) => {
  const { t } = useTranslation('adminConsole');
  const tokens = useDensityTokens();
  const name = userDisplayName(user);

  return (
    <div
      {...sx(styles.row, {
        gridTemplateColumns: USER_LIST_COLUMNS,
        minHeight: tokens.listRowHeight,
      })}
      aria-label={name}
      role={'button'}
      tabIndex={0}
      onClick={() => onSelect(user.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(user.id);
        }
      }}
    >
      <div {...stylex.props(styles.userCell)}>
        <Avatar avatar={user.avatar} size={32} title={name} />
        <div {...stylex.props(styles.userText)}>
          <Text ellipsis weight={500}>
            {name}
          </Text>
          <Text ellipsis fontSize={12} type={'secondary'}>
            {user.email ?? '—'}
          </Text>
        </div>
      </div>

      <Text ellipsis fontSize={13} type={'secondary'}>
        {user.username ?? '—'}
      </Text>

      <div>
        <Tag color={user.role === 'admin' ? 'warning' : 'default'} size={'small'}>
          {t(user.role === 'admin' ? 'users.role.admin' : 'users.role.user')}
        </Tag>
      </div>

      <div>
        <Tag color={user.banned ? 'error' : 'success'} size={'small'}>
          {t(user.banned ? 'users.status.banned' : 'users.status.active')}
        </Tag>
      </div>

      <Text ellipsis fontSize={13} type={'secondary'}>
        {formatDateTime(user.lastActiveAt)}
      </Text>

      <Icon icon={ChevronRight} size={16} />
    </div>
  );
});

UserRow.displayName = 'AdminUserRow';

export default UserRow;
