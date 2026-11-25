'use client';

import { useUserStore } from '@/store/user';

import { shouldHideLabs } from './visibilityModel';

/**
 * Whether the per-user Labs page is meaningful on this deployment — see
 * `shouldHideLabs` for the rule and its rationale (CUST-009).
 */
export const useShouldHideLabs = (): boolean =>
  shouldHideLabs({
    isAdmin: useUserStore((s) => s.userState?.isAdmin),
    labsMode: useUserStore((s) => s.userState?.labsMode),
  });

/** Inverse of `useShouldHideLabs`: is the per-user Labs page meaningful? */
export const useLabsSettingsVisible = (): boolean => !useShouldHideLabs();
