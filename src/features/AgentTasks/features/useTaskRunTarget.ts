'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceExecutionTarget, DeviceListItem, WorkingDirConfig } from '@lobechat/types';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveWorkspaceSurface } from '@/features/ChatInput/ControlBar/useWorkspaceSurface';
import { devicePoolForAgent, devicePoolForTask } from '@/features/ExecutionTargetPicker';
import { resolveAgentWorkingDirectoryConfig } from '@/helpers/agentWorkingDirectory';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { getWorkingDirectoryPathString } from '@/helpers/workingDirectoryPath';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useDeviceList } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import { useProjectDirectories, useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

export type DeviceLabelSource = Pick<DeviceListItem, 'deviceId' | 'friendlyName' | 'hostname'>;

export const deviceLabel = (device: DeviceLabelSource, unknownLabel: string) =>
  device.friendlyName || device.hostname || unknownLabel;

/**
 * A project folder is a path on one machine, so it only names something where
 * its own platform can read it. Mirrors the server resolver's check.
 */
const isAbsoluteDevicePath = (value: string, platform?: string | null): boolean => {
  if (platform === 'win32') return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\');
  if (!platform) return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value);
  return value.startsWith('/');
};

/**
 * Why the run-location control is locked, for its tooltip. An author-fixed
 * policy (or a disabled form) says so; a target still waiting on the device
 * list is only being checked, not fixed.
 */
export const getTaskDeviceLockReason = ({
  canSelect,
  disabled,
  isPending,
}: {
  canSelect: boolean;
  disabled?: boolean;
  isPending: boolean;
}): 'fixed' | 'pending' | undefined => {
  if (disabled || !canSelect) return 'fixed';
  if (isPending) return 'pending';
  return undefined;
};

/**
 * What the directory axis can offer, which is a property of the TARGET and not
 * of the task: a cloud repo identifier and a path on a machine are the same
 * axis in different units, so the control has to follow where the run goes.
 *
 * - `device` — the run lands on a machine, so the directory is an absolute path
 *   on it (a repo identifier would mean nothing there).
 * - `repo` — the run lands in the server cloud sandbox, where the identifier
 *   IS the directory.
 * - `none` — nothing choosable here; report the inherited state as a hint
 *   rather than offering a control that cannot take effect.
 */
export type TaskDirectoryKind = 'device' | 'none' | 'repo';

export interface TaskRunTarget {
  /** Whether the task may pick a target at all — the assignee's policy owns this. */
  canSelect: boolean;
  /** The machine the run lands on (task pin → agent bound device). */
  deviceId?: string;
  /**
   * The devices this task may pin — the pool its runs can reach, not every
   * device the caller can see (see `devicePoolForAgent`).
   */
  devices?: DeviceListItem[];
  /**
   * The device list could not be confirmed: its request failed and no retry is
   * in flight. The stored rows still cannot be pinned, but the control stays
   * open so the user can retry ({@link retryDevices}) or follow the agent.
   */
  devicesFailed: boolean;
  directoryKind: TaskDirectoryKind;
  /** Where the run lands: the task's pin if it has one, else the agent's own target. */
  effectiveTarget: DeviceExecutionTarget;
  /**
   * The machine the assignee agent's own target lands on, when it names one. The
   * "follow the agent" state starts from it, and the device list marks it.
   */
  inheritedDeviceId?: string;
  /**
   * The directory the run will start in when the task does not choose one,
   * resolved through the same chain the runtime uses. Shown as the greyed hint
   * so inheritance is legible instead of a black box.
   */
  inheritedDirectory?: WorkingDirConfig;
  /**
   * Where {@link inheritedDirectory} came from: the agent's own choice (or the
   * machine default), or the project's folder on that machine. A project
   * folder is what the server falls back to when the agent names none, so the
   * hint must show it rather than an empty "no directory" state.
   */
  inheritedDirectorySource?: 'agent' | 'project';
  /** Label for the target the task inherits — the same wording the chat chip uses. */
  inheritedLabel: string;
  /**
   * What the run would do with no pin. Kept alongside {@link effectiveTarget} so
   * the "follow the agent" row can show the inherited glyph even while the task
   * is pinned somewhere else.
   */
  inheritedTarget: DeviceExecutionTarget;
  /** Whether a task-level pin is what puts the run on {@link deviceId}. */
  isDeviceTarget: boolean;
  /**
   * The target controls must wait: the preference is loading, or the device
   * list is still the stored copy. Its rows may since have been deleted or
   * unshared, and a pin stored from one would point the task's runs at a
   * machine they cannot resolve.
   */
  isPending: boolean;
  /**
   * The task's own pin, and only when the assignee's policy lets it take
   * effect. Callers must read this rather than the raw stored value: a pin the
   * run side drops must not be shown as the target.
   */
  pinnedDeviceId?: string;
  /** Re-request the device list after {@link devicesFailed}. */
  retryDevices: () => void;
}

