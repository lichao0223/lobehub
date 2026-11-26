import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveSystemAgentModelConfig } from './modelConfig';

const mocks = vi.hoisted(() => ({
  appEnv: { SYSTEM_AGENT: '' as string | undefined },
  getCompanyServiceDefaultModel: vi.fn(),
}));

vi.mock('@/envs/app', () => ({ appEnv: mocks.appEnv }));

// The administrator layer is a settings read; the chain itself is what this
// file checks, so the read is stubbed and asserted on.
vi.mock('@/business/server/adminConsole/serviceDefaults', () => ({
  getCompanyServiceDefaultModel: mocks.getCompanyServiceDefaultModel,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appEnv.SYSTEM_AGENT = '';
  mocks.getCompanyServiceDefaultModel.mockResolvedValue(undefined);
});

describe('resolveSystemAgentModelConfig', () => {
  it('should keep a configured LobeHub chat model', async () => {
    const result = await resolveSystemAgentModelConfig({
      taskConfig: {
        model: 'deepseek-v4-pro',
        provider: 'lobehub',
      },
      taskKey: 'topic',
    });

    expect(result).toEqual({ model: 'deepseek-v4-pro', provider: 'lobehub' });
  });

  it('should let runtime hooks resolve LobeHub model mapping', async () => {
    const result = await resolveSystemAgentModelConfig({
      taskConfig: {
        model: 'mapped-topic-model',
        provider: 'lobehub',
      },
      taskKey: 'topic',
    });

    expect(result).toEqual({ model: 'mapped-topic-model', provider: 'lobehub' });
  });

  it('should keep deprecated LobeHub model ids for runtime-level rejection', async () => {
    const result = await resolveSystemAgentModelConfig({
      taskConfig: {
        model: 'ag/gemini-3.1-pro-high',
        provider: 'lobehub',
      },
      taskKey: 'topic',
    });

    expect(result).toEqual({ model: 'ag/gemini-3.1-pro-high', provider: 'lobehub' });
  });

  it('should keep non-LobeHub provider model ids untouched', async () => {
    const result = await resolveSystemAgentModelConfig({
      taskConfig: {
        model: 'private-model',
        provider: 'openai-compatible',
      },
      taskKey: 'topic',
    });

    expect(result).toEqual({ model: 'private-model', provider: 'openai-compatible' });
  });
});

describe('resolveSystemAgentModelConfig — administrator defaults (CUST-011)', () => {
  it('uses the administrator default for a user who never picked a model', async () => {
    mocks.getCompanyServiceDefaultModel.mockResolvedValue({
      model: 'tellhow-flash',
      provider: 'tellhow',
    });

    await expect(resolveSystemAgentModelConfig({ taskKey: 'topic' })).resolves.toEqual({
      model: 'tellhow-flash',
      provider: 'tellhow',
    });

    expect(mocks.getCompanyServiceDefaultModel).toHaveBeenCalledWith('topic');
  });

  it('does not read the administrator layer when the user picked both fields', async () => {
    await resolveSystemAgentModelConfig({
      taskConfig: { model: 'user-model', provider: 'openai' },
      taskKey: 'topic',
    });

    expect(mocks.getCompanyServiceDefaultModel).not.toHaveBeenCalled();
  });

  it('lets the user pick outrank the administrator default', async () => {
    mocks.getCompanyServiceDefaultModel.mockResolvedValue({
      model: 'tellhow-flash',
      provider: 'tellhow',
    });

    await expect(
      resolveSystemAgentModelConfig({
        taskConfig: { model: 'user-model', provider: 'openai' },
        taskKey: 'topic',
      }),
    ).resolves.toEqual({ model: 'user-model', provider: 'openai' });
  });

  it('lets the administrator default outrank SYSTEM_AGENT, as on the client', async () => {
    mocks.appEnv.SYSTEM_AGENT = 'topic=env/env-model';
    mocks.getCompanyServiceDefaultModel.mockResolvedValue({
      model: 'tellhow-flash',
      provider: 'tellhow',
    });

    await expect(resolveSystemAgentModelConfig({ taskKey: 'topic' })).resolves.toEqual({
      model: 'tellhow-flash',
      provider: 'tellhow',
    });
  });

  it('keeps SYSTEM_AGENT when the administrator left the tier unset', async () => {
    mocks.appEnv.SYSTEM_AGENT = 'topic=env/env-model';

    await expect(resolveSystemAgentModelConfig({ taskKey: 'topic' })).resolves.toEqual({
      model: 'env-model',
      provider: 'env',
    });
  });

  it('keeps the code default when neither layer is configured', async () => {
    await expect(resolveSystemAgentModelConfig({ taskKey: 'topic' })).resolves.toEqual({
      model: DEFAULT_SYSTEM_AGENT_CONFIG.topic.model,
      provider: DEFAULT_SYSTEM_AGENT_CONFIG.topic.provider,
    });
  });

  it('accepts an already-resolved administrator layer instead of reading it again', async () => {
    await expect(
      resolveSystemAgentModelConfig({
        adminDefaults: { topic: { model: 'tellhow-flash', provider: 'tellhow' } },
        taskKey: 'topic',
      }),
    ).resolves.toEqual({ model: 'tellhow-flash', provider: 'tellhow' });

    expect(mocks.getCompanyServiceDefaultModel).not.toHaveBeenCalled();
  });

  it('treats an empty administrator layer as "not configured"', async () => {
    mocks.appEnv.SYSTEM_AGENT = 'topic=env/env-model';

    await expect(
      resolveSystemAgentModelConfig({ adminDefaults: {}, taskKey: 'topic' }),
    ).resolves.toEqual({ model: 'env-model', provider: 'env' });

    expect(mocks.getCompanyServiceDefaultModel).not.toHaveBeenCalled();
  });
});
