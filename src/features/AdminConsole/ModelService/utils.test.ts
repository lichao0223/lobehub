import type { CompanyModel } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  acceptsDefaultModel,
  defaultModelIssue,
  defaultModelMessageKey,
  defaultModelTagKey,
  isDefaultModelCompliant,
  toDefaults,
} from './utils';

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
const hiddenVision = model({ capabilities: ['vision'], id: 'tellhow-vl-internal', open: false });
const embedding = model({ id: 'tellhow-embed', type: 'embedding' });
const hiddenEmbedding = model({ id: 'tellhow-embed-internal', open: false, type: 'embedding' });
const removed = model({ id: 'tellhow-removed', removedAt: '2026-11-01T00:00:00.000Z' });

const ALL_KEYS = ['chat', 'embedding', 'title', 'verify'] as const;

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

  // The resolver only honours models users can see. Offering a closed or
  // removed one let the admin save it and then see nothing change.
  it('never offers a model users cannot see, for any default', () => {
    expect(ALL_KEYS.map((key) => acceptsDefaultModel(hidden, key))).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(ALL_KEYS.map((key) => acceptsDefaultModel(hiddenVision, key))).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(ALL_KEYS.map((key) => acceptsDefaultModel(hiddenEmbedding, key))).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(ALL_KEYS.map((key) => acceptsDefaultModel(removed, key))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('defaultModelIssue', () => {
  const models = [vision, textOnly, hidden, hiddenVision, embedding, hiddenEmbedding, removed];

  it('stays quiet for an unset or usable default', () => {
    expect(defaultModelIssue(models, 'chat', undefined)).toBeUndefined();
    expect(defaultModelIssue(models, 'chat', '')).toBeUndefined();
    expect(defaultModelIssue(models, 'title', 'tellhow-chat')).toBeUndefined();
  });

  it('names the reason so the card can explain it instead of saying "not usable"', () => {
    expect(defaultModelIssue(models, 'title', 'tellhow-internal')).toBe('closed');
    expect(defaultModelIssue(models, 'embedding', 'tellhow-embed-internal')).toBe('closed');
    expect(defaultModelIssue(models, 'verify', 'tellhow-vl-internal')).toBe('closed');
    expect(defaultModelIssue(models, 'chat', 'tellhow-removed')).toBe('removed');
    expect(defaultModelIssue(models, 'chat', 'gone-model')).toBe('missing');
    expect(defaultModelIssue(models, 'chat', 'tellhow-embed')).toBe('type');
    expect(defaultModelIssue(models, 'verify', 'tellhow-chat')).toBe('vision');
  });
});

describe('isDefaultModelCompliant', () => {
  const models = [vision, textOnly, embedding, hidden, hiddenVision, hiddenEmbedding, removed];

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

  // Regression (T-102): a default saved while the model was still offered, or
  // saved against a closed model through another path, must not stay silent.
  it('reports a stored default users cannot see, on every tier', () => {
    expect(isDefaultModelCompliant(models, 'chat', 'tellhow-internal')).toBe(false);
    expect(isDefaultModelCompliant(models, 'title', 'tellhow-internal')).toBe(false);
    expect(isDefaultModelCompliant(models, 'verify', 'tellhow-vl-internal')).toBe(false);
    expect(isDefaultModelCompliant(models, 'embedding', 'tellhow-embed-internal')).toBe(false);
    expect(isDefaultModelCompliant(models, 'title', 'tellhow-removed')).toBe(false);
  });
});

describe('default model feedback copy', () => {
  // T-102: the pair the card renders for a stored default that cannot take
  // effect — a reason-specific warning plus a short tag on the stale option.
  it('gives a closed model its own message instead of a generic "not usable"', () => {
    const issue = defaultModelIssue([hidden], 'title', 'tellhow-internal');

    expect(issue).toBe('closed');
    expect(defaultModelMessageKey(issue!)).toBe('modelService.defaults.closed');
    expect(defaultModelTagKey(issue!)).toBe('modelService.defaults.closedTag');
  });

  it('keeps the removed, vision and generic messages for their own reasons', () => {
    expect(defaultModelMessageKey('removed')).toBe('modelService.defaults.removed');
    expect(defaultModelTagKey('removed')).toBe('modelService.defaults.removedTag');
    expect(defaultModelMessageKey('vision')).toBe('modelService.defaults.verifyInvalid');
    expect(defaultModelMessageKey('missing')).toBe('modelService.defaults.invalid');
    expect(defaultModelTagKey('missing')).toBe('modelService.defaults.unsupported');
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
