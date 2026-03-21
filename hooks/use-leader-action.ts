import { useEffect } from "react";
import { useLeaderKey } from "@/components/providers/leader-key-provider";
import type { LeaderAction } from "@/types/leader-key";

interface LeaderActionRegistration {
  action: LeaderAction;
  handler: () => void;
}

/**
 * Register leader key actions for the current component.
 * Actions are automatically deregistered when the component unmounts.
 *
 * Pass a stable array (defined outside render or memoized) to avoid
 * re-registering on every render.
 */
export function useLeaderAction(registrations: LeaderActionRegistration[]) {
  const { registerAction, deregisterAction } = useLeaderKey();

  useEffect(() => {
    for (const { action, handler } of registrations) {
      registerAction(action, handler);
    }

    return () => {
      for (const { action } of registrations) {
        deregisterAction(action.id);
      }
    };
    // Intentionally omit `registrations` from deps — callers must pass a stable ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerAction, deregisterAction]);
}
