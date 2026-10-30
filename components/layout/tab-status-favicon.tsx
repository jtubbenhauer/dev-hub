"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useNotificationSettings } from "@/hooks/use-settings";
import {
  applyFaviconHref,
  isFaviconHrefApplied,
  loadFaviconBaseImage,
  renderFaviconFrame,
  restoreFaviconHref,
} from "@/lib/attention/favicon-canvas";
import {
  FAVICON_BLINK_INTERVAL_MS,
  TAB_ATTENTION_DOT_COLORS,
  resolveTabAttention,
  selectChatAttention,
  type TabAttention,
} from "@/lib/attention/tab-attention";
import { useAttentionStore } from "@/stores/attention-store";
import { useChatStore } from "@/stores/chat-store";

export function TabStatusFavicon() {
  const { isFaviconStatusEnabled, isLoading: isNotificationSettingsLoading } =
    useNotificationSettings();
  const chatAttention = useChatStore((state) =>
    selectChatAttention({
      workspaceStates: state.workspaceStates,
      connectedWorkspaceIds: state.sseWorkspaceIds,
      optimisticStreamingSessionId: state.optimisticStreamingSessionId,
    }),
  );
  const hasUnseenFinished = useAttentionStore(
    (state) => state.unseenFinishedKeys.length > 0,
  );
  const pathname = usePathname();
  // No dot until settings load, so a user who disabled it never sees a flash.
  const tabAttention: TabAttention =
    isNotificationSettingsLoading || !isFaviconStatusEnabled
      ? "none"
      : resolveTabAttention(chatAttention, hasUnseenFinished);

  const baseImageRef = useRef<HTMLImageElement | null>(null);
  const [isBaseImageReady, setIsBaseImageReady] = useState(false);
  const frameCacheRef = useRef(new Map<string, string>());
  const desiredHrefRef = useRef<string | null>(null);

  useEffect(() => {
    let isCancelled = false;
    void loadFaviconBaseImage().then((image) => {
      if (isCancelled || !image) return;
      baseImageRef.current = image;
      setIsBaseImageReady(true);
    });
    return () => {
      isCancelled = true;
    };
  }, []);

  // pathname is a deliberate dependency: re-apply after client navigation.
  useEffect(() => {
    const baseImage = baseImageRef.current;
    if (tabAttention === "none" || !isBaseImageReady || !baseImage) {
      desiredHrefRef.current = null;
      restoreFaviconHref();
      return;
    }

    const frameCache = frameCacheRef.current;
    const getFrame = (dotColor: string | null): string | null => {
      const cacheKey = dotColor ?? "base";
      const cachedFrame = frameCache.get(cacheKey);
      if (cachedFrame !== undefined) return cachedFrame;
      const renderedFrame = renderFaviconFrame(baseImage, dotColor);
      if (renderedFrame !== null) frameCache.set(cacheKey, renderedFrame);
      return renderedFrame;
    };

    const dottedFrame = getFrame(TAB_ATTENTION_DOT_COLORS[tabAttention]);
    if (dottedFrame === null) {
      desiredHrefRef.current = null;
      restoreFaviconHref();
      return;
    }
    applyFaviconHref(dottedFrame);
    desiredHrefRef.current = dottedFrame;
    if (tabAttention !== "working") return;

    const baseFrame = getFrame(null);
    if (baseFrame === null) return;
    let isDotVisible = true;
    const blinkIntervalId = setInterval(() => {
      isDotVisible = !isDotVisible;
      const nextFrame = isDotVisible ? dottedFrame : baseFrame;
      applyFaviconHref(nextFrame);
      desiredHrefRef.current = nextFrame;
    }, FAVICON_BLINK_INTERVAL_MS);
    return () => clearInterval(blinkIntervalId);
  }, [tabAttention, isBaseImageReady, pathname]);

  useEffect(() => {
    // Head only: Next renders the icon link there, and observing the whole
    // document would fire on every streaming DOM update.
    const iconLinkObserver = new MutationObserver(() => {
      const desiredHref = desiredHrefRef.current;
      if (desiredHref && !isFaviconHrefApplied(desiredHref)) {
        applyFaviconHref(desiredHref);
      }
    });
    iconLinkObserver.observe(document.head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href"],
    });
    return () => {
      iconLinkObserver.disconnect();
      restoreFaviconHref();
    };
  }, []);

  return null;
}
