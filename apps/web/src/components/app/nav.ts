import {
  Bell,
  BriefcaseBusiness,
  FolderSearch,
  LayoutDashboard,
  Library,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
};

export const WORKSPACE_NAV: NavSection[] = [
  {
    id: "operate",
    label: "Operate",
    items: [
      { href: "/app", label: "Dashboard", icon: LayoutDashboard },
      { href: "/app/opportunities", label: "Add a posting", icon: FolderSearch },
      { href: "/app/applications", label: "Applications", icon: BriefcaseBusiness },
    ],
  },
  {
    id: "kit",
    label: "Your kit",
    items: [{ href: "/app/memory", label: "Your kit", icon: Library }],
  },
  {
    id: "account",
    label: "Account",
    items: [
      { href: "/app/notifications", label: "Notifications", icon: Bell },
      { href: "/app/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function isNavActive(pathname: string, href: string) {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function flatNavItems() {
  return WORKSPACE_NAV.flatMap((section) => section.items);
}
