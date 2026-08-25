import type { LucideIcon } from "lucide-react";
import {
  Bell,
  BriefcaseBusiness,
  FileBadge,
  Files,
  FolderSearch,
  HandHelping,
  LayoutDashboard,
  Library,
  Link2,
  Settings,
} from "lucide-react";

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
      { href: "/app/needs-you", label: "Need You", icon: HandHelping },
      { href: "/app/opportunities", label: "Opportunities", icon: FolderSearch },
      { href: "/app/applications", label: "Applications", icon: BriefcaseBusiness },
    ],
  },
  {
    id: "memory",
    label: "Memory",
    items: [
      { href: "/app/memory", label: "Application Memory", icon: Library },
      { href: "/app/documents", label: "Documents", icon: Files },
      { href: "/app/resumes", label: "Resumes", icon: FileBadge },
    ],
  },
  {
    id: "account",
    label: "Account",
    items: [
      { href: "/app/notifications", label: "Notifications", icon: Bell },
      { href: "/app/integrations", label: "Integrations", icon: Link2 },
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
