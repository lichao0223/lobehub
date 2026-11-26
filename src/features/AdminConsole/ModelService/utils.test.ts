import type { CompanyModel } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { acceptsDefaultModel, isDefaultModelCompliant, toDefaults } from './utils';

const model = (overrides: Partial<CompanyModel> & Pick<CompanyModel, 'id'>): CompanyModel => ({
  name: overrides.id,
  open: true,
  source: 'sync',
  type: 'chat',
  ...overrides,
});

const vision = model({ capabilities: ['vision'], id: 'tellhow-vl' });
const textOnly = model({ id: 'tellhow-chat' });
const hidden = model({ id: 'tellhow-internal', open: false });
const embedding = model({ id: 'tellhow-embed', type: 'embedding' });

describe('acceptsDefaultModel', () => {
  it('offers only vision models as the acceptance default', () => {
    expect(acceptsDefaultModel(vision, 'verify')).toBe(true);
    expect(acceptsDefaultModel(textOnly, 'verify')).toBe(false);
  });

  it('offers only open chat models as the main default', () => {
    expect(acceptsDefaultModel(textOnly, 'chat')).toBe(true);
    expect(acceptsDefaultModel(hidden, 'chat')).toBe(false);
    expect(acceptsDefaultModel(embedding, 'chat')).toBe(false);
  });

  it('offers embedding models for the memory default', () => {
    expect(acceptsDefaultModel(embedding, 'embedding')).toBe(true);
    expect(acceptsDefaultModel(textOnly, 'embedding')).toBe(false);
  });
});

describe('isDefaultModelCompliant', () => {
  const models = [vision, textOnly, embedding];

  it('treats an unset default as fine, because it inherits', () => {
    expect(isDefaultModelCompliant(models, 'verify', undefined)).toBe(true);
    expect(isDefaultModelCompliant(models, 'verify', '')).toBe(true);
  });

  it('reports a stored text-only acceptance model instead of accepting it silently', () => {
    expect(isDefaultModelCompliant(models, 'verify', 'tellhow-vl')).toBe(true);
    expect(isDefaultModelCompliant(models, 'verify', 'tellhow-chat')).toBe(false);
  });

  it('reports a stored model that is no longer in the catalog', () => {
    expect(isDefaultModelCompliant(models, 'chat', 'gone-model')).toBe(false);
  });
});

describe('toDefaults', () => {
  it('keeps every default it is given, including a non-compliant legacy value', () => {
    expect(toDefaults({ chat: ' c ', embedding: '', title: 't', verify: 'legacy-text' })).toEqual({
      chat: 'c',
      title: 't',
      verify: 'legacy-text',
    });
  });
});
