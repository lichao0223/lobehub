'use client';

import { Flexbox } from '@lobehub/ui';
import { Users } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import NavItem from '@/features/NavPanel/components/NavItem';
import SectionTitle from '@/features/NavPanel/components/SectionTitle';
import { useActiveLocation } from '@/hooks/useActiveLocation';

const USERS_PATH = '/admin';

const Body = memo(() => {
  const { t } = useTranslation('setting');
  const location = useActiveLocation();

  return (
    <Flexbox gap={4} paddingInline={4}>
      <Flexbox gap={1} paddingBlock={1}>
        <SectionTitle>{t('adminConsole.group.management')}</SectionTitle>
        <Link to={USERS_PATH}>
          <NavItem
            active={location.pathname.startsWith(USERS_PATH)}
            icon={Users}
            title={t('adminConsole.nav.users')}
          />
        </Link>
      </Flexbox>
    </Flexbox>
  );
});

Body.displayName = 'AdminConsoleBody';

export default Body;
