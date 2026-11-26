import type { AdminDeviceDetail } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import enUS from '../../../../locales/en-US/adminConsole.json';
import zhCN from '../../../../locales/zh-CN/adminConsole.json';
import {
  CHANNEL_LABEL_KEYS,
  describeDeviceLoadError,
  MANAGED_PHASE_COLOR,
  MANAGED_PHASE_KEYS,
  projectDeviceDetail,
} from './detail';
import { deviceSelection, EMPTY_VALUE } from './utils';

const device: AdminDeviceDetail = {
  appVersion: '1.4.2',
  architecture: 'arm64',
  channelCount: 1,
  channels: [{ channel: 'desktop', connectedAt: new Date('2026-11-01T10:00:00Z') }],
  cliVersion: '0.9.0',
  deviceId: 'dev_abc123',
  firstSeenAt: new Date('2026-09-01T08:00:00Z'),
  friendlyName: "Ada's MacBook",
  hasFixedAgentBinding: true,
  hostname: 'ada-mbp.local',
  identitySource: 'desktop-app',
  lastSeenAt: new Date('2026-11-20T12:00:00Z'),
  managedPhase: 'suspended',
  online: 'online',
  owner: {
    avatar: undefined,
    email: 'ada@example.com',
    fullName: 'Ada Lovelace',
    userId: 'user_1',
    username: 'ada',
  },
  platform: 'darwin',
  scope: 'workspace',
  sharedFromDeviceId: 'dev_personal_9',
  visibility: 'public',
  workspace: { name: 'Research', workspaceId: 'ws_1' },
};

describe('projectDeviceDetail', () => {
  it('projects a shared workspace device section by section', () => {
    const view = projectDeviceDetail(device);

    expect(view.device).toMatchObject({
      architecture: 'arm64',
      deviceId: 'dev_abc123',
      friendlyName: "Ada's MacBook",
      hostname: 'ada-mbp.local',
      identitySource: 'desktop-app',
      name: "Ada's MacBook",
      platform: 'darwin',
      secondaryName: 'ada-mbp.local',
    });

    expect(view.ownership).toEqual({
      owner: device.owner,
      scope: 'workspace',
      sharedFromDeviceId: 'dev_personal_9',
      visibility: 'public',
      workspaceName: 'Research',
    });

    expect(view.connection.online).toBe('online');
    expect(view.connection.managedPhase).toBe('suspended');
    expect(view.connection.channels).toEqual([
      { channel: 'desktop', connectedAt: device.channels[0]!.connectedAt },
    ]);

    expect(view.version).toEqual({ appVersion: '1.4.2', cliVersion: '0.9.0' });
    expect(view.binding.hasFixedAgentBinding).toBe(true);
    expect(view.timeline).toEqual({
      firstSeenAt: device.firstSeenAt,
      lastSeenAt: device.lastSeenAt,
    });
  });

  it('drops the shared / visibility / phase rows for an ordinary personal device', () => {
    const view = projectDeviceDetail({
      ...device,
      channels: [],
      hasFixedAgentBinding: false,
      managedPhase: undefined,
      scope: 'personal',
      sharedFromDeviceId: null,
      visibility: null,
      workspace: null,
    });

    // `null` means "no row", so the drawer can skip it instead of printing a dash.
    expect(view.ownership.sharedFromDeviceId).toBeNull();
    expect(view.ownership.visibility).toBeNull();
    expect(view.ownership.workspaceName).toBeNull();
    expect(view.connection.managedPhase).toBeNull();
    expect(view.connection.channels).toEqual([]);
    expect(view.binding.hasFixedAgentBinding).toBe(false);
  });

  it('normalizes every absent value to an em dash, never null or undefined', () => {
    const view = projectDeviceDetail({
      ...device,
      appVersion: undefined,
      cliVersion: undefined,
      friendlyName: null,
      hostname: null,
      identitySource: '',
      sharedFromDeviceId: null,
      visibility: null,
    });

    expect(view.version).toEqual({ appVersion: EMPTY_VALUE, cliVersion: EMPTY_VALUE });
    expect(view.device.friendlyName).toBe(EMPTY_VALUE);
    expect(view.device.hostname).toBe(EMPTY_VALUE);
    expect(view.device.identitySource).toBe(EMPTY_VALUE);
    // The display name still falls back to something identifiable.
    expect(view.device.name).toBe('dev_abc123');

    // Every value the drawer renders as text is a string, never a nullish hole.
    for (const text of Object.values(view.version)) expect(typeof text).toBe('string');
    expect(view.device.friendlyName).not.toBe('');
    expect(JSON.stringify(view)).not.toContain('undefined');
  });

  it('keeps an unlabeled gateway channel addressable by the unknown label', () => {
    const view = projectDeviceDetail({
      ...device,
      channels: [{ channel: null, connectedAt: device.lastSeenAt }],
    });

    expect(view.connection.channels[0]!.channel).toBeNull();
    expect(CHANNEL_LABEL_KEYS.unknown).toBe('devices.channel.unknown');
  });

  it('never carries filesystem paths or the raw metadata blob into the view', () => {
    // A response that leaked far more than the whitelist allows.
    const leaky = {
      ...device,
      defaultCwd: '/Users/ada/secret-project',
      metadata: { appVersion: '1.4.2', recentCwds: ['/Users/ada/secret-project'] },
      recentCwds: ['/Users/ada/secret-project'],
      workingDirs: ['/Users/ada/secret-project', '/Users/ada/other'],
    } as unknown as AdminDeviceDetail;

    const serialized = JSON.stringify(projectDeviceDetail(leaky));

    expect(serialized).not.toContain('/Users/ada');
    expect(serialized).not.toContain('secret-project');
    expect(serialized).not.toContain('defaultCwd');
    expect(serialized).not.toContain('workingDirs');
    expect(serialized).not.toContain('recentCwds');
    expect(serialized).not.toContain('metadata');
  });
});

