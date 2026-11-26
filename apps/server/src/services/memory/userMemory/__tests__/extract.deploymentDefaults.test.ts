import { ModelRuntime } from '@lobechat/model-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as CompanyProviderModule from '@/business/server/companyProvider';

const mocks = vi.hoisted(() => ({ resolveCompanyProviderParams: vi.fn() }));

vi.mock('@/business/server/companyProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof CompanyProviderModule>();

  return { ...actual, resolveCompanyProviderParams: mocks.resolveCompanyProviderParams };
});

const { resolveRuntimeAgentConfig, resolveUserMemoryAgent, withMemoryDeploymentDefaults } =
  await import('../extract/runtime');

const fallbackEmbedding = {
  contextLimit: 2048,
  language: 'en-US',
  model: 'embed-1',
  provider: 'provider-e',
};

describe('withMemoryDeploymentDefaults (CUST-011)', () => {
  it('fills an unset memory slot from the deployment defaults', () => {
    const merged = withMemoryDeploymentDefaults(undefined, {
      userMemoryEmbedding: { model: 'tellhow-embed', provider: 'tellhow' },
    });

    expect(resolveUserMemoryAgent(merged, 'userMemoryEmbedding', fallbackEmbedding)).toMatchObject({
      model: 'tellhow-embed',
      provider: 'tellhow',
    });
  });

  it('keeps the user pick over the deployment default', () => {
    const merged = withMemoryDeploymentDefaults(
      { userMemoryEmbedding: { model: 'user-embed', provider: 'openai' } },
      { userMemoryEmbedding: { model: 'tellhow-embed', provider: 'tellhow' } },
    );

    expect(resolveUserMemoryAgent(merged, 'userMemoryEmbedding', fallbackEmbedding)).toMatchObject({
      model: 'user-embed',
      provider: 'openai',
    });
  });

  it('copies only the slots memory extraction runs', () => {
    const merged = withMemoryDeploymentDefaults({}, {
      topic: { model: 'tellhow-flash', provider: 'tellhow' },
      userMemoryEmbedding: { model: 'tellhow-embed', provider: 'tellhow' },
    } as never);

    expect(merged).toEqual({
      userMemoryEmbedding: { model: 'tellhow-embed', provider: 'tellhow' },
    });
  });

  it('leaves the user settings alone when no deployment default applies', () => {
    const userSettings = {
      userMemoryEmbedding: { model: 'user-embed', provider: 'openai' },
    };

    expect(withMemoryDeploymentDefaults(userSettings, undefined)).toBe(userSettings);
  });
});

describe('resolveRuntimeAgentConfig — followed tellhow default', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.resolveCompanyProviderParams.mockReset();
  });

  /**
   * The administrator default points at tellhow, whose endpoint and key live on
   * the server. A background memory run must resolve them the way a chat
   * request does instead of building a keyless runtime that fails every call.
   */
  it('resolves tellhow credentials from the admin console instead of a user vault', () => {
    mocks.resolveCompanyProviderParams.mockReturnValue({
      apiKey: 'sk-company-secret',
      baseURL: 'http://10.20.30.40:8080/v1',
    });
    const initialize = vi
      .spyOn(ModelRuntime, 'initializeWithProvider')
      .mockReturnValue({} as ModelRuntime);

    resolveRuntimeAgentConfig({ model: 'tellhow-embed', provider: 'tellhow' }, undefined, {
      userId: 'user-1',
    });

    expect(mocks.resolveCompanyProviderParams).toHaveBeenCalledWith({});
    expect(initialize).toHaveBeenCalledWith(
      'tellhow',
      { apiKey: 'sk-company-secret', baseURL: 'http://10.20.30.40:8080/v1', userId: 'user-1' },
      undefined,
    );
  });
});
