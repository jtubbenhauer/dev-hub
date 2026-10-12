import { memo, type ComponentProps } from "react";
import { EditorSwitcher } from "@/components/editor/editor-switcher";
import { useEditorStore } from "@/stores/editor-store";

export const FilesActiveEditor = memo(function FilesActiveEditor(
  props: Omit<ComponentProps<typeof EditorSwitcher>, "content">,
) {
  const content = useEditorStore(
    (state) =>
      state.openFiles.find((file) => file.path === props.filePath)?.content ??
      "",
  );
  return <EditorSwitcher {...props} content={content} />;
});
