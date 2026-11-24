// @vitest-environment node
import type { AdminConsoleAiConfig, CompanyModel } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COMPANY_PROVIDER_CACHE_TTL_MS,
  COMPANY_PROVIDER_NOT_CONFIGURED_MESSAGE,
  companyProviderFetch,
  companyProviderSsrfOptions,
  createCompanyProviderNotConfiguredError,
  getCompanyProviderRuntime,
  getCompanyProviderRuntimeSnapshot,
  invalidateCompanyProviderCache,
  resolveCompanyProviderParams,
  withCompanyProviderCatalog,
} from '@/business/server/companyProvider';

const mocks = vi.hoisted(() => ({ ssrfSafeFetch: vi.fn() }));

vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: mocks.ssrfSafeFetch }));

const db = {} as never;

const chatModel: CompanyModel = {
  capabilities: ['vision'],
  contextWindowTokens: 128_000,
  id: 'tellhow-chat-1',
  name: 'Tellhow Chat 1',
  open: true,
  source: 'manual',
  type: 'chat',
};

const closedModel: CompanyModel = {
  id: 'tellhow-closed',
  name: 'Not yet opened',
  open: false,
  source: 'sync',
  type: 'chat',
};

const removedModel: CompanyModel = {
  id: 'tellhow-removed',
  name: 'Removed upstream',
  open: true,
  removedAt: '2026-11-01T00:00:00.000Z',
  source: 'sync',
  type: 'chat',
};

const enabledConfig: AdminConsoleAiConfig = {
  apiKey: {
    ciphertext: 'cipher:company-key',
    last4: 'pkey',
    updatedAt: '2026-11-24T00:00:00.000Z',
    updatedBy: 'admin-user',
  },
  baseURL: 'http://10.20.30.40:8080/v1',
  defaults: { embedding: 'tellhow-chat-1' },
  enabled: true,
  models: [chatModel, closedModel, removedModel],
};

const readerOf = (ai: AdminConsoleAiConfig | undefined) => vi.fn(async () => ai);

const decryptor = () => vi.fn(async () => ({ plaintext: ' sk-company-secret ' }));

beforeEach(() => {
  invalidateCompanyProviderCache();
  mocks.ssrfSafeFetch.mockReset();
  vi.unstubAllEnvs();
});

describe('getCompanyProviderRuntime', () => {
  it('is closed by default: no settings row means no provider', async () => {
    expect(await getCompanyProviderRuntime(db, { reader: readerOf(undefined) })).toBeNull();
    expect(getCompanyProviderRuntimeSnapshot()).toBeNull();
  });

  it('stays closed when the administrator disabled the service, without touching the key', async () => {
    const decrypt = decryptor();
    const runtime = await getCompanyProviderRuntime(db, {
      gatekeeper: { decrypt },
      reader: readerOf({ ...enabledConfig, enabled: false }),
    });

    expect(runtime).toBeNull();
    expect(decrypt).not.toHaveBeenCalled();
    expect(getCompanyProviderRuntimeSnapshot()).toBeNull();
  });

  it('stays closed while the endpoint or the key is missing', async () => {
    expect(
      await getCompanyProviderRuntime(db, {
        reader: readerOf({ ...enabledConfig, apiKey: null }),
      }),
    ).toBeNull();

    expect(
      await getCompanyProviderRuntime(db, {
        reader: readerOf({ ...enabledConfig, baseURL: '' }),
      }),
    ).toBeNull();
  });

  it('decrypts the key and exposes only models that are open and not removed', async () => {
    const runtime = await getCompanyProviderRuntime(db, {
      gatekeeper: { decrypt: decryptor() },
      reader: readerOf(enabledConfig),
    });

    expect(runtime).toEqual({
      apiKey: 'sk-company-secret',
      baseURL: 'http://10.20.30.40:8080/v1',
      defaults: { embedding: 'tellhow-chat-1' },
      models: [chatModel],
    });
    expect(JSON.stringify(runtime)).not.toContain('cipher:company-key');
  });

  it('reads at most once per TTL and re-reads after a save invalidates the cache', async () => {
    let now = 1_000;
    const reader = readerOf(enabledConfig);
    const options = { gatekeeper: { decrypt: decryptor() }, now: () => now, reader };

    await getCompanyProviderRuntime(db, options);
    await getCompanyProviderRuntime(db, options);
    expect(reader).toHaveBeenCalledTimes(1);

    now += COMPANY_PROVIDER_CACHE_TTL_MS + 1;
    await getCompanyProviderRuntime(db, options);
    expect(reader).toHaveBeenCalledTimes(2);

    invalidateCompanyProviderCache();
    await getCompanyProviderRuntime(db, options);
    expect(reader).toHaveBeenCalledTimes(3);
  });

  it('keeps the last working configuration when a refresh fails', async () => {
    let now = 1_000;
    const reader = readerOf(enabledConfig);
    const options = { gatekeeper: { decrypt: decryptor() }, now: () => now, reader };

    await getCompanyProviderRuntime(db, options);

    reader.mockRejectedValueOnce(new Error('database unavailable'));
    now += COMPANY_PROVIDER_CACHE_TTL_MS + 1;

    expect(await getCompanyProviderRuntime(db, options)).toMatchObject({
      apiKey: 'sk-company-secret',
    });
  });
});

