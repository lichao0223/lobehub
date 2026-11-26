import path from 'node:path';

import type { WorkingDirConfig, WorkingDirConfigValue } from '@lobechat/types';
import { getWorkingDirEffectivePath } from '@lobechat/types';

/**
 * A project directory binding on the device this run lands on
 * (`project_working_directories`), reduced to what the precedence needs.
 * Callers read only the rows of the run's own project on the run's own device.
 */
export interface ProjectDirectoryCandidate {
  isPrimary?: boolean | null;
  path: string;
  sortOrder?: number | null;
}

/** Which precedence level produced a resolved cwd. */
export type DeviceWorkingDirectorySource =
  'agent' | 'deviceDefault' | 'initial' | 'project' | 'topic';

export interface DeviceWorkingDirectoryResolution {
  config?: WorkingDirConfig;
  /** Absent when nothing resolved — the run has no working directory at all. */
  source?: DeviceWorkingDirectorySource;
}

const toWorkingDirConfig = (
  value: WorkingDirConfigValue | null | undefined,
): WorkingDirConfig | undefined => {
  if (!value) return;
  return typeof value === 'string' ? { path: value } : value;
};

/**
 * A topic's pinned cwd is a bare path recorded on one machine, so it only
 * holds on that machine. `topicDeviceId` (`topic.metadata.boundDeviceId`) names
 * it when known; for older topics without one, a Windows drive/UNC path on a
 * non-Windows device is the tell-tale that the pin came from elsewhere.
 */
const topicPinFitsDevice = (
  pinnedPath: string | undefined,
  params: { deviceId?: string; devicePlatform?: string | null; topicDeviceId?: string },
): boolean => {
  if (params.deviceId && params.topicDeviceId && params.deviceId !== params.topicDeviceId)
    return false;
  if (
    pinnedPath &&
    params.devicePlatform &&
    params.devicePlatform !== 'win32' &&
    path.win32.isAbsolute(pinnedPath) &&
    !path.posix.isAbsolute(pinnedPath)
  )
    return false;
  return true;
};

/**
 * A device path has to be absolute in that device's own flavour: a Windows
 * drive path is not a Linux path, and a relative one names nothing at all on
 * the machine the run lands on. An unknown platform accepts either shape —
 * the only check available without the device row.
 */
const isAbsoluteDevicePath = (value: string | undefined, platform?: string | null): boolean => {
  if (!value) return false;
  if (platform === 'win32') return path.win32.isAbsolute(value);
  if (platform) return path.posix.isAbsolute(value);
  return path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
};

/**
 * The project directory a run falls back to on its own device: the primary
 * binding first, then the stored place (`sortOrder`), then the order the rows
 * arrived in. A candidate that is not an absolute path on this device — or is
 * one of the run's repo identifiers — is skipped rather than trusted.
 */
const pickProjectDirectory = (
  candidates: ReadonlyArray<ProjectDirectoryCandidate> | null | undefined,
  params: { devicePlatform?: string | null; isRepoIdentifier: (path?: string) => boolean },
): ProjectDirectoryCandidate | undefined => {
  const usable = (candidates ?? []).filter(
    (candidate) =>
      isAbsoluteDevicePath(candidate.path, params.devicePlatform) &&
      !params.isRepoIdentifier(candidate.path),
  );
  // `Array#sort` is stable, so equal places keep the query's own order (by
  // creation time) instead of an arbitrary one.
  return [...usable].sort((a, b) => {
    if (!!a.isPrimary !== !!b.isPrimary) return a.isPrimary ? -1 : 1;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  })[0];
};

