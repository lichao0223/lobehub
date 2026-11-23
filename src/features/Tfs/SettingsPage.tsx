'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { TfsIntegration } from '@/features/Integrations/Tfs';
import SettingHeader from '@/features/Settings/features/SettingHeader';

interface PageProps {
  mobile?: boolean;
  showSettingHeader?: boolean;
}

/**
 * Settings → TFS / Azure DevOps.
 *
 * Upstream retired the shared Integrations directory and moved GitHub / Linear
 * onto their Marketplace connector pages; TFS is a deployment-local integration,
 * so it keeps a settings tab of its own instead of following them.
 */
const Page = ({ showSettingHeader = true }: PageProps) => {
  const { t } = useTranslation('setting');

  return (
    <>
      {showSettingHeader && <SettingHeader title={t('tab.tfs')} />}
      <TfsIntegration />
    </>
  );
};

export default memo(Page);