describe('resolveCompanyProviderParams', () => {
  const warm = async () =>
    getCompanyProviderRuntime(db, {
      gatekeeper: { decrypt: decryptor() },
      reader: readerOf(enabledConfig),
    });

  it('lets an explicitly supplied payload win over the console configuration', async () => {
    await warm();

    expect(
      resolveCompanyProviderParams({ apiKey: 'user-key', baseURL: 'https://user.example.com/v1' }),
    ).toEqual({ apiKey: 'user-key', baseURL: 'https://user.example.com/v1' });
  });

  it('never sends the company key to a user-supplied endpoint', async () => {
    await warm();

    expect(resolveCompanyProviderParams({ baseURL: 'https://user.example.com/v1' })).toEqual({
      apiKey: undefined,
      baseURL: 'https://user.example.com/v1',
    });
  });

  it('uses the console configuration before the deployment environment', async () => {
    await warm();

    expect(
      resolveCompanyProviderParams(
        {},
        { TELLHOW_API_KEY: 'env-key', TELLHOW_PROXY_URL: 'https://env.example.com' },
      ),
    ).toEqual({ apiKey: 'sk-company-secret', baseURL: 'http://10.20.30.40:8080/v1' });
  });

  it('falls back to TELLHOW_API_KEY / TELLHOW_PROXY_URL when nothing is configured', () => {
    expect(
      resolveCompanyProviderParams(
        {},
        { TELLHOW_API_KEY: 'env-key', TELLHOW_PROXY_URL: 'https://env.example.com' },
      ),
    ).toEqual({ apiKey: 'env-key', baseURL: 'https://env.example.com' });

    expect(resolveCompanyProviderParams({}, { TELLHOW_API_KEY: 'env-key' })).toBeNull();
    expect(resolveCompanyProviderParams({}, {})).toBeNull();
  });
});

describe('createCompanyProviderNotConfiguredError', () => {
  it('is a readable typed payload that never carries a credential', () => {
    const error = createCompanyProviderNotConfiguredError();

    expect(error).toEqual({
      error: { message: COMPANY_PROVIDER_NOT_CONFIGURED_MESSAGE },
      errorType: 'NoAvailableProvider',
    });
    expect(JSON.stringify(error)).not.toContain('sk-company-secret');
    expect(COMPANY_PROVIDER_NOT_CONFIGURED_MESSAGE).toContain('switch to another model');
  });
});

describe('withCompanyProviderCatalog', () => {
  const options = () => ({
    gatekeeper: { decrypt: decryptor() },
    db,
    reader: readerOf(enabledConfig),
  });

  it('merges the open catalog into the user-visible provider config', async () => {
    const merged = await withCompanyProviderCatalog({}, options());

    expect(merged.tellhow).toMatchObject({
      enabled: true,
      enabledModels: ['tellhow-chat-1'],
      fetchOnClient: false,
      serverModelLists: [
        {
          abilities: { vision: true },
          contextWindowTokens: 128_000,
          displayName: 'Tellhow Chat 1',
          enabled: true,
          id: 'tellhow-chat-1',
          providerId: 'tellhow',
          type: 'chat',
        },
      ],
    });

    // Nothing secret ever reaches a client-facing config.
    const serialized = JSON.stringify(merged);
    expect(serialized).not.toContain('sk-company-secret');
    expect(serialized).not.toContain('cipher:company-key');
  });

  it('clears the provider and its catalog when the service is closed', async () => {
    const merged = await withCompanyProviderCatalog(
      { tellhow: { enabled: true, serverModelLists: [{ id: 'stale', type: 'chat' }] } },
      { db, reader: readerOf({ ...enabledConfig, enabled: false }) },
    );

    expect(merged.tellhow).toMatchObject({
      enabled: false,
      enabledModels: [],
      fetchOnClient: false,
      serverModelLists: [],
    });
  });
});

describe('companyProviderFetch', () => {
  it('opts in to the configured gateway address per call, not process-wide', () => {
    expect(companyProviderSsrfOptions('http://10.20.30.40:8080/v1')).toEqual({
      allowIPAddressList: ['10.20.30.40'],
    });
    expect(companyProviderSsrfOptions('http://[fd00::1]:8080/v1')).toEqual({
      allowIPAddressList: ['fd00::1'],
    });
    expect(companyProviderSsrfOptions('https://tellhow.internal/v1')).toEqual({
      allowPrivateIPAddress: true,
    });
  });

  it('sends every outbound request through ssrfSafeFetch with that allowance', async () => {
    mocks.ssrfSafeFetch.mockResolvedValue(new Response('{}'));

    await companyProviderFetch(
      'http://10.20.30.40:8080/v1/models',
      { headers: { Authorization: 'Bearer sk-company-secret' } },
      { baseURL: 'http://10.20.30.40:8080/v1' },
    );

    expect(mocks.ssrfSafeFetch).toHaveBeenCalledWith(
      'http://10.20.30.40:8080/v1/models',
      { headers: { Authorization: 'Bearer sk-company-secret' } },
      { allowIPAddressList: ['10.20.30.40'] },
    );
  });
});