/**
 * Resolve where a task's runs go, and what its directory axis may offer.
 *
 * One source of truth for the two chips and the hint between them, so the run
 * location control and the directory control cannot disagree about the machine
 * in force — which is exactly how a task ends up storing a repo as the
 * directory of a device run.
 *
 * The task's own pin wins over the agent's target: the run contract routes a
 * `requestedDeviceId` regardless of the agent's stored target. An author-`fixed`
 * policy is the exception — the run side drops the requested device for it, so
 * this reports the inherited target instead of the stored pin.
 */
export const useTaskRunTarget = (
  agentId: string,
  pinnedDeviceId: string | undefined,
  {
    canPinPrivateDevices,
    projectId,
  }: {
    canPinPrivateDevices: boolean;
    /** The task's project, whose own folders are the run's last-resort cwd. */
    projectId?: string;
  },
): TaskRunTarget => {
  const { t } = useTranslation('chat');
  const {
    data: devices,
    error: devicesError,
    isConfirmed: isDevicesConfirmed,
    isLoading: isDevicesLoading,
    isValidating: isDevicesValidating,
    mutate: refreshDevices,
  } = useDeviceList();
  const isHetero = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
  // Agent-level, not the active chat topic's: a task run carries no topic
  // binding, so the conversation that happens to be open must not move it.
  const { agencyConfig, canSelectExecutionTarget, isPreferenceLoading, workspaceScoped } =
    useEffectiveAgencyConfig(agentId, { topicId: null });
  const deviceRoutingAvailable = useIsGatewayModeEnabled(agentId);
  const legacyAgentWorkingDirectory = useAgentStore(
    (s) => s.localAgentWorkingDirectoryMap[agentId],
  );
  const agentWorkspaceId = useAgentStore((s) => s.agentMap[agentId]?.workspaceId);
  // This desktop's own device id — the machine a `local` target means here.
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);

  // The pool a task may pin from must be the pool its runs can reach: a deviceId
  // carries the identity it was enrolled under, so a workspace agent cannot run
  // on a personal machine (and vice versa) — and a Task's scheduled runs execute
  // under the workspace principal, not under whoever is looking at it, so a pin
  // outside the pool is one automation can never resolve. Same rule the chat
  // picker applies, shared through `devicePoolForAgent` so the two cannot drift.
  // The caller's own private rows only when they are the task's creator, whose
  // identity the scheduled runs use (see `devicePoolForTask`).
  const agentPool = devicePoolForAgent(devices, !!agentWorkspaceId);
  const pool = devicePoolForTask(devices, !!agentWorkspaceId, {
    includeOwnPrivate: canPinPrivateDevices,
  });

  const inheritedTarget = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: isDesktop,
    deviceRoutingAvailable,
    isHetero,
    workspaceScoped,
  });

  // A `fixed` selection policy is an author-controlled contract, and the run
  // side already honours it: the planner drops a requested device for it
  // (`resolveExecutionPlan`), and `turnSetup` writes no topic-bound device. So a
  // pin left on the task must NOT be presented as the run's target — nor used to
  // resolve a directory on a machine the run never reaches, which the topic
  // metadata would then still carry.
  const pinApplies = !!pinnedDeviceId && canSelectExecutionTarget;
  const isDeviceTarget = pinApplies;
  const effectiveTarget: DeviceExecutionTarget = pinApplies ? 'device' : inheritedTarget;
  // A workspace agent's `local` target is the member's own personal machine,
  // which is never in a workspace task pool; offering it would pin a device the
  // task's runs cannot resolve.
  const localCandidate = agencyConfig?.boundDeviceId || currentDeviceId;
  const localDeviceId =
    localCandidate &&
    (!agentWorkspaceId || pool.some((device) => device.deviceId === localCandidate))
      ? localCandidate
      : undefined;

  // A `local` target is a machine too — this desktop. A task run carries no
  // `localDeviceId`, so the server routes it to the agent's bound device (the
  // desktop syncs its own id there); fall back to this desktop's id when the
  // binding has not been written yet. Without this the directory axis showed a
  // dead "Follow agent" hint, although the run starts in a path on a machine.
  // Picking a directory then pins this machine (`applyTaskDirectorySelection`),
  // so the run is routed to where the path exists.
  const inheritedDeviceId =
    inheritedTarget === 'device'
      ? agencyConfig?.boundDeviceId
      : inheritedTarget === 'local'
        ? localDeviceId
        : undefined;
  const deviceId = pinApplies ? pinnedDeviceId : inheritedDeviceId;

  // From the device list this hook already fetched, not the device store,
  // which a task page may never populate.
  const deviceDefaultCwd = getWorkingDirectoryPathString(
    devices?.find((device) => device.deviceId === deviceId)?.defaultCwd ?? undefined,
  );

  // Only a device run has a machine whose default could apply; asking for one
  // otherwise would describe a directory the cloud run never uses.
  //
  // The server resolves the cwd through one chain: topic → initial → agent →
  // device default → the project's own folder on that machine. The last step is
  // invisible in the agent config, so it is read here too — otherwise "follow
  // the agent" showed an empty directory while the run actually started in the
  // project's folder (or, worse, reported one where the run had none).
  useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId, !!projectId);
  const projectDirectories = useProjectDirectories(projectId);
  // The machine's own platform decides which path shapes it can read — the same
  // check the server applies (`resolveDeviceWorkingDirectoryResolution`).
  const devicePlatform = devices?.find((device) => device.deviceId === deviceId)?.platform;
  const projectDirectory = useMemo(() => {
    if (!deviceId || !projectId) return undefined;
    const usable = projectDirectories.filter(
      (row) =>
        row.deviceId === deviceId &&
        row.permission === 'readWrite' &&
        isAbsoluteDevicePath(row.path, devicePlatform),
    );
    const [row] = [...usable].sort((a, b) => {
      if (!!a.isPrimary !== !!b.isPrimary) return a.isPrimary ? -1 : 1;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });
    return row;
  }, [deviceId, devicePlatform, projectDirectories, projectId]);

  const agentDirectory = useMemo(
    () =>
      deviceId
        ? resolveAgentWorkingDirectoryConfig({
            agencyConfig,
            // The machine in force decides which per-device choice applies.
            currentDeviceId: deviceId,
            deviceDefaultCwd,
            legacyAgentWorkingDirectory,
            workspaceScoped,
          })
        : undefined,
    [agencyConfig, deviceDefaultCwd, deviceId, legacyAgentWorkingDirectory, workspaceScoped],
  );

  const inheritedDirectory: WorkingDirConfig | undefined =
    agentDirectory ?? (projectDirectory ? { path: projectDirectory.path } : undefined);
  const inheritedDirectorySource: 'agent' | 'project' | undefined = agentDirectory
    ? 'agent'
    : projectDirectory
      ? 'project'
      : undefined;

  // A list since the sandbox landed: more than one surface can apply to the
  // same run, so membership rather than equality.
  const surfaces = resolveWorkspaceSurface({
    agencyConfig,
    alwaysShowWorkspace: isHetero,
    clientExecutionAvailable: isDesktop,
    deviceRoutingAvailable,
    isHetero,
    workspaceScoped,
  });

  // The machine in force can come from the task's own pin OR from the assignee
  // (a bound `device` target) — both mean the run starts in a path on that
  // machine, so both must offer the directory control. Requiring a TASK-level
  // pin here left an inherited device run with a non-interactive hint and no way
  // to choose a directory, even though the stored config and the runner support
  // a directory without one.
  const directoryKind: TaskDirectoryKind = deviceId
    ? 'device'
    : surfaces.includes('cloudRepo')
      ? 'repo'
      : 'none';

  const unknownLabel = t('heteroAgent.executionTarget.unknownDevice');
  const inheritedLabel = (() => {
    if (inheritedTarget === 'device') {
      // The agent's own binding may be a private device: label it from the
      // agent's pool, not the narrower set a task may pin.
      const bound = agentPool.find((device) => device.deviceId === agencyConfig?.boundDeviceId);
      return bound ? deviceLabel(bound, unknownLabel) : unknownLabel;
    }
    return t(`heteroAgent.executionTarget.${inheritedTarget}`);
  })();

  const devicesFailed = !isDevicesConfirmed && !!devicesError && !isDevicesValidating;
  const retryDevices = useCallback(() => void refreshDevices(), [refreshDevices]);

  return {
    canSelect: canSelectExecutionTarget,
    deviceId,
    devices: pool,
    devicesFailed,
    directoryKind,
    effectiveTarget,
    inheritedDeviceId,
    inheritedDirectory,
    inheritedDirectorySource,
    inheritedLabel,
    inheritedTarget,
    isDeviceTarget,
    isPending: isPreferenceLoading || isDevicesLoading || (!isDevicesConfirmed && !devicesFailed),
    pinnedDeviceId: pinApplies ? pinnedDeviceId : undefined,
    retryDevices,
  };
};
