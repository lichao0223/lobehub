import type { ChatTopicMetadata } from '@lobechat/types';
import { hasTfsGitSource } from '@lobechat/utils/tfs';

/**
 * Where a project's automatic checkout was placed on the drive:
 * `projects/<projectId>/<environmentId>`.
 *
 * Kept here because the Cloud Sandbox package no longer places project
 * checkouts on the drive — coding clones into a temporary sandbox now — yet
 * topics created before that change still carry the path in their metadata,
 * and they still need to be recognised so an automatic TFS checkout stays on
 * the caller's own drive.
 */
export const projectCheckoutDirectory = (projectId: string, environmentId: string) => {
  // One segment per id: ids are already path-safe (`prj_…`, UUIDs), any other
  // character becomes `_`, which also rules out `.`/`..` segments.
  const toSegment = (value: string) => value.replaceAll(/[^\w-]/g, '_');

  return `projects/${toSegment(projectId)}/${toSegment(environmentId)}`;
};

/** Repair only automatic project checkouts; never relocate a user-chosen shared folder. */
export const isPersonalTfsProjectCheckout = (
  topic: { metadata?: ChatTopicMetadata | null; projectId?: string | null },
  configuration?: Parameters<typeof hasTfsGitSource>[0],
) => {
  const { sandboxEnvironmentId, sandboxInstanceId, sandboxWorkingDirectory } = topic.metadata ?? {};
  return !!(
    topic.projectId &&
    sandboxEnvironmentId &&
    !sandboxInstanceId &&
    sandboxWorkingDirectory === projectCheckoutDirectory(topic.projectId, sandboxEnvironmentId) &&
    hasTfsGitSource(configuration)
  );
};
