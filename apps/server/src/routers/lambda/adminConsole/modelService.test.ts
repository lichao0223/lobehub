// @vitest-environment node
import type { CompanyModel } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminConsoleModelService } from '@/business/server/adminConsole/modelService';
import { getTestDB } from '@/database/core/getTestDB';
import { adminConsoleSettings, users, userSettings } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { adminConsoleRouter } from './index';

const mocks = vi.hoisted(() => ({ getServerDB: vi.fn() }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mocks.getServerDB }));

const serverDB: LobeChatDatabase = await getTestDB();
mocks.getServerDB.mockResolvedValue(serverDB);

const ids = {
  admin: 'admin-model-service-admin',
  member: 'admin-model-service-member',
};

const chatModel: CompanyModel = {
  id: 'tellhow-chat-1',
  name: 'Tellhow Chat 1',
  open: true,
  source: 'manual',
  type: 'chat',
};

const embeddingModel: CompanyModel = {
  capabilities: ['vision'],
  contextWindowTokens: 8192,
  id: 'tellhow-embed-1',
  name: 'Tellhow Embed 1',
  open: false,
  source: 'sync',
  type: 'embedding',
};

let gateKeeper: KeyVaultsGateKeeper;
let originalSecret: string | undefined;

beforeAll(async () => {
  originalSecret = process.env.KEY_VAULTS_SECRET;
  process.env.KEY_VAULTS_SECRET = 'Q10pwdq00KXUu9R+c8A8p4PSlIRWi7KwgUophBtkHVk=';
  gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.KEY_VAULTS_SECRET;
  else process.env.KEY_VAULTS_SECRET = originalSecret;
});

const cleanup = async () => {
  await serverDB.delete(adminConsoleSettings).where(eq(adminConsoleSettings.id, 'singleton'));
  await serverDB.delete(userSettings).where(inArray(userSettings.id, Object.values(ids)));
  await serverDB.delete(users).where(inArray(users.id, Object.values(ids)));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([
    { email: 'admin@tellhowsoft.com', id: ids.admin, role: 'admin', username: 'MODEL-ADMIN' },
    { email: 'member@tellhowsoft.com', id: ids.member, role: 'user', username: 'MODEL-MEMBER' },
  ]);
});

afterEach(cleanup);

const serviceFor = (userId = ids.admin) =>
  new AdminConsoleModelService(serverDB, userId, { gatekeeper: gateKeeper });

const readStoredAi = async () => {
  const [row] = await serverDB
    .select()
    .from(adminConsoleSettings)
    .where(eq(adminConsoleSettings.id, 'singleton'));
  return row?.config.ai;
};

describe('API key encryption and masking', () => {
  it('stores only KeyVault ciphertext + last4 and never returns either', async () => {
    const service = serviceFor();
    const result = await service.updateConfig({
      apiKey: 'sk-tellhow-plaintext-9876',
      baseURL: 'https://ai.tellhowsoft.com/v1',
      enabled: false,
      models: [chatModel],
    });

    expect(result.config.apiKey).toMatchObject({ last4: '9876', updatedBy: ids.admin });
    expect(result.config.apiKey).not.toHaveProperty('ciphertext');
    expect(JSON.stringify(result)).not.toContain('sk-tellhow-plaintext-9876');
    expect(JSON.stringify(result)).not.toContain('ciphertext');

    const stored = await readStoredAi();
    expect(stored?.apiKey?.ciphertext).toBeTruthy();
    expect(stored?.apiKey?.ciphertext).not.toContain('sk-tellhow-plaintext-9876');
    expect(stored?.apiKey?.last4).toBe('9876');
    expect(stored?.apiKey?.updatedBy).toBe(ids.admin);

    const decrypted = await gateKeeper.decrypt(stored!.apiKey!.ciphertext);
    expect(decrypted).toEqual({ plaintext: 'sk-tellhow-plaintext-9876', wasAuthentic: true });

    const read = await service.getConfig();
    expect(read.config.apiKey).toEqual(result.config.apiKey);
    expect(JSON.stringify(read)).not.toContain('sk-tellhow-plaintext-9876');
    expect(JSON.stringify(read)).not.toContain(stored!.apiKey!.ciphertext);
  });

  it('uses the repo KeyVault by default, without an injected gatekeeper', async () => {
    const service = new AdminConsoleModelService(serverDB, ids.admin);
    const result = await service.updateConfig({
      apiKey: 'sk-default-gatekeeper-4321',
      enabled: false,
    });

    expect(result.config.apiKey?.last4).toBe('4321');
    const stored = await readStoredAi();
    const decrypted = await gateKeeper.decrypt(stored!.apiKey!.ciphertext);
    expect(decrypted.plaintext).toBe('sk-default-gatekeeper-4321');
  });
});

