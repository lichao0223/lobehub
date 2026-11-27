import { SERVICE_MODEL_TIER_SLOTS } from '@lobechat/const';
import type { AdminConsoleAiDefaults, CompanyModel, ServiceModelTier } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CompanyProviderModule from '../companyProvider';
import {
  getCompanyServiceDefaultModel,
  getCompanyServiceDefaults,
  resolveCompanyServiceDefaults,
} from './serviceDefaults';

const mocks = vi.hoisted(() => ({ getCompanyProviderRuntimeFromServer: vi.fn() }));

// Only the server-database lookup is stubbed: the mapping itself runs for real
// against a runtime handed in directly, so no DB or KEY_VAULTS_SECRET is needed.
vi.mock('../companyProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof CompanyProviderModule>();

  return {
    ...actual,
    getCompanyProviderRuntimeFromServer: mocks.getCompanyProviderRuntimeFromServer,
  };
});

const model = (
  id: string,
  type: CompanyModel['type'],
  extra: Partial<CompanyModel> = {},
): CompanyModel => ({ id, name: id, open: true, source: 'manual', type, ...extra });

const chatModel = model('tellhow-chat', 'chat');
const flashModel = model('tellhow-flash', 'chat');
const visionModel = model('tellhow-vision', 'chat', { capabilities: ['vision'] });
const embeddingModel = model('tellhow-embedding', 'embedding');

const runtimeOf = (defaults: AdminConsoleAiDefaults, models: CompanyModel[]) => ({
  apiKey: 'sk-company-secret',
  baseURL: 'http://10.20.30.40:8080/v1',
  defaults,
  models,
});

const tellhow = (id: string) => ({ model: id, provider: 'tellhow' });

describe('resolveCompanyServiceDefaults', () => {
  it('maps each administrator id to every slot of its tier and the new-conversation model', () => {
    const result = resolveCompanyServiceDefaults(
      runtimeOf(
        {
          chat: 'tellhow-chat',
          embedding: 'tellhow-embedding',
          title: 'tellhow-flash',
          verify: 'tellhow-vision',
        },
        [chatModel, flashModel, visionModel, embeddingModel],
      ),
    );

    expect(result.tiers).toEqual({
      embedding: tellhow('tellhow-embedding'),
      flash: tellhow('tellhow-flash'),
      main: tellhow('tellhow-chat'),
      verify: tellhow('tellhow-vision'),
    });
    expect(result.defaultAgent).toEqual({ config: tellhow('tellhow-chat') });

    // The slot list is owned by the tier table, not duplicated here.
    for (const [tier, slots] of Object.entries(SERVICE_MODEL_TIER_SLOTS)) {
      for (const slot of slots) {
        expect(result.systemAgent[slot]).toEqual(result.tiers[tier as ServiceModelTier]);
      }
    }

    // Slots outside the four tiers keep their own deployment default.
    expect(result.systemAgent.asr).toBeUndefined();
    expect(result.systemAgent.channelRouting).toBeUndefined();
    expect(result.systemAgent.fileEmbedding).toBeUndefined();
    expect(result.systemAgent.onboardingUnderstanding).toBeUndefined();
  });

  it('drops a default users cannot see and keeps the tiers that still resolve', () => {
    const result = resolveCompanyServiceDefaults(
      runtimeOf(
        {
          chat: 'closed-chat',
          embedding: 'not-in-catalog',
          title: 'tellhow-flash',
          verify: 'removed-verify',
        },
        [
          model('closed-chat', 'chat', { open: false }),
          flashModel,
          model('removed-verify', 'chat', { removedAt: '2026-11-01T00:00:00.000Z' }),
          embeddingModel,
        ],
      ),
    );

    expect(result.tiers).toEqual({ flash: tellhow('tellhow-flash') });
    expect(result.defaultAgent).toBeUndefined();
    expect(result.systemAgent.topic).toEqual(tellhow('tellhow-flash'));
    expect(result.systemAgent.agentMeta).toBeUndefined();
    expect(result.systemAgent.verify).toBeUndefined();
    expect(result.systemAgent.userMemoryEmbedding).toBeUndefined();
  });

  it('resolves to nothing when the service is closed or has no defaults', () => {
    const empty = { systemAgent: {}, tiers: {} };

    expect(resolveCompanyServiceDefaults(null)).toEqual(empty);
    expect(resolveCompanyServiceDefaults(undefined)).toEqual(empty);
    expect(resolveCompanyServiceDefaults(runtimeOf({}, [chatModel]))).toEqual(empty);
  });
});

describe('getCompanyServiceDefaults', () => {
  beforeEach(() => {
    mocks.getCompanyProviderRuntimeFromServer.mockReset();
  });

  it('reads through the shared runtime cache and resolves its defaults', async () => {
    mocks.getCompanyProviderRuntimeFromServer.mockResolvedValue(
      runtimeOf({ chat: 'tellhow-chat' }, [chatModel]),
    );

    const result = await getCompanyServiceDefaults({ db: {} as never });

    expect(mocks.getCompanyProviderRuntimeFromServer).toHaveBeenCalledWith({
      db: expect.anything(),
    });
    expect(result.defaultAgent).toEqual({ config: tellhow('tellhow-chat') });
    expect(result.systemAgent.agentMeta).toEqual(tellhow('tellhow-chat'));
  });

  it('returns an empty layer when nothing is configured', async () => {
    mocks.getCompanyProviderRuntimeFromServer.mockResolvedValue(null);

    await expect(getCompanyServiceDefaults()).resolves.toEqual({ systemAgent: {}, tiers: {} });
  });
});

describe('getCompanyServiceDefaultModel', () => {
  beforeEach(() => {
    mocks.getCompanyProviderRuntimeFromServer.mockReset();
  });

  it('returns the administrator default for one slot', async () => {
    mocks.getCompanyProviderRuntimeFromServer.mockResolvedValue(
      runtimeOf({ title: 'tellhow-flash' }, [flashModel]),
    );

    await expect(getCompanyServiceDefaultModel('topic')).resolves.toEqual(tellhow('tellhow-flash'));
  });

  it('returns nothing for a tier the administrator left unset', async () => {
    mocks.getCompanyProviderRuntimeFromServer.mockResolvedValue(
      runtimeOf({ title: 'tellhow-flash' }, [flashModel]),
    );

    await expect(getCompanyServiceDefaultModel('verify')).resolves.toBeUndefined();
  });
});
