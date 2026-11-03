import {
  CheckSquare,
  GitBranch,
  GitMerge,
  Github,
  LayoutDashboard,
  PanelsTopLeft,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { WORKBENCH_PATH } from "@/lib/workbench/workbench-href";

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

// The desktop rail and the mobile bar show the same pages in this order.
export const NAV_ITEMS: readonly NavItem[] = [
  { href: WORKBENCH_PATH, label: "Work", icon: PanelsTopLeft },
  { href: "/dashboard", label: "Dash", icon: LayoutDashboard },
  { href: "/git", label: "Git", icon: GitMerge },
  { href: "/prs", label: "PRs", icon: Github },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/workspaces", label: "Repos", icon: GitBranch },
  { href: "/settings", label: "Settings", icon: Settings },
];

// Every pathname starts with "/", so the root item only matches exactly.
export function isNavItemActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
