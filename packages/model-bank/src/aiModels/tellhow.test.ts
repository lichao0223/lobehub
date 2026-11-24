import { describe, expect, it } from 'vitest';

import { LOBE_DEFAULT_MODEL_LIST } from './index';
import { tellhowModels } from './tellhow';

describe('tellhowModels', () => {
  it('starts empty because the admin console owns the catalog', () => {
    expect(tellhowModels).toEqual([]);
    expect(LOBE_DEFAULT_MODEL_LIST.some((model) => model.providerId === 'tellhow')).toBe(false);
  });
});
