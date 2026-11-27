import type { ModelRuntime } from '@lobechat/model-runtime';
import { ModelRuntime as ModelRuntimeClass } from '@lobechat/model-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CompanyProviderModule from '@/business/server/companyProvider';
import type { MemoryExtractionExecutorContext } from '@/server/services/memory/userMemory/extract/context';
import type {
  ResolvedMemoryServiceConfig,
  RuntimeBundle,
} from '@/server/services/memory/userMemory/extract/types';

/**
 * T-104: a background memory run must resolve the administrator's Tellhow
 * credential from the console itself.
 *
 * The reported failure mode was `InvalidProviderAPIKey` with no model request
 * at all: `resolveRuntimeAgentConfig` read only the synchronous 5 s snapshot,
 * which a fresh background worker has not warmed (and every bundled copy of the
 * module keeps to itself), then fell through to the user vault, then built a
 * keyless provider runtime whose constructor throws before any HTTP call.
 *
 * These tests pin the three behaviours the fix owes:
 * 1. the credential comes from the async console read, not the snapshot;
 * 2. an unusable embedding slot degrades instead of aborting the whole run;
 * 3. a genuinely unconfigured company provider fails with a readable error.
 */

const mocks = vi.hoisted(() => ({
  getCompanyProviderRuntime: vi.fn(),
  resolveCompanyProviderParams: vi.fn(),
}));

vi.mock('@/business/server/companyProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof CompanyProviderModule>();

  return {
    ...actual,
    getCompanyProviderRuntime: mocks.getCompanyProviderRuntime,
    resolveCompanyProviderParams: mocks.resolveCompanyProviderParams,
  };
});

vi.mock('@/business/server/model-runtime', () => ({
  getBusinessModelRuntimeHooks: vi.fn(() => undefined),
}));

const { getRuntime, resolveCompanyProviderCredential, resolveRuntimeAgentConfig } =
  await import('../extract/runtime');

const COMPANY_CREDENTIAL = { apiKey: 'sk-console-secret', baseURL: 'http://10.20.30.40:8080/v1' };

const agentConfig = (provider: string, model: string) => ({
  contextLimit: 2048,
  language: 'English',
  model,
  provider,
});

const memoryServiceConfig = (agents: {
  embedding: { model: string; provider: string };
  gatekeeper: { model: string; provider: string };
  layerExtractor: { model: string; provider: string };
}): ResolvedMemoryServiceConfig => ({
  agents: {
    embedding: agentConfig(agents.embedding.provider, agents.embedding.model),
    gatekeeper: agentConfig(agents.gatekeeper.provider, agents.gatekeeper.model),
    layerExtractor: agentConfig(agents.layerExtractor.provider, agents.layerExtractor.model),
  },
  modelConfig: {
    embeddingsModel: agents.embedding.model,
    gateModel: agents.gatekeeper.model,
    layerModels: { activity: agents.layerExtractor.model },
    observabilityS3: { enabled: false },
  },
  overrides: {
    embedding: { model: false, provider: false },
    gatekeeper: { model: false, provider: false },
    layerExtractor: { model: false, provider: false },
  },
});

const createContext = () =>
  ({
    db: Promise.resolve({} as never),
    embeddingPreferredProviders: undefined,
    gatekeeperPreferredProviders: undefined,
    layerPreferredProviders: undefined,
    runtimeCache: new Map<string, RuntimeBundle>(),
  }) as unknown as MemoryExtractionExecutorContext;

const followedDefault = () =>
  memoryServiceConfig({
    // The administrator left the embedding tier unset, so it keeps the env /
    // code default (openai) — the slot that used to abort the whole run.
    embedding: { model: 'text-embedding-3-small', provider: 'openai' },
    gatekeeper: { model: 'deepseek-flash-latest', provider: 'tellhow' },
    layerExtractor: { model: 'deepseek-flash-latest', provider: 'tellhow' },
  });

const stubRuntime = (provider: string): ModelRuntime => ({ provider }) as unknown as ModelRuntime;

