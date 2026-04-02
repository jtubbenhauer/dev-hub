"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  FileCode2,
  GitMerge,
  GitBranch,
  GitCompare,
  Terminal,
  Settings,
  CheckSquare,
  Eye,
} from "lucide-react";
import { useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { useCommand } from "@/hooks/use-command";
import { useLeaderAction } from "@/hooks/use-leader-action";
import { useCommandPalette } from "@/components/providers/command-palette-provider";
import { useFilePicker } from "@/components/file-picker/file-picker";
import { useSessionPicker } from "@/components/session-picker/session-picker";
import { useTaskPicker } from "@/components/task-picker/task-picker";
import { useGitPicker } from "@/components/git-picker/git-picker";
import { useWorkspacePicker } from "@/components/workspace-picker/workspace-picker";

const navItems = [
  { href: "/", label: "Dash", icon: LayoutDashboard },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/files", label: "Files", icon: FileCode2 },
  { href: "/git", label: "Git", icon: GitMerge },
  { href: "/terminal", label: "Term", icon: Terminal },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/lens", label: "Lens", icon: Eye },
  { href: "/workspaces", label: "Repos", icon: GitBranch },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { open: openCommandPalette } = useCommandPalette();
  const { open: openFilePicker } = useFilePicker();
  const { open: openSessionPicker } = useSessionPicker();
  const { open: openTaskPicker } = useTaskPicker();
  const { open: openGitPicker } = useGitPicker();
  const { open: openWorkspacePicker } = useWorkspacePicker();

  const navCommands = useMemo(
    () =>
      navItems.map((item) => ({
        id: `nav:${item.href}`,
        label: `Go to ${item.label}`,
        group: "Navigation",
        icon: item.icon,
        onSelect: () => router.push(item.href),
      })),
    // router is stable; navItems is module-level constant
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useCommand(navCommands);

  const pickerCommands = useMemo(
    () => [
      {
        id: "picker:git-files",
        label: "Open Git Files",
        group: "Pickers",
        icon: GitCompare,
        shortcut: "⎵ d",
        onSelect: () => openGitPicker(),
      },
    ],
    // openGitPicker is stable (useCallback in context)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useCommand(pickerCommands);

  // Stable refs so the leader action useMemo stays stable
  const routerRef = useRef(router);
  routerRef.current = router;
  const openCommandPaletteRef = useRef(openCommandPalette);
  openCommandPaletteRef.current = openCommandPalette;
  const openFilePickerRef = useRef(openFilePicker);
  openFilePickerRef.current = openFilePicker;
  const openSessionPickerRef = useRef(openSessionPicker);
  openSessionPickerRef.current = openSessionPicker;
  const openTaskPickerRef = useRef(openTaskPicker);
  openTaskPickerRef.current = openTaskPicker;
  const openGitPickerRef = useRef(openGitPicker);
  openGitPickerRef.current = openGitPicker;
  const openWorkspacePickerRef = useRef(openWorkspacePicker);
  openWorkspacePickerRef.current = openWorkspacePicker;

  const globalLeaderActions = useMemo(
    () => [
      {
        action: {
          id: "nav:chat",
          label: "Go to Chat",
          page: "global" as const,
        },
        handler: () => routerRef.current.push("/chat"),
      },
      {
        action: {
          id: "nav:files",
          label: "Go to Files",
          page: "global" as const,
        },
        handler: () => routerRef.current.push("/files"),
      },
      {
        action: { id: "nav:git", label: "Go to Git", page: "global" as const },
        handler: () => routerRef.current.push("/git"),
      },
      {
        action: {
          id: "nav:tasks",
          label: "Go to Tasks",
          page: "global" as const,
        },
        handler: () => routerRef.current.push("/tasks"),
      },
      {
        action: {
          id: "nav:dashboard",
          label: "Go to Dashboard",
          page: "global" as const,
        },
        handler: () => routerRef.current.push("/"),
      },
      {
        action: {
          id: "nav:repos",
          label: "Go to Repos",
          page: "global" as const,
        },
        handler: () => routerRef.current.push("/workspaces"),
      },
      {
        action: {
          id: "nav:lens",
          label: "Go to Lens",
          page: "global" as const,
        },
        handler: () => routerRef.current.push("/lens"),
      },
      {
        action: {
          id: "nav:settings",
          label: "Go to Settings",
          page: "global" as const,
        },
        handler: () => routerRef.current.push("/settings"),
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
          label: "Go to Terminal",
          page: "global" as const,
        },
        handler: () => routerRef.current.push("/terminal"),
      },
    ],
    [],
  );

  useLeaderAction(globalLeaderActions);

  return (
    <aside className="bg-sidebar hidden h-screen w-16 flex-col border-r md:flex">
      <div className="flex h-12 items-center justify-center border-b">
        <Terminal className="text-sidebar-primary h-5 w-5" />
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-md py-2 text-[10px] font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
