import { useMemo } from "react";
import { shallow } from "zustand/shallow";
import type { OpenFile } from "@/types";

type TabMetadata = Omit<OpenFile, "content" | "originalContent">;

function createEditorTabMetadataSelector() {
  let previous: TabMetadata[] = [];
  return (state: { openFiles: OpenFile[] }) => {
    const next = state.openFiles.map((file, index) => {
      const { content, originalContent, ...metadata } = file;
      void content;
      void originalContent;
      return shallow(previous[index], metadata) ? previous[index] : metadata;
    });
    if (!shallow(previous, next)) previous = next;
    return previous;
  };
}

export function useEditorTabMetadataSelector() {
  return useMemo(() => createEditorTabMetadataSelector(), []);
}
