"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { GitCompare } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useLeaderAction } from "@/hooks/use-leader-action";
import { useCommandPalette } from "@/components/providers/command-palette-provider";
import { useFilePicker } from "@/components/file-picker/file-picker";
import { useSessionPicker } from "@/components/session-picker/session-picker";
import { useTaskPicker } from "@/components/task-picker/task-picker";
import { useGitPicker } from "@/components/git-picker/git-picker";
import { useWorkspacePicker } from "@/components/workspace-picker/workspace-picker";
import { openFindInFiles } from "@/lib/files/open-find-in-files";
import { focusRecentInWorkbench } from "@/lib/workbench/open-in-workbench";
import { WORKBENCH_PATH } from "@/lib/workbench/workbench-href";
import { isNavItemActive, NAV_ITEMS } from "@/components/layout/nav-items";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { open: openCommandPalette } = useCommandPalette();
  const { open: openFilePicker } = useFilePicker();
  const { open: openSessionPicker } = useSessionPicker();
  const { open: openTaskPicker } = useTaskPicker();
  const { open: openGitPicker } = useGitPicker();
  const { open: openWorkspacePicker } = useWorkspacePicker();

  // Stable refs so the leader action useMemo stays stable
  const routerRef = useRef(router);
  const pathnameRef = useRef(pathname);
  const openCommandPaletteRef = useRef(openCommandPalette);
  const openFilePickerRef = useRef(openFilePicker);
  const openSessionPickerRef = useRef(openSessionPicker);
  const openTaskPickerRef = useRef(openTaskPicker);
  const openGitPickerRef = useRef(openGitPicker);
  const openWorkspacePickerRef = useRef(openWorkspacePicker);
  useEffect(() => {
    routerRef.current = router;
    pathnameRef.current = pathname;
    openCommandPaletteRef.current = openCommandPalette;
    openFilePickerRef.current = openFilePicker;
    openSessionPickerRef.current = openSessionPicker;
    openTaskPickerRef.current = openTaskPicker;
    openGitPickerRef.current = openGitPicker;
    openWorkspacePickerRef.current = openWorkspacePicker;
  });

  const globalLeaderActions = useMemo(() => {
    const navigate = (href: string) => routerRef.current.push(href);
    // The command palette lists these, with the sidebar link's icon.
    const navIcon = (href: string) =>
      NAV_ITEMS.find((item) => item.href === href)?.icon;
    return [
      {
        action: {
          id: "nav:workbench",
          label: "Go to Workbench",
          page: "global" as const,
          icon: navIcon(WORKBENCH_PATH),
        },
        handler: () => navigate(WORKBENCH_PATH),
      },
      {
        action: {
          id: "nav:chat",
          label: "Focus chat tab",
          page: "global" as const,
        },
        handler: () => focusRecentInWorkbench({ kind: "chat", navigate }),
      },
      {
        action: {
          id: "nav:files",
          label: "Focus file tab",
          page: "global" as const,
        },
        handler: () => focusRecentInWorkbench({ kind: "file", navigate }),
      },
      {
        action: {
          id: "nav:git",
          label: "Go to Git",
          page: "global" as const,
          icon: navIcon("/git"),
        },
        handler: () => navigate("/git"),
      },
      {
        action: {
          id: "nav:prs",
          label: "Go to PRs",
          page: "global" as const,
          icon: navIcon("/prs"),
        },
        handler: () => navigate("/prs"),
      },
      {
        action: {
          id: "nav:tasks",
          label: "Go to Tasks",
          page: "global" as const,
          icon: navIcon("/tasks"),
        },
        handler: () => navigate("/tasks"),
      },
      {
        action: {
          id: "nav:dashboard",
          label: "Go to Dashboard",
          page: "global" as const,
          icon: navIcon("/dashboard"),
        },
        handler: () => navigate("/dashboard"),
      },
      {
        action: {
          id: "nav:repos",
          label: "Go to Repos",
          page: "global" as const,
          icon: navIcon("/workspaces"),
        },
        handler: () => navigate("/workspaces"),
      },
      {
        action: {
          id: "nav:settings",
          label: "Go to Settings",
          page: "global" as const,
          icon: navIcon("/settings"),
        },
        handler: () => navigate("/settings"),
      },
      {
        action: {
          id: "global:command-palette",
          label: "Open command palette",
          page: "global" as const,
        },
        handler: () => openCommandPaletteRef.current(),
      },
      {
        action: {
          id: "global:file-picker",
          label: "Open file picker",
          page: "global" as const,
        },
        handler: () => openFilePickerRef.current(),
      },
      {
        action: {
          id: "global:find-in-files",
          label: "Find in files",
          page: "global" as const,
        },
        handler: () =>
          openFindInFiles({ pathname: pathnameRef.current, push: navigate }),
      },
      {
        action: {
          id: "global:session-picker",
          label: "Open session picker",
          page: "global" as const,
        },
        handler: () => openSessionPickerRef.current(),
      },
      {
        action: {
          id: "global:task-picker",
          label: "Open task picker",
          page: "global" as const,
        },
        handler: () => openTaskPickerRef.current(),
      },
      {
        action: {
          id: "global:git-picker",
          label: "Open git files picker",
          page: "global" as const,
          icon: GitCompare,
        },
        handler: () => openGitPickerRef.current(),
      },
      {
        action: {
          id: "global:switch-workspace",
          label: "Switch workspace",
          page: "global" as const,
        },
        handler: () => openWorkspacePickerRef.current(),
      },
      {
        action: {
          id: "nav:terminal",
          label: "Focus terminal tab",
          page: "global" as const,
        },
        handler: () => focusRecentInWorkbench({ kind: "terminal", navigate }),
      },
    ];
  }, []);

  useLeaderAction(globalLeaderActions);

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarContent>
        <SidebarGroup className="p-2">
          <SidebarMenu className="gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = isNavItemActive(item.href, pathname);
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    tooltip={item.label}
                    className="flex h-auto flex-col items-center gap-0.5 py-2 [&>svg]:size-5"
                  >
                    <Link href={item.href}>
                      <item.icon />
                      <span className="text-[10px] leading-tight font-medium">
                        {item.label}
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
