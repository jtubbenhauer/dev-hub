import { useLeaderAction } from "@/hooks/use-leader-action";
import { getFocusedFileTabCommands } from "@/lib/workbench/focused-file-tab-commands";
import { useContentSearchStore } from "@/stores/content-search-store";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";

// Module-level so useLeaderAction gets the stable array it requires.
const FILE_TAB_LEADER_ACTIONS: Parameters<typeof useLeaderAction>[0] = [
  {
    action: { id: "files:save", label: "Save file", page: "files" },
    handler: () => getFocusedFileTabCommands()?.save(),
  },
  {
    action: { id: "files:focus-editor", label: "Focus editor", page: "files" },
    handler: () => getFocusedFileTabCommands()?.focusEditor(),
  },
  {
    action: { id: "files:focus-tree", label: "Focus file tree", page: "files" },
    handler: () => {
      const contextSidebar = useContextSidebarStore.getState();
      contextSidebar.openView("explorer");
      contextSidebar.requestFocus("tree");
    },
  },
  {
    action: {
      id: "files:focus-search",
      label: "Focus file search",
      page: "files",
    },
    handler: () => {
      useContentSearchStore.getState().setSidebarView("explorer");
      const contextSidebar = useContextSidebarStore.getState();
      contextSidebar.openView("explorer");
      contextSidebar.requestFocus("file-search");
    },
  },
];

// Only the focused file tab renders this, so `files:*` act on that tab.
export function FileTabLeaderActions() {
  useLeaderAction(FILE_TAB_LEADER_ACTIONS);
  return null;
}
