import { useDebounce } from 'ahooks';
import { useCallback, useMemo, useState } from 'react';

import type { DeviceFilterState, OnlineFilter, ScopeFilter, VisibilityFilter } from './utils';
import { DEFAULT_DEVICE_FILTERS } from './utils';

/** How long typing settles before a keystroke becomes a request. */
export const KEYWORD_DEBOUNCE_MS = 300;

export interface DeviceFilterControls {
  /** The filters a request should be built from — keyword already debounced. */
  filters: DeviceFilterState;
  /** The raw input value, so the search box keeps up with every keystroke. */
  keyword: string;
  resetFilters: () => void;
  setKeyword: (value: string) => void;
  setOnline: (value: OnlineFilter) => void;
  setPage: (value: number) => void;
  setScope: (value: ScopeFilter) => void;
  setVisibility: (value: VisibilityFilter) => void;
}

/**
 * Toolbar state for the admin device list.
 *
 * Every filter change returns to page 1: staying on page 5 of a filter that now
 * matches three rows shows an empty screen that looks like a broken list.
 */
export const useDeviceFilters = (): DeviceFilterControls => {
  const [keyword, setKeywordState] = useState(DEFAULT_DEVICE_FILTERS.keyword);
  const [scope, setScopeState] = useState<ScopeFilter>(DEFAULT_DEVICE_FILTERS.scope);
  const [online, setOnlineState] = useState<OnlineFilter>(DEFAULT_DEVICE_FILTERS.online);
  const [visibility, setVisibilityState] = useState<VisibilityFilter>(
    DEFAULT_DEVICE_FILTERS.visibility,
  );
  const [page, setPage] = useState(DEFAULT_DEVICE_FILTERS.page);

  const debouncedKeyword = useDebounce(keyword, { wait: KEYWORD_DEBOUNCE_MS });

  const filters = useMemo<DeviceFilterState>(
    () => ({ keyword: debouncedKeyword, online, page, scope, visibility }),
    [debouncedKeyword, online, page, scope, visibility],
  );

  const setKeyword = useCallback((value: string) => {
    setKeywordState(value);
    setPage(1);
  }, []);

  const setScope = useCallback((value: ScopeFilter) => {
    setScopeState(value);
    // Visibility is a workspace-only dimension: keeping it applied under another
    // scope would show a filter that cannot match anything.
    if (value !== 'workspace') setVisibilityState(DEFAULT_DEVICE_FILTERS.visibility);
    setPage(1);
  }, []);

  const setOnline = useCallback((value: OnlineFilter) => {
    setOnlineState(value);
    setPage(1);
  }, []);

  const setVisibility = useCallback((value: VisibilityFilter) => {
    setVisibilityState(value);
    setPage(1);
  }, []);

  const resetFilters = useCallback(() => {
    setKeywordState(DEFAULT_DEVICE_FILTERS.keyword);
    setScopeState(DEFAULT_DEVICE_FILTERS.scope);
    setOnlineState(DEFAULT_DEVICE_FILTERS.online);
    setVisibilityState(DEFAULT_DEVICE_FILTERS.visibility);
    setPage(DEFAULT_DEVICE_FILTERS.page);
  }, []);

  return {
    filters,
    keyword,
    resetFilters,
    setKeyword,
    setOnline,
    setPage,
    setScope,
    setVisibility,
  };
};
