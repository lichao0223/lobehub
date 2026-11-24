'use client';

import { Flexbox } from '@lobehub/ui';
import { Server, Users } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import NavItem from '@/features/NavPanel/components/NavItem';
import SectionTitle from '@/features/NavPanel/components/SectionTitle';
import { useActiveLocation } from '@/hooks/useActiveLocation';

const USERS_PATH = '/admin';
const MODEL_SERVICE_PATH = '/admin/model-service';

const Body = memo(() => {
  const { t } = useTranslation('setting');
  const { pathname } = useActiveLocation();

  const usersActive = pathname === USERS_PATH || pathname.startsWith(`${USERS_PATH}/users`);
  const modelServiceActive = pathname.startsWith(MODEL_SERVICE_PATH);

  return (
    <Flexbox gap={4} paddingInline={4}>
      <Flexbox gap={1} paddingBlock={1}>
        <SectionTitle>{t('adminConsole.group.management')}</SectionTitle>
        <Link to={USERS_PATH}>
          <NavItem active={usersActive} icon={Users} title={t('adminConsole.nav.users')} />
        </Link>
        <Link to={MODEL_SERVICE_PATH}>
          <NavItem
            active={modelServiceActive}
            icon={Server}
            title={t('adminConsole.nav.modelService')}
          />
        </Link>
      </Flexbox>
    </Flexbox>
  );
});

Body.displayName = 'AdminConsoleBody';

export default Body;
