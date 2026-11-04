"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type LayoutSlotName = "right-panel" | "header-trailing";

type LayoutSlotElements = Readonly<Record<LayoutSlotName, HTMLElement | null>>;

type LayoutSlotRef = (element: HTMLElement | null) => void;

interface LayoutSlotsContextValue {
  readonly slots: LayoutSlotElements;
  readonly slotRefs: Readonly<Record<LayoutSlotName, LayoutSlotRef>>;
}

const LayoutSlotsContext = createContext<LayoutSlotsContextValue | null>(null);

export function LayoutSlotsProvider({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const [slots, setSlots] = useState<LayoutSlotElements>({
    "right-panel": null,
    "header-trailing": null,
  });

  const setRightPanelElement = useCallback<LayoutSlotRef>((element) => {
    setSlots((current) =>
      current["right-panel"] === element
        ? current
        : { ...current, "right-panel": element },
    );
  }, []);

  const setHeaderTrailingElement = useCallback<LayoutSlotRef>((element) => {
    setSlots((current) =>
      current["header-trailing"] === element
        ? current
        : { ...current, "header-trailing": element },
    );
  }, []);

  const value = useMemo<LayoutSlotsContextValue>(
    () => ({
      slots,
      slotRefs: {
        "right-panel": setRightPanelElement,
        "header-trailing": setHeaderTrailingElement,
      },
    }),
    [slots, setRightPanelElement, setHeaderTrailingElement],
  );

  return (
    <LayoutSlotsContext.Provider value={value}>
      {children}
    </LayoutSlotsContext.Provider>
  );
}

// The element a layout region renders for portaled content. Outside the
// provider it registers nothing, so a bare <Header /> still renders.
export function LayoutSlotHost({
  slot,
  className,
}: {
  readonly slot: LayoutSlotName;
  readonly className?: string;
}) {
  const context = useContext(LayoutSlotsContext);
  return (
    <div
      ref={context?.slotRefs[slot]}
      data-layout-slot={slot}
      className={className}
    />
  );
}

export function LayoutSlotPortal({
  slot,
  children,
}: {
  readonly slot: LayoutSlotName;
  readonly children: React.ReactNode;
}) {
  const context = useContext(LayoutSlotsContext);
  const element = context?.slots[slot] ?? null;
  if (element === null) return null;
  return createPortal(children, element);
}
