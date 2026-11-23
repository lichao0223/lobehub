import { Icon } from '@lobehub/ui';
import { GitBranchIcon } from 'lucide-react';

/**
 * TFS has a settings tab of its own, so it is not registered in an integration
 * catalog: upstream retired the shared directory that used to own one.
 */
export const TfsIcon = ({ size = 24 }: { size?: number }) => (
  <Icon icon={GitBranchIcon} size={size} />
);
