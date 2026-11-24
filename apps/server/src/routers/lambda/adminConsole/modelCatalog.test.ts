// @vitest-environment node
import type {
  AdminConsoleAiLastTest,
  AdminConsoleModelServiceConfig,
  CompanyModel,
} from '@lobechat/types';
import { ADMIN_CONSOLE_ERROR } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import {
  AdminConsoleModelCatalogService,
  type AdminConsoleModelCatalogServiceOptions,
  buildModelsUrl,
  type CatalogModelLookup,
  diffModelCatalog,
  extractUpstreamModelIds,
  inferCompanyModelType,
  type ModelCatalogConfigStore,
} from '@/business/server/adminConsole/modelCatalog';

type FetchSeam = NonNullable<AdminConsoleModelCatalogServiceOptions['fetch']>;

const baseURL = 'https://ai.tellhowsoft.com/v1';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

interface StoreState {
  apiKey: string | null;
  baseURL: string;
  enabled: boolean;
  models: CompanyModel[];
  updatedAt: string;
}

const configOf = (state: StoreState): AdminConsoleModelServiceConfig => ({
  config: {
    apiKey: null,
    baseURL: state.baseURL,
    enabled: state.enabled,
    models: state.models,
  },
  updatedAt: state.updatedAt,
  updatedBy: 'admin-1',
});

const createFakeStore = (overrides: Partial<StoreState> = {}) => {
  const state: StoreState = {
    apiKey: 'sk-tellhow-secret-1234',
    baseURL,
    enabled: false,
    models: [],
    updatedAt: '2026-11-24T00:00:00.000Z',
    ...overrides,
  };

  const calls = {
    recordTest: [] as AdminConsoleAiLastTest[],
    updateModels: [] as { expectedUpdatedAt: string; models: CompanyModel[] }[],
  };

  const store: ModelCatalogConfigStore = {
    readConfig: async () => configOf(state),
    readCredentials: async () => ({ apiKey: state.apiKey, baseURL: state.baseURL }),
    recordTest: async (test) => {
      calls.recordTest.push(test);
    },
    updateModels: async (models, expectedUpdatedAt) => {
      calls.updateModels.push({ expectedUpdatedAt, models });
      state.models = models;
      state.updatedAt = '2026-11-24T01:00:00.000Z';

      return configOf(state);
    },
  };

  return { calls, state, store };
};

const serviceFor = (
  store: ModelCatalogConfigStore,
  fetch: FetchSeam,
  options: { lookup?: CatalogModelLookup; now?: () => number; timeoutMs?: number } = {},
) =>
  new AdminConsoleModelCatalogService({} as never, 'admin-1', {
    fetch,
    lookup: options.lookup ?? (() => undefined),
    now: options.now ?? (() => 1000),
    store,
    timeoutMs: options.timeoutMs,
  });

describe('buildModelsUrl', () => {
  it.each([
    ['https://ai.tellhowsoft.com', 'https://ai.tellhowsoft.com/models'],
    ['https://ai.tellhowsoft.com/', 'https://ai.tellhowsoft.com/models'],
    ['https://ai.tellhowsoft.com/v1/', 'https://ai.tellhowsoft.com/v1/models'],
    ['https://ai.tellhowsoft.com/v1/models', 'https://ai.tellhowsoft.com/v1/models'],
  ])('%s → %s', (input, expected) => {
    expect(buildModelsUrl(input)).toBe(expected);
  });
});

describe('extractUpstreamModelIds', () => {
  it('reads the OpenAI data shape, a models shape and a bare array', () => {
    expect(extractUpstreamModelIds({ data: [{ id: 'a' }, { id: ' b ' }] })).toEqual(['a', 'b']);
    expect(extractUpstreamModelIds({ models: [{ id: 'c' }] })).toEqual(['c']);
    expect(extractUpstreamModelIds(['d', { id: 'e' }])).toEqual(['d', 'e']);
  });

  it('de-duplicates ids and ignores entries without one', () => {
    expect(
      extractUpstreamModelIds({ data: [{ id: 'a' }, { id: 'a' }, { owned_by: 'x' }, 'a'] }),
    ).toEqual(['a']);
  });

  it.each([[null], ['nope'], [{}], [{ data: 'not-a-list' }], [42]])(
    'reports an unreadable payload as null: %s',
    (payload) => {
      expect(extractUpstreamModelIds(payload)).toBeNull();
    },
  );
});

