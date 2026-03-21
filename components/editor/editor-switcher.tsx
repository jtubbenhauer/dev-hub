"use client";

import { forwardRef } from "react";
import dynamic from "next/dynamic";
import { useEditorTypeSetting } from "@/hooks/use-settings";
import type { NeovimEditorHandle } from "@/components/editor/neovim-editor";
import type { MonacoEditorHandle } from "@/components/editor/monaco-editor";

export type EditorHandle = NeovimEditorHandle | MonacoEditorHandle;

const MonacoEditor = dynamic(
  () => import("@/components/editor/monaco-editor").then((m) => m.MonacoEditor),
  {
    ssr: false,
    loading: () => <div className="bg-muted h-full w-full animate-pulse" />,
  },
);

const NeovimEditor = dynamic(
  () => import("@/components/editor/neovim-editor").then((m) => m.NeovimEditor),
  {
    ssr: false,
    loading: () => <div className="bg-muted h-full w-full animate-pulse" />,
  },
);

interface EditorSwitcherProps {
  content: string;
  language: string;
  onChange: (content: string) => void;
  onSave?: () => void;
  workspaceId?: string;
  filePath?: string;
  autoFocus?: boolean;
}

export const EditorSwitcher = forwardRef<EditorHandle, EditorSwitcherProps>(
  function EditorSwitcher(props, ref) {
    const { editorType } = useEditorTypeSetting();

    if (editorType === "neovim") {
      return <NeovimEditor ref={ref} {...props} />;
    }

    return <MonacoEditor ref={ref} {...props} />;
  },
);
