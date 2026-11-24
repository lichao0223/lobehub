// @vitest-environment node
import type * as DatabaseModule from '@lobechat/database';
import type { LobeChatDatabase } from '@lobechat/database';
import type { CompanyModel } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminConsoleModelService } from '@/business/server/adminConsole/modelService';
import {
  getCompanyProviderRuntime,
  invalidateCompanyProviderCache,
  withCompanyProviderCatalog,
} from '@/business/server/companyProvider';
import { getTestDB } from '@/database/core/getTestDB';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { adminConsoleSettings, users } from '@/database/schemas';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

/** `companyProvider` resolves the server DB lazily; point it at the test database. */
const mocks = vi.hoisted(() => ({ getServerDB: vi.fn() }));

vi.mock('@lobechat/database', async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getServerDB: mocks.getServerDB,
}));

/**
 * CUST-008 §5.3 end-to-end slice over a real (PGlite) database: the admin
 * service writes `config.ai`, the runtime reads/decrypts it through the process
 * cache, and the user-side provider/model list is derived from the merged
 * server config — including the "closed means invisible" path.
 */

const serverDB: LobeChatDatabase = await getTestDB();
mocks.getServerDB.mockResolvedValue(serverDB);

const userId = 'company-provider-integration-user';
const baseURL = 'http://10.20.30.40:8080/v1';

const openModel: CompanyModel = {
  contextWindowTokens: 32_768,
  id: 'tellhow-chat-1',
  name: 'Tellhow Chat 1',
  open: true,
  source: 'manual',
  type: 'chat',
};

const closedModel: CompanyModel = {
  id: 'tellhow-chat-closed',
  name: 'Not offered',
  open: false,
  source: 'sync',
  type: 'chat',
};

let gateKeeper: KeyVaultsGateKeeper;
let originalSecret: string | undefined;

const createService = () =>
  new AdminConsoleModelService(serverDB, userId, {
    gatekeeper: { encrypt: (plaintext) => gateKeeper.encrypt(plaintext) },
  });

beforeAll(async () => {
  originalSecret = process.env.KEY_VAULTS_SECRET;
  process.env.KEY_VAULTS_SECRET = 'Q10pwdq00KXUu9R+c8A8p4PSlIRWi7KwgUophBtkHVk=';
  gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.KEY_VAULTS_SECRET;
  else process.env.KEY_VAULTS_SECRET = originalSecret;
});

beforeEach(async () => {
  invalidateCompanyProviderCache();
  await serverDB.delete(adminConsoleSettings).where(eq(adminConsoleSettings.id, 'singleton'));
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({
    email: 'company-provider@tellhowsoft.com',
    id: userId,
    role: 'user',
    username: 'COMPANY-PROVIDER-USER',
  });
});

describe('company provider over the real settings table', () => {
  it('decrypts the saved key and exposes only the open catalog', async () => {
    await createService().updateConfig({
      apiKey: 'sk-tellhow-integration',
      baseURL,
      enabled: true,
      models: [openModel, closedModel],
    });

    const runtime = await getCompanyProviderRuntime(serverDB);

    expect(runtime).toMatchObject({
      apiKey: 'sk-tellhow-integration',
      baseURL,
      models: [openModel],
    });
  });

  it('lists Tellhow and its open models for a user, then hides both once closed', async () => {
    await createService().updateConfig({
      apiKey: 'sk-tellhow-integration',
      baseURL,
      enabled: true,
      models: [openModel, closedModel],
    });

    const enabledRepos = new AiInfraRepos(
      serverDB,
      userId,
      await withCompanyProviderCatalog({}, { db: serverDB }),
    );

    const providers = await enabledRepos.getAiProviderList();
    expect(providers.find((provider) => provider.id === 'tellhow')?.enabled).toBe(true);

    const models = await enabledRepos.getAiProviderModelList('tellhow');
    expect(models.map((model) => model.id)).toEqual(['tellhow-chat-1']);
    expect(models[0]).toMatchObject({ enabled: true, providerId: 'tellhow' });

    // Saving `enabled: false` clears the process cache, so the next read — and
    // therefore the next user request for the list — sees it immediately.
    await createService().updateConfig({ enabled: false });

    const closedRepos = new AiInfraRepos(
      serverDB,
      userId,
      await withCompanyProviderCatalog({}, { db: serverDB }),
    );

    const closedProviders = await closedRepos.getAiProviderList();
    expect(closedProviders.find((provider) => provider.id === 'tellhow')?.enabled).toBe(false);
    expect(await closedRepos.getAiProviderModelList('tellhow')).toEqual([]);
    expect(await getCompanyProviderRuntime(serverDB)).toBeNull();
  });

  it('never stores the plaintext key in user-visible output', async () => {
    await createService().updateConfig({
      apiKey: 'sk-tellhow-integration',
      baseURL,
      enabled: true,
      models: [openModel],
    });

    const configs = await withCompanyProviderCatalog({}, { db: serverDB });
    const userView = JSON.stringify({
      providers: await new AiInfraRepos(serverDB, userId, configs).getAiProviderList(),
      models: await new AiInfraRepos(serverDB, userId, configs).getAiProviderModelList('tellhow'),
    });

    expect(userView).not.toContain('sk-tellhow-integration');
    expect(userView).not.toContain('ciphertext');
  });

  it('reaches the client through the global config providers payload', async () => {
    await createService().updateConfig({
      apiKey: 'sk-tellhow-integration',
      baseURL,
      enabled: true,
      models: [openModel, closedModel],
    });

    const openConfig = await getServerGlobalConfig();

    expect(openConfig.aiProvider.tellhow).toMatchObject({ enabled: true, fetchOnClient: false });
    expect(openConfig.aiProvider.tellhow?.serverModelLists?.map((model) => model.id)).toEqual([
      'tellhow-chat-1',
    ]);
    expect(JSON.stringify(openConfig)).not.toContain('sk-tellhow-integration');

    await createService().updateConfig({ enabled: false });

    const closedConfig = await getServerGlobalConfig();

    expect(closedConfig.aiProvider.tellhow).toMatchObject({
      enabled: false,
      enabledModels: [],
      serverModelLists: [],
    });
  }, 60_000);
});
