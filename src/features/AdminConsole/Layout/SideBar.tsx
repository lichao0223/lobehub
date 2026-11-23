'use client';

import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import SidebarContent from './SidebarContent';

const SideBar = () => (
  <NavPanelPortal navKey="admin">
    <SidebarContent />
  </NavPanelPortal>
);

export default SideBar;
