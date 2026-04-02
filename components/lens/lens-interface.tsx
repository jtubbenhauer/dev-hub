"use client";

import { useEffect, useCallback, useState } from "react";
import {
  Eye,
  AlertCircle,
  Loader2,
  GripVertical,
  PanelLeft,
} from "lucide-react";
import { useLensStore } from "@/stores/lens-store";
import { LensMessages } from "@/components/lens/lens-messages";
import { LensInput } from "@/components/lens/lens-input";
import { LensSidebar } from "@/components/lens/lens-sidebar";
import { useResizablePanel } from "@/hooks/use-resizable-panel";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function LensInterface() {
  const status = useLensStore((s) => s.status);
  const messages = useLensStore((s) => s.messages);
  const streamingStatus = useLensStore((s) => s.streamingStatus);
  const streamingError = useLensStore((s) => s.streamingError);
  const isMobile = useIsMobile();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const { width: sidebarWidth, handleDragStart } = useResizablePanel({
    minWidth: 200,
    maxWidth: 400,
    defaultWidth: 280,
    storageKey: "dev-hub:lens-sidebar-width",
  });

  useEffect(() => {
    const store = useLensStore.getState();
    store.initialize();
    return () => {
      useLensStore.getState().disconnectSSE();
    };
  }, []);

  const handleSendMessage = useCallback((text: string) => {
    useLensStore.getState().sendMessage(text);
  }, []);

  const handleSidebarAction = useCallback(
    (prompt: string) => {
      setIsMobileSidebarOpen(false);
      handleSendMessage(prompt);
    },
    [handleSendMessage],
  );

  if (status === "uninitialized" || status === "initializing") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
          <span className="text-muted-foreground text-sm">
            Starting Lens...
          </span>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertCircle className="text-destructive size-8" />
          <h3 className="text-lg font-medium">Failed to start Lens</h3>
          <p className="text-muted-foreground max-w-md text-sm">
            {streamingError ?? "Could not connect to the OpenCode server."}
          </p>
        </div>
      </div>
    );
  }

  const isStreaming = streamingStatus === "streaming";
  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0">
      {/* Mobile sidebar sheet */}
      <Sheet open={isMobileSidebarOpen} onOpenChange={setIsMobileSidebarOpen}>
        <SheetContent side="left" className="w-72 p-0" showCloseButton={false}>
          <SheetHeader className="sr-only">
            <SheetTitle>Command Center</SheetTitle>
          </SheetHeader>
          <LensSidebar
            onAction={handleSidebarAction}
            isStreaming={isStreaming}
          />
        </SheetContent>
      </Sheet>

      {/* Desktop sidebar */}
      {!isMobile && (
        <>
          <div
            className="hidden shrink-0 overflow-hidden md:block"
            style={{ width: sidebarWidth }}
          >
            <LensSidebar
              onAction={handleSendMessage}
              isStreaming={isStreaming}
            />
          </div>
          <div
            className="hover:bg-accent/50 active:bg-accent hidden w-1.5 shrink-0 cursor-col-resize items-center justify-center transition-colors md:flex"
            onMouseDown={handleDragStart}
          >
            <GripVertical className="text-muted-foreground/30 size-3.5" />
          </div>
        </>
      )}

      {/* Main chat area */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Mobile sidebar toggle */}
        {isMobile && (
          <div className="bg-background flex shrink-0 items-center border-b px-3 py-2">
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => setIsMobileSidebarOpen(true)}
            >
              <PanelLeft className="size-4" />
            </Button>
          </div>
        )}

        {hasMessages ? (
          <LensMessages messages={messages} streamingStatus={streamingStatus} />
        ) : (
          <EmptyState />
        )}

        {streamingError && (
          <div className="bg-destructive/10 text-destructive flex shrink-0 items-center gap-2 border-t px-4 py-2 text-sm">
            <AlertCircle className="size-4 shrink-0" />
            <span className="flex-1">{streamingError}</span>
          </div>
        )}

        <LensInput onSubmit={handleSendMessage} isStreaming={isStreaming} />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4">
      <div className="flex flex-col items-center gap-3">
        <div className="bg-primary/10 flex size-14 items-center justify-center rounded-full">
          <Eye className="text-primary size-7" />
        </div>
        <h2 className="text-xl font-semibold">Lens</h2>
        <p className="text-muted-foreground max-w-md text-center text-sm">
          Your command center for all workspaces. Ask for a briefing, check
          active sessions, or coordinate work across your projects.
        </p>
      </div>
    </div>
  );
}
