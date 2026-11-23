'use client';

import { Center, Flexbox, Spin } from '@lobehub/ui';
import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router';

import { useAdminWhoami } from './hooks/useAdminWhoami';
import SideBar from './Layout/SideBar';

/**
 * `/admin` shell and guard.
 *
 * Non-admins never see the console: the same `whoami` call also performs the
 * env allow-list bootstrap, so the first eligible visit turns into an admin
 * before the redirect decision is made.
 */
const AdminConsole = () => {
  const navigate = useNavigate();
  const { data, error, isLoading } = useAdminWhoami();

  useEffect(() => {
    if (isLoading) return;

    if (error) {
      // A signed-out visitor is sent to the auth surface; anything else (e.g. a
      // transient failure) falls back to the home page rather than a dead end.
      navigate(error?.data?.code === 'UNAUTHORIZED' ? '/signin' : '/', { replace: true });
      return;
    }

    if (data && !data.isAdmin) navigate('/', { replace: true });
  }, [data, error, isLoading, navigate]);

  if (isLoading || !data) {
    return (
      <Center height={'100%'} width={'100%'}>
        <Spin />
      </Center>
    );
  }

  if (!data.isAdmin) return null;

  return (
    <>
      <SideBar />
      <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
        <Outlet />
      </Flexbox>
    </>
  );
};

export default AdminConsole;
