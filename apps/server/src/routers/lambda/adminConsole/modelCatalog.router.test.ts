// @vitest-environment node
import type { CompanyModel } from '@lobechat/types';
import { ADMIN_CONSOLE_ERROR } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { adminConsoleSettings, users, userSettings } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { adminConsoleRouter } from './index';

const mocks = vi.hoisted(() => ({ getServerDB: vi.fn(), ssrfSafeFetch: vi.fn() }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mocks.getServerDB }));
// The two procedures reach the gateway only through `companyProviderFetch`
// (`ssrfSafeFetch`); mocking the package keeps the admin-access tests offline.
vi.mock('@lobechat/ssrf-safe-fetch', () => ({
  SSRFBlockedError: class SSRFBlockedError extends Error {},
  SSRF_BLOCKED_PREFIX: 'SSRF blocked',
  SSRF_DOCS_URL: 'https://lobehub.com/docs/self-hosting/environment-variables/basic',
  createSsrfSafeFetch: vi.fn(),
  findSSRFBlockedError: vi.fn(),
  isSSRFBlockedError: vi.fn(),
  matchIPAddressList: vi.fn(),
  resolveAgentOptions: vi.fn(),
  ssrfSafeFetch: mocks.ssrfSafeFetch,
  validateSsrfAddress: vi.fn(),
}));

const serverDB: LobeChatDatabase = await getTestDB();
mocks.getServerDB.mockResolvedValue(serverDB);

const baseURL = 'https://ai.tellhowsoft.com/v1';
const key = 'sk-tellhow-catalog-9876';

const ids = {
  admin: 'admin-catalog-admin',
  member: 'admin-catalog-member',
};

const manualModel: CompanyModel = {
  id: 'tellhow-manual-1',
  name: 'Renamed by admin',
  open: true,
  source: 'manual',
  type: 'chat',
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

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
  mocks.ssrfSafeFetch.mockReset();
  await cleanup();
  await serverDB.insert(users).values([
    { email: 'admin@tellhowsoft.com', id: ids.admin, role: 'admin', username: 'CATALOG-ADMIN' },
    { email: 'member@tellhowsoft.com', id: ids.member, role: 'user', username: 'CATALOG-MEMBER' },
  ]);
});

afterEach(cleanup);

const callerFor = (userId?: string) => adminConsoleRouter.createCaller({ userId } as never);

const admin = () => callerFor(ids.admin);

const saveConfig = (models: CompanyModel[] = [manualModel]) =>
  admin().updateModelServiceConfig({ apiKey: key, baseURL, enabled: false, models });

const readStoredAi = async () => {
  const [row] = await serverDB
    .select()
    .from(adminConsoleSettings)
    .where(eq(adminConsoleSettings.id, 'singleton'));

  return row?.config.ai;
};

