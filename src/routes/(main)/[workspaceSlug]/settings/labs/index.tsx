'use client';

import { useEffect } from 'react';

import { useLabsSettingsVisible } from '@/features/AdminConsole/Labs/visibility';
import LabsSetting from '@/features/Settings/labs';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { WorkspaceSettingsTabs } from '@/types/workspaceSettings';

/**
 * Labs (experimental features) mirrored under `/:workspaceSlug/settings/labs`.
 * User-scoped preferences; the workspace shell renders the compact header, so
 * the page header is hidden.
 *
 * CUST-009: an admin-managed deployment replaces every user's lab flags, so a
 * direct link to this page falls back to the workspace General tab for anyone
 * who is not an administrator — the sidebar entry is hidden for the same
 * reason. Nothing renders in the meantime, so the dead toggles never flash.
 */
const WorkspaceLabsSetting = () => {
  const showLabs = useLabsSettingsVisible();
  const navigate = useWorkspaceAwareNavigate();

  useEffect(() => {
    if (!showLabs) {
      navigate(`/settings/${WorkspaceSettingsTabs.General}`, { replace: true });
    }
  }, [navigate, showLabs]);

  if (!showLabs) return null;

  return <LabsSetting showSettingHeader={false} />;
};

WorkspaceLabsSetting.displayName = 'WorkspaceLabsSetting';

export default WorkspaceLabsSetting;
