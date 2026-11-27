'use client';

import { Flexbox } from '@lobehub/ui';
import { Building2, FlaskConical, MonitorSmartphone, Server, Users } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import NavItem from '@/features/NavPanel/components/NavItem';
import SectionTitle from '@/features/NavPanel/components/SectionTitle';
import { useActiveLocation } from '@/hooks/useActiveLocation';

const USERS_PATH = '/admin';
const DEVICES_PATH = '/admin/devices';
const WORKSPACES_PATH = '/admin/workspaces';
const MODEL_SERVICE_PATH = '/admin/model-service';
const LABS_PATH = '/admin/labs';

const Body = memo(() => {
  const { t } = useTranslation('adminConsole');
  const { pathname } = useActiveLocation();

  const usersActive = pathname === USERS_PATH || pathname.startsWith(`${USERS_PATH}/users`);
  const devicesActive = pathname.startsWith(DEVICES_PATH);
  const workspacesActive = pathname.startsWith(WORKSPACES_PATH);
  const modelServiceActive = pathname.startsWith(MODEL_SERVICE_PATH);
  const labsActive = pathname.startsWith(LABS_PATH);

  return (
    <Flexbox gap={4} paddingInline={4}>
      <Flexbox gap={1} paddingBlock={1}>
        <SectionTitle>{t('group.management')}</SectionTitle>
        <Link to={USERS_PATH}>
          <NavItem active={usersActive} icon={Users} title={t('nav.users')} />
        </Link>
        <Link to={DEVICES_PATH}>
          <NavItem active={devicesActive} icon={MonitorSmartphone} title={t('nav.devices')} />
        </Link>
        <Link to={WORKSPACES_PATH}>
          <NavItem active={workspacesActive} icon={Building2} title={t('nav.workspaces')} />
        </Link>
        <Link to={MODEL_SERVICE_PATH}>
          <NavItem active={modelServiceActive} icon={Server} title={t('nav.modelService')} />
        </Link>
        <Link to={LABS_PATH}>
          <NavItem active={labsActive} icon={FlaskConical} title={t('nav.labs')} />
        </Link>
      </Flexbox>
    </Flexbox>
  );
});

Body.displayName = 'AdminConsoleBody';

export default Body;
