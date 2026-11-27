// @vitest-environment node
import { DEFAULT_ONLY_COMPANY_PROVIDER_ENABLED } from '@lobechat/business-const';
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getCompanyProviderRuntime,
  invalidateCompanyProviderCache,
} from '@/business/server/companyProvider';

import { initModelRuntimeFromDB } from './index';

/**
 * CUST-011-C evidence: "默认关闭 ≠ 禁止".
 *
 * `getAiProviderSpecificConfig()` now writes `enabled: false` for every
 * built-in provider except Tellhow AI, and
 * `apps/server/src/globalConfig/getServerGlobalConfig.test.ts` pins that shape.
 * The risk that switch could carry is a server-side regression: if any runtime
 * path treated the default as a ban, the title / memory / verify background
 * tasks would start failing with "provider unavailable" for a deployment whose
 * administrator defaults live in the Tellhow catalog.
 *
 * It does not, and this suite locks that in through the real
 * `initModelRuntimeFromDB()` path instead of a mocked resolver:
 *
 * - a brand-new user's tellhow call resolves the console credentials without a
 *   user `ai_provider` row (there is no row to enable it),
 * - a provider that is default-off (openai / deepseek) still initializes from
 *   the user's own row once the user switches it on,
 * - a custom provider (`source: 'custom'`) never reads the default at all.
 *
 * `initModelRuntimeFromDB` reads the user/provider row and the console
 * credentials; it never consults the server provider config's `enabled` flag.
 */

const getAiProviderById = vi.hoisted(() => vi.fn());

vi.mock('@/server/globalConfig', () => ({ getServerAiProviderConfig: vi.fn() }));
vi.mock('@/envs/llm', () => ({ getLLMConfig: vi.fn(() => ({})) }));
vi.mock('@/database/models/aiProvider', () => ({
  AiProviderModel: vi.fn(function () {
    return { getAiProviderById };
  }),
}));

const db = {} as never;

const companyConfig = {
  apiKey: {
    ciphertext: 'cipher:company-key',
    last4: 'pkey',
    updatedAt: '2026-11-24T00:00:00.000Z',
    updatedBy: 'admin-user',
  },
  baseURL: 'http://10.20.30.40:8080/v1',
  enabled: true,
  models: [
    { id: 'tellhow-chat-1', name: 'Tellhow Chat 1', open: true, source: 'manual', type: 'chat' },
  ],
} as const;

const warmCompanyConfig = () =>
  getCompanyProviderRuntime(db, {
    gatekeeper: { decrypt: vi.fn(async () => ({ plaintext: 'sk-company-secret' })) },
    reader: async () => companyConfig as never,
  });

beforeEach(() => {
  invalidateCompanyProviderCache();
  getAiProviderById.mockReset();
  vi.unstubAllEnvs();
  vi.stubEnv('TELLHOW_API_KEY', '');
  vi.stubEnv('TELLHOW_PROXY_URL', '');
});

describe('CUST-011-C provider defaults: runtime initialisation is not gated by them', () => {
  it('ships the fork switch on (only the company provider is default-enabled)', () => {
    expect(DEFAULT_ONLY_COMPANY_PROVIDER_ENABLED).toBe(true);
  });

  it('initialises Tellhow for a brand-new user who has no provider row', async () => {
    await warmCompanyConfig();
    getAiProviderById.mockResolvedValue(undefined);

    const runtime = await initModelRuntimeFromDB(db, 'new-user', ModelProvider.Tellhow);

    expect(runtime['_runtime']).toMatchObject({
      baseURL: 'http://10.20.30.40:8080/v1',
    });
    expect(runtime['_runtime']['_options']).toMatchObject({
      apiKey: 'sk-company-secret',
      baseURL: 'http://10.20.30.40:8080/v1',
    });
  });

  it.each([ModelProvider.OpenAI, ModelProvider.DeepSeek])(
    'initialises the default-off provider %s from the user row once the user turns it on',
    async (provider) => {
      getAiProviderById.mockResolvedValue({
        keyVaults: { apiKey: 'sk-user-key' },
        settings: {},
      } as never);

      const runtime = await initModelRuntimeFromDB(db, 'user-1', provider);

      expect(runtime['_runtime']['_options']).toMatchObject({ apiKey: 'sk-user-key' });
      // The user row is what the runtime reads — the server default never
      // reaches this function, so `enabled: false` cannot mean "forbidden".
      expect(getAiProviderById).toHaveBeenCalledWith(provider, expect.any(Function));
    },
  );

  it('ignores the default-off list for custom providers', async () => {
    getAiProviderById.mockResolvedValue({
      keyVaults: { apiKey: 'sk-acme', baseURL: 'https://acme.example.com/v1' },
      settings: { sdkType: 'openai' },
    } as never);

    const runtime = await initModelRuntimeFromDB(db, 'user-1', 'acme');

    expect(runtime['_runtime']['_options']).toMatchObject({
      apiKey: 'sk-acme',
      baseURL: 'https://acme.example.com/v1',
    });
  });
});