describe('testModelServiceConnection', () => {
  it('probes the saved endpoint through ssrfSafeFetch and records lastTest', async () => {
    await saveConfig();
    mocks.ssrfSafeFetch.mockResolvedValueOnce(
      jsonResponse({ data: [{ id: 'tellhow-manual-1' }, { id: 'bge-large-zh' }] }),
    );

    const result = await admin().testModelServiceConnection();

    expect(result).toEqual({ latencyMs: expect.any(Number), modelCount: 2, ok: true });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    const [url, init, ssrfOptions] = mocks.ssrfSafeFetch.mock.calls[0];
    expect(url).toBe(`${baseURL}/models`);
    expect(init).toMatchObject({
      headers: { authorization: `Bearer ${key}` },
      method: 'GET',
    });
    // The admin-configured intranet gateway is allowed for this call only.
    expect(ssrfOptions).toMatchObject({ allowPrivateIPAddress: true });

    const stored = await readStoredAi();
    expect(stored?.lastTest).toMatchObject({ modelCount: 2, ok: true });
    expect(stored?.lastTest?.at).toBeTruthy();
    // The probe never leaks the key in its returned payload.
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it('records a failed probe with the mapped error code', async () => {
    await saveConfig();
    mocks.ssrfSafeFetch.mockResolvedValueOnce(new Response('denied', { status: 401 }));

    await expect(admin().testModelServiceConnection()).resolves.toMatchObject({
      errorCode: ADMIN_CONSOLE_ERROR.providerAuthFailed,
      ok: false,
    });

    expect((await readStoredAi())?.lastTest).toMatchObject({
      errorCode: ADMIN_CONSOLE_ERROR.providerAuthFailed,
      ok: false,
    });
  });

  it('answers PROVIDER_NOT_CONFIGURED when no address is saved', async () => {
    await expect(admin().testModelServiceConnection()).resolves.toEqual({
      errorCode: ADMIN_CONSOLE_ERROR.providerNotConfigured,
      ok: false,
    });
    expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
  });
});

describe('refreshModelCatalog', () => {
  it('does not write on a dry run', async () => {
    const saved = await saveConfig();
    mocks.ssrfSafeFetch.mockResolvedValueOnce(
      jsonResponse({
        data: [{ id: 'tellhow-manual-1' }, { id: 'bge-large-zh' }, { id: 'tellhow-new' }],
      }),
    );

    const result = await admin().refreshModelCatalog({ apply: false });

    expect(result.applied).toBe(false);
    expect(result.upstreamModelCount).toBe(3);
    expect(result.diff.added.map((model) => model.id).sort()).toEqual([
      'bge-large-zh',
      'tellhow-new',
    ]);
    expect(result.diff.needsReview).toEqual(['tellhow-new']);
    expect((await readStoredAi())?.models).toEqual([manualModel]);
    expect((await admin().getModelServiceConfig()).updatedAt).toBe(saved.updatedAt);
  });

  it('applies closed, pending additions without touching the admin catalog', async () => {
    await saveConfig();
    mocks.ssrfSafeFetch.mockResolvedValueOnce(
      jsonResponse({
        data: [{ id: 'tellhow-manual-1' }, { id: 'bge-large-zh' }, { id: 'tellhow-new' }],
      }),
    );

    const result = await admin().refreshModelCatalog({ apply: true });

    expect(result.applied).toBe(true);
    expect(result.diff.added.map((model) => model.id).sort()).toEqual([
      'bge-large-zh',
      'tellhow-new',
    ]);

    const stored = await readStoredAi();
    expect(stored?.models).toHaveLength(3);

    const [kept, embed, unknown] = stored!.models;
    expect(kept).toEqual(manualModel);
    expect(embed).toMatchObject({
      id: 'bge-large-zh',
      open: false,
      pending: true,
      source: 'sync',
      type: 'embedding',
    });
    expect(unknown).toMatchObject({ id: 'tellhow-new', open: false, pending: true, type: 'chat' });
  });

  it('is idempotent: a second apply writes nothing and keeps updatedAt', async () => {
    await saveConfig();
    const upstream = jsonResponse({ data: [{ id: 'tellhow-manual-1' }, { id: 'tellhow-new' }] });
    mocks.ssrfSafeFetch
      .mockResolvedValueOnce(upstream)
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'tellhow-manual-1' }, { id: 'tellhow-new' }] }),
      );

    const first = await admin().refreshModelCatalog({ apply: true });
    const second = await admin().refreshModelCatalog({ apply: true });

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.diff.added).toEqual([]);
    expect(second.updatedAt).toBe(first.updatedAt);
    expect((await readStoredAi())?.models).toHaveLength(2);
  });

  it('rejects an invalid stored type instead of writing it back', async () => {
    const ciphertext = await gateKeeper.encrypt(key);
    const legacyModel = {
      id: 'tellhow-legacy',
      name: 'Legacy row',
      open: true,
      source: 'sync' as const,
      // A row that bypassed validation (e.g. legacy `stt`): the sync must fail
      // rather than persist it again.
      type: 'stt' as never,
    };

    await serverDB.insert(adminConsoleSettings).values({
      config: {
        ai: {
          apiKey: {
            ciphertext,
            last4: '9876',
            updatedAt: new Date().toISOString(),
            updatedBy: ids.admin,
          },
          baseURL,
          enabled: false,
          models: [legacyModel as unknown as CompanyModel],
        },
      },
      id: 'singleton',
      updatedBy: ids.admin,
    });

    mocks.ssrfSafeFetch.mockResolvedValueOnce(
      jsonResponse({ data: [{ id: 'tellhow-legacy' }, { id: 'tellhow-new' }] }),
    );

    await expect(admin().refreshModelCatalog({ apply: true })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: ADMIN_CONSOLE_ERROR.invalidModelType,
    });

    // Nothing was written: the legacy row is untouched and the new one is absent.
    expect((await readStoredAi())?.models.map((model) => model.id)).toEqual(['tellhow-legacy']);
  });

  it('maps an unreachable gateway to a readable error code', async () => {
    await saveConfig();
    mocks.ssrfSafeFetch.mockRejectedValueOnce(new Error('connect EHOSTUNREACH'));

    await expect(admin().refreshModelCatalog({ apply: false })).rejects.toMatchObject({
      code: 'BAD_GATEWAY',
      message: ADMIN_CONSOLE_ERROR.providerUnreachable,
    });
  });
});

describe('admin-only access', () => {
  it('rejects a normal user and an anonymous caller for both procedures', async () => {
    const member = callerFor(ids.member);

    await expect(member.testModelServiceConnection()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'ADMIN_REQUIRED',
    });
    await expect(member.refreshModelCatalog({ apply: false })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'ADMIN_REQUIRED',
    });

    const anonymous = callerFor();
    await expect(anonymous.testModelServiceConnection()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(anonymous.refreshModelCatalog({ apply: true })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
  });
});
