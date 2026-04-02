"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Header } from "@/components/layout/header";
import { WorkspaceCommands } from "@/components/command-palette/workspace-commands";
import { SoundSettingsSync } from "@/components/providers/sound-settings-sync";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useChatStore } from "@/stores/chat-store";
import { useDefaultWorkspaceSetting } from "@/hooks/use-settings";
import type { Workspace } from "@/types";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useKeyboardVisible } from "@/hooks/use-keyboard-visible";
import { cn } from "@/lib/utils";
import { shouldSSEConnect } from "@/lib/workspaces/behaviour";

function getSidebarCookie(): boolean {
  if (typeof document === "undefined") return false;
  const match = document.cookie.match(/(?:^|;\s*)sidebar_state=(\w+)/);
  return match ? match[1] === "true" : false;
}

export function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status } = useSession();
  const router = useRouter();
  const {
    setWorkspaces,
    setIsLoadingWorkspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
  } = useWorkspaceStore();
  const { defaultWorkspaceId } = useDefaultWorkspaceSetting();
  const connectGlobalSSE = useChatStore((s) => s.connectGlobalSSE);
  const disconnectGlobalSSE = useChatStore((s) => s.disconnectGlobalSSE);
  const handleVisibilityRestored = useChatStore(
    (s) => s.handleVisibilityRestored,
  );
  const isKeyboardVisible = useKeyboardVisible();
  const [sidebarOpen, setSidebarOpen] = useState(() => getSidebarCookie());
  const wasAuthenticatedRef = useRef(false);

  const { data, isFetching } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const res = await fetch("/api/workspaces");
      if (!res.ok) throw new Error("Failed to fetch workspaces");
      return res.json();
    },
    staleTime: 60_000,
    enabled: status === "authenticated",
  });

  useEffect(() => {
    setIsLoadingWorkspaces(isFetching && !data);
  }, [isFetching, data, setIsLoadingWorkspaces]);

  useEffect(() => {
    if (!data) return;
    setWorkspaces(data);
    if (!activeWorkspaceId && data.length > 0) {
      const preferred =
        defaultWorkspaceId && data.some((w) => w.id === defaultWorkspaceId)
          ? defaultWorkspaceId
          : data[0].id;
      setActiveWorkspaceId(preferred);
    }
    connectGlobalSSE(
      data
        .filter((w) => shouldSSEConnect(w, activeWorkspaceId))
        .map((w) => w.id),
    );
  }, [
    data,
    activeWorkspaceId,
    defaultWorkspaceId,
    setWorkspaces,
    setActiveWorkspaceId,
    connectGlobalSSE,
  ]);

  useEffect(() => {
    return () => disconnectGlobalSSE();
  }, [disconnectGlobalSSE]);

  // When the user returns to this tab, flush any part updates that were buffered
  // while the tab was hidden (browsers suspend requestAnimationFrame in background
  // tabs, so the normal RAF flush never fires), and verify SSE health.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        handleVisibilityRestored();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [handleVisibilityRestored]);

  useEffect(() => {
    if (status === "authenticated") {
      wasAuthenticatedRef.current = true;
    }
    // Only redirect on initial unauthenticated load. If the user was already
    // authenticated, a transient refetch failure (common on mobile tab switches
    // where the browser suspends network) should not bounce them to /login.
    // The server-side middleware still guards all routes, so a truly expired
    // session is caught on the next navigation or API call.
    if (status === "unauthenticated" && !wasAuthenticatedRef.current) {
      router.push("/login");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
      </div>
    );
  }

  if (status === "unauthenticated") return null;

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      className="h-dvh"
      style={{ "--sidebar-width": "4rem" } as React.CSSProperties}
    >
      <AppSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main
          className={cn(
            "flex min-w-0 flex-1 flex-col overflow-hidden",
            !isKeyboardVisible && "pb-16 md:pb-0",
          )}
        >
          {children}
        </main>
      </div>
      <MobileNav />
      <WorkspaceCommands />
      <SoundSettingsSync />
    </SidebarProvider>
  );
}