/**
 * Resolve the working directory for a device-bound run, and say which source
 * produced it.
 *
 * Single source of truth for cwd precedence, shared by every server site that
 * needs it (hetero dispatch, workspace-init scan, new-topic backfill) so they
 * cannot drift. Mirrors the client picker's write rules in
 * `useCommitWorkingDirectory`:
 *
 *   topic override > brand-new-topic initial metadata > agent's per-device
 *   choice > device default > the project's directory on that device.
 *
 * - `topicWorkingDirectory` — an existing topic's pinned cwd
 *   (`topic.metadata.workingDirectory`); wins once a conversation exists, but
 *   only on the device it was pinned on (`topicDeviceId` / `devicePlatform`).
 *   Another device — a sub-agent, or the agent moved to a new machine — skips
 *   it and resolves its own directory from the sources below.
 * - `initialWorkingDirectory` — only populated for a brand-new topic
 *   (`appContext.initialTopicMetadata.workingDirectory`, e.g. the primary repo).
 * - `workingDirByDevice[deviceId]` — the agent's per-device pick from the picker
 *   when no topic existed yet.
 * - `deviceDefaultCwd` — the device's user-configured default.
 * - `projectDirectories` — the project's own directories ON THIS DEVICE (see
 *   `ProjectWorkingDirectoryModel.listForDevice`). The last resort: a project
 *   that registered `<device>:/repo` as a runner expects its task runs to start
 *   there even when neither the agent nor the device names a folder. Without
 *   this, such a run had no cwd at all and every cwd-gated step — TFS checkout
 *   and the push credentials it injects included — was silently skipped.
 *
 * A source that holds a REPO IDENTIFIER is skipped rather than trusted: see
 * `isRepoIdentifier` below — the selection's unit has to match the run's target.
 */
export const resolveDeviceWorkingDirectoryResolution = (params: {
  deviceDefaultCwd?: string | null;
  deviceId?: string;
  devicePlatform?: string | null;
  initialWorkingDirectory?: string;
  initialWorkingDirectoryConfig?: WorkingDirConfig;
  /** The project's directories on this device, ordered or not; see `pickProjectDirectory`. */
  projectDirectories?: ReadonlyArray<ProjectDirectoryCandidate> | null;
  /** Repos this run carries (`topic.metadata.repos`, seeded from a Task's own selection). */
  repos?: string[];
  topicDeviceId?: string;
  topicWorkingDirectory?: string;
  topicWorkingDirectoryConfig?: WorkingDirConfig;
  workingDirByDevice?: Record<string, WorkingDirConfigValue> | null;
}): DeviceWorkingDirectoryResolution => {
  // `owner/repo` is a repo, not a directory on this machine: taking one as the
  // device cwd would override the machine's own choice with a path that does not
  // exist here, and the spawned CLI would start in it. A real machine path is
  // absolute, so it can never equal a repo entry; skipping these costs nothing
  // when the run is genuinely cloud-bound (the sandbox reads `repos`, not the cwd).
  const isRepoIdentifier = (value?: string): boolean =>
    !!value && (params.repos ?? []).includes(value);

  const topicPin =
    params.topicWorkingDirectoryConfig ??
    (params.topicWorkingDirectory ? { path: params.topicWorkingDirectory } : undefined);
  if (topicPin && topicPinFitsDevice(topicPin.path, params) && !isRepoIdentifier(topicPin.path)) {
    return { config: topicPin, source: 'topic' };
  }

  const initialConfig = params.initialWorkingDirectoryConfig;
  if (initialConfig && !isRepoIdentifier(initialConfig.path)) {
    return { config: initialConfig, source: 'initial' };
  }
  if (params.initialWorkingDirectory && !isRepoIdentifier(params.initialWorkingDirectory)) {
    return { config: { path: params.initialWorkingDirectory }, source: 'initial' };
  }

  const agentChoice = toWorkingDirConfig(
    params.deviceId ? params.workingDirByDevice?.[params.deviceId] : undefined,
  );
  if (agentChoice) return { config: agentChoice, source: 'agent' };
  if (params.deviceDefaultCwd) {
    return { config: { path: params.deviceDefaultCwd }, source: 'deviceDefault' };
  }

  const projectDirectory = pickProjectDirectory(params.projectDirectories, {
    devicePlatform: params.devicePlatform,
    isRepoIdentifier,
  });
  if (projectDirectory) {
    return { config: { path: projectDirectory.path }, source: 'project' };
  }

  return {};
};

export const resolveDeviceWorkingDirectoryConfig = (
  params: Parameters<typeof resolveDeviceWorkingDirectoryResolution>[0],
): WorkingDirConfig | undefined => resolveDeviceWorkingDirectoryResolution(params).config;

export const resolveDeviceWorkingDirectory = (
  params: Parameters<typeof resolveDeviceWorkingDirectoryConfig>[0],
): string | undefined => {
  const config = resolveDeviceWorkingDirectoryConfig(params);
  return getWorkingDirEffectivePath(config);
};