describe('background memory run — company provider credential (T-104)', () => {
  let initializeWithProvider: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.getCompanyProviderRuntime.mockReset();
    mocks.resolveCompanyProviderParams.mockReset();
    // Cold snapshot: this is what a background job actually sees.
    mocks.resolveCompanyProviderParams.mockReturnValue(null);
    initializeWithProvider = vi
      .spyOn(ModelRuntimeClass, 'initializeWithProvider')
      .mockImplementation((async (provider: string) => stubRuntime(provider)) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('reads the console credential for the analysis slots even with an empty snapshot', async () => {
    mocks.getCompanyProviderRuntime.mockResolvedValue({
      apiKey: COMPANY_CREDENTIAL.apiKey,
      baseURL: COMPANY_CREDENTIAL.baseURL,
      models: [],
    });

    const runtimes = await getRuntime(createContext(), 'user-1', followedDefault());

    expect(mocks.getCompanyProviderRuntime).toHaveBeenCalledTimes(1);
    // Both analysis slots go out on the console credential, not the user vault
    // and not a keyless runtime.
    expect(initializeWithProvider).toHaveBeenCalledWith(
      'tellhow',
      { apiKey: COMPANY_CREDENTIAL.apiKey, baseURL: COMPANY_CREDENTIAL.baseURL, userId: 'user-1' },
      undefined,
    );
    expect(initializeWithProvider).toHaveBeenCalledTimes(3);
    expect(runtimes.gatekeeper).toBeDefined();
    expect(runtimes.layerExtractor).toBeDefined();
    expect(runtimes.embeddingsAvailable).toBe(true);
  });

  it('prefers an explicitly resolved credential over the synchronous snapshot', () => {
    initializeWithProvider.mockReturnValue(stubRuntime('tellhow'));

    resolveRuntimeAgentConfig(
      { model: 'deepseek-flash-latest', provider: 'tellhow' },
      undefined,
      { companyCredential: COMPANY_CREDENTIAL, label: 'gatekeeper', userId: 'user-1' },
      undefined,
    );

    expect(initializeWithProvider).toHaveBeenCalledWith(
      'tellhow',
      { apiKey: COMPANY_CREDENTIAL.apiKey, baseURL: COMPANY_CREDENTIAL.baseURL, userId: 'user-1' },
      undefined,
    );
  });

  it('degrades an unusable embedding slot instead of aborting the run', async () => {
    mocks.getCompanyProviderRuntime.mockResolvedValue({
      apiKey: COMPANY_CREDENTIAL.apiKey,
      baseURL: COMPANY_CREDENTIAL.baseURL,
      models: [],
    });
    const keyless = { error: undefined, errorType: 'InvalidProviderAPIKey' };
    initializeWithProvider.mockImplementation(((provider: string) => {
      // Exactly how the openai provider behaves without a key: the constructor
      // throws before any request is made.
      if (provider === 'openai') throw keyless;

      return stubRuntime(provider);
    }) as never);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const runtimes = await getRuntime(createContext(), 'user-1', followedDefault());

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('embedding runtime unavailable'),
      keyless,
    );
    expect(runtimes.embeddingsAvailable).toBe(false);
    expect(runtimes.gatekeeper).toBeDefined();
    // The degraded slot reports the original reason when something still asks.
    await expect(
      runtimes.embeddings.embeddings({ input: ['x'], model: 'text-embedding-3-small' }),
    ).rejects.toBe(keyless);
  });

  it('fails readably when the console has no company credentials at all', async () => {
    vi.stubEnv('TELLHOW_API_KEY', '');
    vi.stubEnv('TELLHOW_PROXY_URL', '');
    mocks.getCompanyProviderRuntime.mockResolvedValue(null);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(getRuntime(createContext(), 'user-1', followedDefault())).rejects.toMatchObject({
      errorType: 'NoAvailableProvider',
    });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('gatekeeper'));
  });

  it('skips the console read when no slot follows the administrator default', async () => {
    const credential = await resolveCompanyProviderCredential({} as never, [
      agentConfig('openai', 'gpt-5.6-luna'),
    ]);

    expect(credential).toBeUndefined();
    expect(mocks.getCompanyProviderRuntime).not.toHaveBeenCalled();
  });
});