describe('config validation', () => {
  it('rejects a model type outside AiModelType', async () => {
    await expect(
      serviceFor().updateConfig({
        enabled: false,
        models: [{ ...chatModel, type: 'speech-to-text' as never }],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'INVALID_MODEL_TYPE' });
  });

  it('rejects duplicate model ids', async () => {
    await expect(
      serviceFor().updateConfig({ enabled: false, models: [chatModel, { ...chatModel }] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'DUPLICATE_MODEL_ID' });
  });

  it.each([
    'ftp://ai.tellhowsoft.com',
    'ai.tellhowsoft.com',
    'https://user:pass@ai.tellhowsoft.com',
  ])('rejects a non-http(s) base URL: %s', async (baseURL) => {
    await expect(serviceFor().updateConfig({ baseURL, enabled: false })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'INVALID_BASE_URL',
    });
  });

  it('rejects a key too short to mask with last4', async () => {
    await expect(
      serviceFor().updateConfig({ apiKey: 'sk-1234', enabled: false }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'INVALID_API_KEY' });
  });

  it('rejects a default that is not in the catalog', async () => {
    await expect(
      serviceFor().updateConfig({
        defaults: { chat: 'missing-model' },
        enabled: false,
        models: [chatModel],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'INVALID_DEFAULT_MODEL' });
  });

  it('refuses to enable without an address and a key', async () => {
    await expect(
      serviceFor().updateConfig({ baseURL: 'https://ai.tellhowsoft.com', enabled: true }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'PROVIDER_NOT_CONFIGURED' });
  });
});

describe('optimistic locking', () => {
  it('accepts the current updatedAt and rejects a stale one with CONFLICT', async () => {
    const first = await serviceFor().updateConfig({
      apiKey: 'sk-first-1111',
      baseURL: 'https://ai.tellhowsoft.com',
      enabled: false,
    });
    expect(first.updatedAt).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await serviceFor().updateConfig({
      baseURL: 'https://ai2.tellhowsoft.com',
      enabled: false,
      expectedUpdatedAt: first.updatedAt!,
    });
    expect(second.updatedAt).not.toBe(first.updatedAt);

    await expect(
      serviceFor().updateConfig({
        baseURL: 'https://stale.tellhowsoft.com',
        enabled: false,
        expectedUpdatedAt: first.updatedAt!,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'CONFIG_CONFLICT' });

    // The failed write must not have overwritten the newer address.
    expect((await serviceFor().getConfig()).config.baseURL).toBe('https://ai2.tellhowsoft.com');
  });

  it('treats an expected version on a missing row as a conflict', async () => {
    await expect(
      serviceFor().updateConfig({
        baseURL: 'https://ai.tellhowsoft.com',
        enabled: false,
        expectedUpdatedAt: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'CONFIG_CONFLICT' });
  });
});

describe('adminConsole model service procedures', () => {
  const callerFor = (userId?: string) => adminConsoleRouter.createCaller({ userId } as never);

  it('lets an admin read and write, and masks the key in tRPC output', async () => {
    const admin = callerFor(ids.admin);
    const updated = await admin.updateModelServiceConfig({
      apiKey: 'sk-router-plaintext-2468',
      baseURL: 'https://ai.tellhowsoft.com',
      enabled: false,
      models: [chatModel, embeddingModel],
    });

    expect(updated.config.apiKey?.last4).toBe('2468');
    expect(JSON.stringify(updated)).not.toContain('sk-router-plaintext-2468');
    expect(JSON.stringify(updated)).not.toContain('ciphertext');

    const read = await admin.getModelServiceConfig();
    expect(read.config.models.map((model) => model.id)).toEqual([
      'tellhow-chat-1',
      'tellhow-embed-1',
    ]);
    expect(JSON.stringify(read)).not.toContain('sk-router-plaintext-2468');
  });

  it('answers a normal user with ADMIN_REQUIRED and an anonymous call with 401', async () => {
    await expect(callerFor(ids.member).getModelServiceConfig()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'ADMIN_REQUIRED',
    });
    await expect(
      callerFor(ids.member).updateModelServiceConfig({ enabled: false }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'ADMIN_REQUIRED' });
    await expect(callerFor().getModelServiceConfig()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });

    // The rejected write must not have created or changed the settings row.
    const rows = await serverDB
      .select()
      .from(adminConsoleSettings)
      .where(eq(adminConsoleSettings.id, 'singleton'));
    expect(rows).toHaveLength(0);
  });

  it('leaves the user_settings columns untouched', async () => {
    await serverDB.insert(userSettings).values({
      id: ids.admin,
      keyVaults: '{"openai":{"apiKey":"user-owned"}}',
      languageModel: { defaultModel: 'user/own-model' },
      systemAgent: { title: { model: 'user/own-title' } },
    });

    const [before] = await serverDB
      .select({
        keyVaults: userSettings.keyVaults,
        languageModel: userSettings.languageModel,
        systemAgent: userSettings.systemAgent,
      })
      .from(userSettings)
      .where(eq(userSettings.id, ids.admin));

    await callerFor(ids.admin).updateModelServiceConfig({
      apiKey: 'sk-untouched-1357',
      baseURL: 'https://ai.tellhowsoft.com',
      enabled: false,
      models: [chatModel],
    });

    const [after] = await serverDB
      .select({
        keyVaults: userSettings.keyVaults,
        languageModel: userSettings.languageModel,
        systemAgent: userSettings.systemAgent,
      })
      .from(userSettings)
      .where(eq(userSettings.id, ids.admin));

    expect(after).toEqual(before);
  });
});
