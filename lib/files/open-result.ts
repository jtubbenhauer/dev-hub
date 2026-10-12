import { toast } from "sonner";
import type { OpenFileResult } from "@/lib/files/tab-state";

export function didOpenFile(result: OpenFileResult, path: string): boolean {
  if (result === "kept-foreign-dirty") {
    toast.warning(
      `${path} from another workspace has unsaved changes — save or close it first`,
    );
    return false;
  }
  return true;
}
