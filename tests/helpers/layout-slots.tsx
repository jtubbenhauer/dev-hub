import type { ReactNode } from "react";

import {
  LayoutSlotHost,
  LayoutSlotsProvider,
} from "@/components/layout/layout-slots";

// Mount both layout slot hosts the way AuthenticatedLayout + Header do, so
// components that portal into them (e.g. the context sidebar) can render.
export function LayoutSlotsFixture({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <LayoutSlotsProvider>
      <LayoutSlotHost slot="header-trailing" />
      {children}
      <LayoutSlotHost slot="right-panel" />
    </LayoutSlotsProvider>
  );
}

export function getLayoutSlotHost(
  slot: "right-panel" | "header-trailing",
): HTMLElement {
  const host = document.querySelector(`[data-layout-slot="${slot}"]`);
  if (!(host instanceof HTMLElement)) {
    throw new Error(`missing layout slot host ${slot}`);
  }
  return host;
}
