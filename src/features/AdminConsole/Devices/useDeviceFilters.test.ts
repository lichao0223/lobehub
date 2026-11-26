/** @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KEYWORD_DEBOUNCE_MS, useDeviceFilters } from './useDeviceFilters';
import { buildDeviceListParams } from './utils';

const renderFilters = () => renderHook(() => useDeviceFilters());

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDeviceFilters', () => {
  it('starts from the default view', () => {
    const { result } = renderFilters();

    expect(buildDeviceListParams(result.current.filters)).toEqual({
      online: undefined,
      page: 1,
      pageSize: 20,
      q: undefined,
      scope: undefined,
      visibility: undefined,
    });
  });

  it('debounces typing so only the settled keyword reaches the request', () => {
    const { result } = renderFilters();

    act(() => result.current.setKeyword('m'));
    act(() => result.current.setKeyword('ma'));
    act(() => result.current.setKeyword('mac'));

    // The input follows every keystroke, the request does not.
    expect(result.current.keyword).toBe('mac');
    expect(result.current.filters.keyword).toBe('');

    act(() => void vi.advanceTimersByTime(KEYWORD_DEBOUNCE_MS - 1));
    expect(result.current.filters.keyword).toBe('');

    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.filters.keyword).toBe('mac');
  });

  it('drops the workspace-only visibility filter on the way out of that scope', () => {
    const { result } = renderFilters();

    act(() => result.current.setScope('workspace'));
    act(() => result.current.setVisibility('private'));
    expect(result.current.filters).toMatchObject({ scope: 'workspace', visibility: 'private' });

    act(() => result.current.setScope('personal'));
    // A filter that cannot match under the new scope must not survive.
    expect(result.current.filters).toMatchObject({ scope: 'personal', visibility: 'all' });
  });

  it('keeps visibility when moving to another workspace-scoped view', () => {
    const { result } = renderFilters();

    act(() => result.current.setScope('workspace'));
    act(() => result.current.setVisibility('public'));
    act(() => result.current.setScope('workspace'));

    expect(result.current.filters.visibility).toBe('public');
  });

  it('returns to page 1 whenever a filter changes', () => {
    const { result } = renderFilters();

    act(() => result.current.setPage(5));
    act(() => result.current.setOnline('online'));
    expect(result.current.filters.page).toBe(1);

    act(() => result.current.setPage(5));
    act(() => result.current.setScope('workspace'));
    expect(result.current.filters.page).toBe(1);

    act(() => result.current.setPage(5));
    act(() => result.current.setVisibility('private'));
    expect(result.current.filters.page).toBe(1);

    act(() => result.current.setPage(5));
    act(() => result.current.setKeyword('ada'));
    expect(result.current.filters.page).toBe(1);

    // Paging itself is not a filter change.
    act(() => result.current.setPage(3));
    expect(result.current.filters.page).toBe(3);
  });

  it('clear-filters restores every dimension and settles the keyword', () => {
    const { result } = renderFilters();

    act(() => result.current.setKeyword('ghost'));
    act(() => result.current.setScope('workspace'));
    act(() => result.current.setVisibility('private'));
    act(() => result.current.setOnline('unknown'));
    act(() => result.current.setPage(4));

    act(() => result.current.resetFilters());
    act(() => void vi.advanceTimersByTime(KEYWORD_DEBOUNCE_MS));

    expect(result.current.keyword).toBe('');
    expect(result.current.filters).toEqual({
      keyword: '',
      online: 'all',
      page: 1,
      scope: 'all',
      visibility: 'all',
    });
  });
});
