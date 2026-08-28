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
  tourId: string;
};

export type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
};

/** Union of saadia kit nav + zuhaib memory/integrations/Need You entries. */
export const WORKSPACE_NAV: NavSection[] = [
  {
    id: "operate",
    label: "Operate",
    items: [
      { href: "/app", label: "Dashboard", icon: LayoutDashboard, tourId: "nav-dashboard" },
      { href: "/app/needs-you", label: "Need You", icon: HandHelping, tourId: "nav-needs-you" },
      { href: "/app/opportunities", label: "Add a posting", icon: FolderSearch, tourId: "nav-posting" },
      { href: "/app/applications", label: "Applications", icon: BriefcaseBusiness, tourId: "nav-applications" },
    ],
  },
  {
    id: "kit",
    label: "Your kit",
    items: [
      { href: "/app/memory", label: "Your kit", icon: Library, tourId: "nav-kit" },
      { href: "/app/documents", label: "Documents", icon: Files, tourId: "nav-documents" },
      { href: "/app/resumes", label: "Resumes", icon: FileBadge, tourId: "nav-resumes" },
    ],
  },
  {
    id: "account",
    label: "Account",
    items: [
      { href: "/app/notifications", label: "Notifications", icon: Bell, tourId: "nav-notifications" },
      { href: "/app/integrations", label: "Integrations", icon: Link2, tourId: "nav-integrations" },
      { href: "/app/settings", label: "Settings", icon: Settings, tourId: "nav-settings" },
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