describe('managed phase mapping', () => {
  it('has a label key and a color slot for every phase', () => {
    // `deleting` deliberately maps to no tag color (it only appears offline), so
    // the assertion is on presence of the slot, not on a truthy color.
    for (const phase of Object.keys(MANAGED_PHASE_COLOR)) {
      expect(MANAGED_PHASE_KEYS[phase as keyof typeof MANAGED_PHASE_KEYS]).toBe(
        `devices.detail.phase.${phase}`,
      );
    }
    expect(Object.keys(MANAGED_PHASE_COLOR).sort()).toEqual(Object.keys(MANAGED_PHASE_KEYS).sort());
  });
});

describe('describeDeviceLoadError', () => {
  it('explains a deleted device without offering a retry', () => {
    expect(describeDeviceLoadError({ data: { code: 'NOT_FOUND' } })).toEqual({
      canRetry: false,
      descriptionKey: 'devices.detail.notFound.desc',
      notFound: true,
      titleKey: 'devices.detail.notFound.title',
    });
  });

  it('offers a retry for anything else, including a shapeless error', () => {
    for (const error of [
      new Error('gateway down'),
      { data: { code: 'INTERNAL_SERVER_ERROR' } },
      undefined,
    ]) {
      expect(describeDeviceLoadError(error)).toEqual({
        canRetry: true,
        descriptionKey: 'devices.detail.loadFailedDesc',
        notFound: false,
        titleKey: 'devices.detail.loadFailed',
      });
    }
  });

  it('never reuses the device-list copy inside one device', () => {
    // Regression: the detail pane used to fall back to `devices.error.generic`,
    // so a failed drawer read "the device *list* could not load".
    const failure = describeDeviceLoadError(new Error('gateway down'));

    expect(failure.descriptionKey).not.toBe('devices.error.generic');
    expect(failure.titleKey).not.toBe('devices.error.generic');
    expect(failure.descriptionKey).toSatisfy((key: string) => key.startsWith('devices.detail.'));
  });

  it('resolves every error key in both hand-written locales', () => {
    // The keys are typed, so a renamed key fails the type check — but a key that
    // exists in the type and not in a locale file still renders raw at runtime.
    const locales: Record<string, Record<string, unknown>> = {
      'en-US': enUS as Record<string, unknown>,
      'zh-CN': zhCN as Record<string, unknown>,
    };
    const failures = [
      describeDeviceLoadError({ data: { code: 'NOT_FOUND' } }),
      describeDeviceLoadError(new Error('gateway down')),
    ];

    for (const [locale, messages] of Object.entries(locales)) {
      for (const failure of failures) {
        for (const key of [failure.titleKey, failure.descriptionKey]) {
          const value = messages[key];

          expect(typeof value, `${locale}:${key}`).toBe('string');
          expect(value, `${locale}:${key}`).not.toBe('');
        }
      }
    }
  });
});

describe('deviceSelection', () => {
  it('addresses a workspace row by its own workspace', () => {
    expect(deviceSelection(device)).toEqual({
      deviceId: 'dev_abc123',
      ownerId: null,
      workspaceId: 'ws_1',
    });
  });

  it('addresses a personal row by its owner and a null workspace', () => {
    expect(deviceSelection({ ...device, scope: 'personal', workspace: null })).toEqual({
      deviceId: 'dev_abc123',
      ownerId: 'user_1',
      workspaceId: null,
    });
  });

  it('keeps the same deviceId apart in the two pools', () => {
    // A personal device shared into a workspace answers to the same id; opening
    // the wrong pool would show the other machine's details.
    const personal = deviceSelection({ ...device, scope: 'personal', workspace: null });
    const workspace = deviceSelection(device);

    expect(personal.deviceId).toBe(workspace.deviceId);
    expect(personal).not.toEqual(workspace);
  });

  it('keeps two owners of the same personal deviceId apart', () => {
    // `lh connect --device-id` can pin one id for two owners, so the drawer must
    // be addressed by the owner too — otherwise both open the same machine.
    const personal = { ...device, scope: 'personal', workspace: null } as AdminDeviceDetail;
    const alice = deviceSelection(personal);
    const bob = deviceSelection({ ...personal, owner: { ...personal.owner, userId: 'user_2' } });

    expect(alice.deviceId).toBe(bob.deviceId);
    expect(alice.ownerId).not.toBe(bob.ownerId);
  });
});