describe('inferCompanyModelType', () => {
  it.each([
    ['text-embedding-3-large', 'embedding'],
    ['bge-large-zh', 'embedding'],
    ['gte-qwen2', 'embedding'],
    ['suno-v3', 'text2music'],
    ['tellhow-music-1', 'text2music'],
    ['tts-1-hd', 'tts'],
    ['tellhow-speech', 'tts'],
    ['whisper-large-v3', 'asr'],
    ['tellhow-asr-1', 'asr'],
    ['dall-e-3', 'image'],
    ['flux-pro', 'image'],
    ['stable-diffusion-xl', 'image'],
    ['sora-2', 'video'],
    ['kling-v2', 'video'],
    ['gpt-4o-realtime-preview', 'realtime'],
    ['tellhow-decision-1', 'decision'],
    ['gpt-4o', 'chat'],
    ['deepseek-chat', 'chat'],
  ] as const)('%s → %s', (id, type) => {
    const result = inferCompanyModelType(id);
    expect(result.type).toBe(type);
    expect(result.confident).toBe(type !== 'chat');
  });
});

describe('diffModelCatalog', () => {
  const now = () => new Date('2026-11-24T02:00:00.000Z');
  const lookup: CatalogModelLookup = (id) => {
    if (id === 'qwen-max') {
      return {
        capabilities: ['functionCall'],
        contextWindowTokens: 32_000,
        name: 'Qwen Max',
        type: 'chat',
      };
    }
    if (id === 'bge-large-zh') {
      return { contextWindowTokens: 512, name: 'BGE Large ZH', type: 'embedding' };
    }
    return undefined;
  };

  it('adds new upstream models closed and pending, enriched from the built-in catalog', () => {
    const { diff, models } = diffModelCatalog([], ['qwen-max', 'bge-large-zh'], { lookup, now });

    expect(diff.added).toHaveLength(2);
    expect(models).toHaveLength(2);
    expect(diff.added[0]).toEqual({
      capabilities: ['functionCall'],
      contextWindowTokens: 32_000,
      id: 'qwen-max',
      name: 'Qwen Max',
      open: false,
      pending: true,
      source: 'sync',
      type: 'chat',
    });
    expect(diff.added[1]).toMatchObject({ open: false, pending: true, type: 'embedding' });
    expect(diff.needsReview).toEqual([]);
  });

  it('falls back to chat and flags an unknown model for review', () => {
    const { diff } = diffModelCatalog([], ['tellhow-mystery-model'], { lookup, now });

    expect(diff.added[0]).toMatchObject({ name: 'tellhow-mystery-model', type: 'chat' });
    expect(diff.needsReview).toEqual(['tellhow-mystery-model']);
  });

  it('keeps an existing row untouched: name / open / type are administrator decisions', () => {
    const edited: CompanyModel = {
      id: 'tellhow-manual-1',
      name: 'Renamed by admin',
      open: false,
      source: 'manual',
      type: 'decision',
    };

    const { diff, models } = diffModelCatalog([edited], ['tellhow-manual-1'], {
      lookup: () => ({ name: 'Built-in name', type: 'chat' }),
      now,
    });

    expect(models[0]).toEqual(edited);
    expect(diff.unchanged).toEqual(['tellhow-manual-1']);
    expect(diff.updated).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('fills metadata a row does not have, but never the name', () => {
    const bare: CompanyModel = {
      id: 'qwen-max',
      name: 'Admin display name',
      open: true,
      source: 'sync',
      type: 'chat',
    };

    const { diff } = diffModelCatalog([bare], ['qwen-max'], { lookup, now });

    expect(diff.updated[0]).toMatchObject({
      capabilities: ['functionCall'],
      contextWindowTokens: 32_000,
      name: 'Admin display name',
      open: true,
      type: 'chat',
    });
  });

  it('marks a vanished sync row with removedAt instead of deleting it', () => {
    const gone: CompanyModel = {
      id: 'tellhow-gone',
      name: 'Gone upstream',
      open: true,
      source: 'sync',
      type: 'chat',
    };

    const { diff, models } = diffModelCatalog([gone], [], { lookup, now });

    expect(models).toHaveLength(1);
    expect(models[0].removedAt).toBe('2026-11-24T02:00:00.000Z');
    expect(diff.removed[0]).toMatchObject({ id: 'tellhow-gone', removedAt: models[0].removedAt });
  });

  it('leaves a manual row alone when upstream does not list it', () => {
    const manual: CompanyModel = {
      id: 'tellhow-alias',
      name: 'Custom alias',
      open: true,
      source: 'manual',
      type: 'chat',
    };

    const { diff, models } = diffModelCatalog([manual], [], { lookup, now });

    expect(models[0]).toEqual(manual);
    expect(diff.removed).toEqual([]);
  });

  it('clears removedAt when upstream lists a model again', () => {
    const back: CompanyModel = {
      id: 'tellhow-back',
      name: 'Back again',
      open: false,
      removedAt: '2026-11-01T00:00:00.000Z',
      source: 'sync',
      type: 'chat',
    };

    const { diff } = diffModelCatalog([back], ['tellhow-back'], { lookup, now });

    expect(diff.restored[0]).not.toHaveProperty('removedAt');
    expect(diff.unchanged).toEqual([]);
  });

  it('is idempotent: re-diffing its own output changes nothing', () => {
    const first = diffModelCatalog([], ['qwen-max', 'tellhow-gone'], { lookup, now });
    const second = diffModelCatalog(first.models, ['qwen-max', 'tellhow-gone'], { lookup, now });

    expect(second.diff.added).toEqual([]);
    expect(second.diff.removed).toEqual([]);
    expect(second.diff.updated).toEqual([]);
    expect(second.diff.unchanged.sort()).toEqual(['qwen-max', 'tellhow-gone']);
  });
});

describe('testModelServiceConnection', () => {
  it('returns ok, latency and the model count, and records lastTest', async () => {
    const { calls, store } = createFakeStore();
    const now = vi.fn().mockReturnValueOnce(1000).mockReturnValue(1042);
    const fetch = vi.fn(async () => jsonResponse({ data: [{ id: 'a' }, { id: 'b' }] }));

    const result = await serviceFor(store, fetch, { now }).testConnection();

    expect(result).toEqual({ latencyMs: 42, modelCount: 2, ok: true });
    expect(fetch).toHaveBeenCalledWith(
      `${baseURL}/models`,
      expect.objectContaining({
        headers: { accept: 'application/json', authorization: 'Bearer sk-tellhow-secret-1234' },
        method: 'GET',
      }),
      baseURL,
    );
    expect(calls.recordTest).toEqual([
      { at: '1970-01-01T00:00:01.042Z', latencyMs: 42, modelCount: 2, ok: true },
    ]);
  });

  it('works while the service is disabled: testing is how the admin decides to enable it', async () => {
    const { store } = createFakeStore({ enabled: false });
    const fetch = vi.fn(async () => jsonResponse({ data: [{ id: 'a' }] }));

    await expect(serviceFor(store, fetch).testConnection()).resolves.toMatchObject({ ok: true });
  });

  it('reports PROVIDER_NOT_CONFIGURED without calling upstream when nothing is saved', async () => {
    const { calls, store } = createFakeStore({ apiKey: null });
    const fetch = vi.fn();

    const result = await serviceFor(store, fetch).testConnection();

    expect(result).toEqual({ errorCode: ADMIN_CONSOLE_ERROR.providerNotConfigured, ok: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(calls.recordTest).toEqual([]);
  });

  it('maps 401 / 403 to PROVIDER_AUTH_FAILED', async () => {
    const { calls, store } = createFakeStore();
    const fetch = vi.fn(async () => new Response('denied', { status: 401 }));

    const result = await serviceFor(store, fetch).testConnection();

    expect(result).toEqual({
      errorCode: ADMIN_CONSOLE_ERROR.providerAuthFailed,
      latencyMs: 0,
      ok: false,
    });
    expect(calls.recordTest[0]).toMatchObject({
      errorCode: ADMIN_CONSOLE_ERROR.providerAuthFailed,
      ok: false,
    });
  });

  it('maps any other non-2xx to PROVIDER_HTTP_ERROR', async () => {
    const { store } = createFakeStore();
    const fetch = vi.fn(async () => new Response('boom', { status: 502 }));

    await expect(serviceFor(store, fetch).testConnection()).resolves.toMatchObject({
      errorCode: ADMIN_CONSOLE_ERROR.providerHttpError,
      ok: false,
    });
  });

  it('maps unparseable bodies to PROVIDER_INVALID_RESPONSE', async () => {
    const { store } = createFakeStore();

    await expect(
      serviceFor(store, async () => new Response('not json', { status: 200 })).testConnection(),
    ).resolves.toMatchObject({ errorCode: ADMIN_CONSOLE_ERROR.providerInvalidResponse });

    await expect(
      serviceFor(store, async () => jsonResponse({ unexpected: true })).testConnection(),
    ).resolves.toMatchObject({ errorCode: ADMIN_CONSOLE_ERROR.providerInvalidResponse });
  });

  it('maps transport failures to PROVIDER_UNREACHABLE', async () => {
    const { store } = createFakeStore();
    const fetch = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });

    await expect(serviceFor(store, fetch).testConnection()).resolves.toMatchObject({
      errorCode: ADMIN_CONSOLE_ERROR.providerUnreachable,
      ok: false,
    });
  });

  it('maps an aborted request to PROVIDER_TIMEOUT and is bounded by timeoutMs', async () => {
    const { store } = createFakeStore();
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );

    const startedAt = Date.now();
    const result = await serviceFor(store, fetch, { timeoutMs: 10 }).testConnection();

    expect(result).toEqual({ errorCode: ADMIN_CONSOLE_ERROR.providerTimeout, ok: false });
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});

describe('refreshModelCatalog', () => {
  const lookup: CatalogModelLookup = () => undefined;

  it('apply: false returns the diff and never writes', async () => {
    const { calls, state, store } = createFakeStore();
    const fetch = vi.fn(async () =>
      jsonResponse({ data: [{ id: 'bge-large-zh' }, { id: 'tellhow-new' }] }),
    );

    const result = await serviceFor(store, fetch, { lookup }).refreshCatalog({ apply: false });

    expect(result.applied).toBe(false);
    expect(result.upstreamModelCount).toBe(2);
    expect(result.diff.added.map((model) => model.id)).toEqual(['bge-large-zh', 'tellhow-new']);
    expect(result.diff.added.every((model) => model.open === false && model.pending === true)).toBe(
      true,
    );
    expect(calls.updateModels).toEqual([]);
    expect(state.models).toEqual([]);
  });

  it('apply: true writes the merged catalog with the version it read', async () => {
    const existing: CompanyModel = {
      id: 'tellhow-existing',
      name: 'Admin name',
      open: true,
      source: 'manual',
      type: 'chat',
    };
    const { calls, state, store } = createFakeStore({ models: [existing] });
    const fetch = vi.fn(async () =>
      jsonResponse({ data: [{ id: 'tellhow-existing' }, { id: 'tellhow-new' }] }),
    );

    const result = await serviceFor(store, fetch, { lookup }).refreshCatalog({ apply: true });

    expect(result.applied).toBe(true);
    expect(result.updatedAt).toBe('2026-11-24T01:00:00.000Z');
    expect(calls.updateModels).toHaveLength(1);
    expect(calls.updateModels[0].expectedUpdatedAt).toBe('2026-11-24T00:00:00.000Z');
    expect(calls.updateModels[0].models.map((model) => model.id)).toEqual([
      'tellhow-existing',
      'tellhow-new',
    ]);
    expect(calls.updateModels[0].models[0]).toEqual(existing);
    expect(calls.updateModels[0].models[1]).toMatchObject({ open: false, pending: true });
    expect(state.models).toHaveLength(2);
  });

  it('is idempotent: a second apply with the same upstream writes nothing', async () => {
    const { calls, store } = createFakeStore();
    const fetch = vi.fn(async () => jsonResponse({ data: [{ id: 'tellhow-new' }] }));

    const service = serviceFor(store, fetch, { lookup });
    await service.refreshCatalog({ apply: true });
    const second = await service.refreshCatalog({ apply: true });

    expect(second.applied).toBe(false);
    expect(second.diff.added).toEqual([]);
    expect(second.diff.unchanged).toEqual(['tellhow-new']);
    expect(calls.updateModels).toHaveLength(1);
  });

  it('forwards an explicit expectedUpdatedAt so a stale page conflicts', async () => {
    const { calls, store } = createFakeStore();
    const fetch = vi.fn(async () => jsonResponse({ data: [{ id: 'tellhow-new' }] }));

    await serviceFor(store, fetch, { lookup }).refreshCatalog({
      apply: true,
      expectedUpdatedAt: '2026-11-20T00:00:00.000Z',
    });

    expect(calls.updateModels[0].expectedUpdatedAt).toBe('2026-11-20T00:00:00.000Z');
  });

  it('refuses to run without a saved address or key', async () => {
    const { store } = createFakeStore({ apiKey: null });
    const fetch = vi.fn();

    await expect(serviceFor(store, fetch).refreshCatalog({ apply: true })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: ADMIN_CONSOLE_ERROR.providerNotConfigured,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps upstream failures to readable error codes', async () => {
    const cases: Array<[() => Promise<Response>, string]> = [
      [async () => new Response('no', { status: 403 }), ADMIN_CONSOLE_ERROR.providerAuthFailed],
      [async () => new Response('no', { status: 500 }), ADMIN_CONSOLE_ERROR.providerHttpError],
      [
        async () => new Response('not json', { status: 200 }),
        ADMIN_CONSOLE_ERROR.providerInvalidResponse,
      ],
      [
        async () => {
          throw new Error('connect EHOSTUNREACH');
        },
        ADMIN_CONSOLE_ERROR.providerUnreachable,
      ],
    ];

    for (const [fetch, errorCode] of cases) {
      const { store } = createFakeStore();
      await expect(
        serviceFor(store, fetch as never).refreshCatalog({ apply: false }),
      ).rejects.toMatchObject({ code: 'BAD_GATEWAY', message: errorCode });
    }
  });
});
