// @vitest-environment node
import { normalizeChatMessageError } from '@lobechat/model-runtime/errors';
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COMPANY_PROVIDER_NOT_CONFIGURED_MESSAGE,
  createCompanyProviderNotConfiguredError,
  getCompanyProviderRuntime,
  invalidateCompanyProviderCache,
} from '@/business/server/companyProvider';

import { initModelRuntimeWithUserPayload } from './index';

vi.mock('@/server/globalConfig', () => ({ getServerAiProviderConfig: vi.fn() }));
vi.mock('@/envs/llm', () => ({ getLLMConfig: vi.fn(() => ({})) }));

const db = {} as never;

const enabledConfig = {
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

const companyDecrypt = { decrypt: vi.fn(async () => ({ plaintext: 'sk-company-secret' })) };

const warmCompanyConfig = () =>
  getCompanyProviderRuntime(db, {
    gatekeeper: companyDecrypt,
    reader: async () => enabledConfig as never,
  });

beforeEach(() => {
  invalidateCompanyProviderCache();
  vi.unstubAllEnvs();
  vi.stubEnv('TELLHOW_API_KEY', '');
  vi.stubEnv('TELLHOW_PROXY_URL', '');
});

describe('initModelRuntimeWithUserPayload: tellhow', () => {
  it('injects the administrator-configured endpoint and key', async () => {
    await warmCompanyConfig();

    const runtime = initModelRuntimeWithUserPayload(ModelProvider.Tellhow, {});

    expect(runtime['_runtime'].baseURL).toBe('http://10.20.30.40:8080/v1');
    expect(runtime['_runtime']['_options']).toMatchObject({
      apiKey: 'sk-company-secret',
      baseURL: 'http://10.20.30.40:8080/v1',
    });
  });

  it('returns a readable error instead of an uncaught crash when the service is closed', () => {
    expect(() => initModelRuntimeWithUserPayload(ModelProvider.Tellhow, {})).toThrow(
      expect.objectContaining({
        error: { message: COMPANY_PROVIDER_NOT_CONFIGURED_MESSAGE },
        errorType: 'NoAvailableProvider',
      }),
    );
  });

  it('keeps that message when the route normalizes the error for the client', () => {
    const normalized = normalizeChatMessageError(createCompanyProviderNotConfiguredError());

    expect(normalized.type).toBe('NoAvailableProvider');
    expect(normalized.message).toBe(COMPANY_PROVIDER_NOT_CONFIGURED_MESSAGE);
  });

  it('still prefers an explicitly supplied payload over the company credentials', async () => {
    await warmCompanyConfig();

    const runtime = initModelRuntimeWithUserPayload(ModelProvider.Tellhow, {
      apiKey: 'user-key',
      baseURL: 'https://user.example.com/v1',
    });

    expect(runtime['_runtime']['_options']).toMatchObject({
      apiKey: 'user-key',
      baseURL: 'https://user.example.com/v1',
    });
  });

  it('never sends the company key to a user-supplied endpoint', async () => {
    await warmCompanyConfig();

    // No payload key and a user endpoint: the runtime fails its own credential
    // check instead of borrowing the administrator's key.
    expect(() =>
      initModelRuntimeWithUserPayload(ModelProvider.Tellhow, {
        baseURL: 'https://user.example.com/v1',
      }),
    ).toThrow(expect.objectContaining({ errorType: 'InvalidProviderAPIKey' }));
  });
});
