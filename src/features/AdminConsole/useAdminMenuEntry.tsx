'use client';

import { Flexbox, Icon, Tag } from '@lobehub/ui';
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { MenuProps } from '@/components/Menu';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { useAdminWhoami } from './hooks/useAdminWhoami';

/**
 * The user-panel entry for `/admin`.
 *
 * Kept next to the console so the shared menu only wires it in: non-admins get
 * an empty list, and the item never renders before `whoami` confirms the role.
 */
export const useAdminMenuEntry = (enabled?: boolean): MenuProps['items'] => {
  const { t } = useTranslation('common');
  const navigate = useWorkspaceAwareNavigate();
  const { data } = useAdminWhoami(enabled === true);

  if (!data?.isAdmin) return [];

  return [
    {
      icon: <Icon icon={ShieldCheck} />,
      key: 'admin-console',
      label: (
        <Flexbox horizontal align={'center'} gap={6}>
          <span>{t('userPanel.adminConsole')}</span>
          <Tag color={'warning'} size={'small'}>
            {t('userPanel.adminRole')}
          </Tag>
        </Flexbox>
      ),
      onClick: () => navigate('/admin', { escape: true }),
    },
  ];
};
