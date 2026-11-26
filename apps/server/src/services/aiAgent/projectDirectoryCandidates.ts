import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import { ProjectWorkingDirectoryModel } from '@/database/models/projectWorkingDirectory';

import type { ProjectDirectoryCandidate } from './resolveDeviceWorkingDirectory';

const log = debug('lobe-server:ai-agent-service');

/**
 * The project's directories on the device a run lands on, for the cwd
 * precedence's last resort (`resolveDeviceWorkingDirectoryResolution`).
 *
 * A read only — a missing project, a missing device row or a failed query
 * leaves the run resolving exactly as it did before the fallback existed.
 * `deviceRowId` is the `devices.id` PK, not the gateway device id; callers pass
 * the device row they already read for `defaultCwd`.
 */
export const loadProjectDirectoryCandidates = async (params: {
  db: LobeChatDatabase;
  /** `devices.id` of the dispatch target; absent means no fallback is possible. */
  deviceRowId?: string | null;
  projectId?: string | null;
  userId: string;
  workspaceId?: string;
}): Promise<ProjectDirectoryCandidate[] | undefined> => {
  const { db, deviceRowId, projectId, userId, workspaceId } = params;
  if (!projectId || !deviceRowId) return undefined;

  try {
    return await new ProjectWorkingDirectoryModel(db, userId, workspaceId).listForDevice(
      projectId,
      deviceRowId,
    );
  } catch (error) {
    log(
      'project directory fallback unavailable for project=%s device=%s: %O',
      projectId,
      deviceRowId,
      error,
    );
    return undefined;
  }
};
