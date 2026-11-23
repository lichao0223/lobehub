'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

const Header = memo(() => {
  const { t } = useTranslation('setting');

  return (
    <SideBarHeaderLayout
      breadcrumb={[
        {
          href: '/admin',
          title: t('adminConsole.title'),
        },
      ]}
    />
  );
});

export default Header;
