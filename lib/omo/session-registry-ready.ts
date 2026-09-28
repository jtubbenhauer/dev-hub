import type { OmoSessionBinding } from "@/lib/omo/session-registry-types";

type OmoBindingReady = Pick<
  OmoSessionBinding,
  "ready" | "resolveReady" | "rejectReady"
>;

export function createOmoBindingReady(): OmoBindingReady {
  let resolveReady = (_binding: OmoSessionBinding): void => undefined;
  let rejectReady = (_error: unknown): void => undefined;
  const ready = new Promise<OmoSessionBinding>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => undefined);
  return { ready, resolveReady, rejectReady };
}
