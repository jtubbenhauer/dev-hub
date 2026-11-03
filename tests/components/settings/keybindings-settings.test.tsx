import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";

import { KeybindingsSettings } from "@/components/settings/keybindings-settings";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function stubSettingsFetch(settings: Record<string, unknown>) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) =>
      Response.json(init?.method === "PUT" ? { ok: true } : settings),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderKeybindingsSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <KeybindingsSettings />
    </QueryClientProvider>,
  );
}

async function findWorkbenchShortcutsSwitch(): Promise<HTMLElement> {
  const workbenchSwitch = await screen.findByRole("switch", {
    name: "Enable workbench shortcuts",
  });
  await waitFor(() => expect(workbenchSwitch).not.toBeDisabled());
  return workbenchSwitch;
}

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KeybindingsSettings workbench shortcuts", () => {
  it("shows the shortcuts switch on by default", async () => {
    // Given
    stubSettingsFetch({});

    // When
    renderKeybindingsSettings();

    // Then
    expect(await findWorkbenchShortcutsSwitch()).toBeChecked();
  });

  it("shows the shortcuts switch off once it was turned off", async () => {
    // Given
    stubSettingsFetch({ "workbench-chords-enabled": false });

    // When
    renderKeybindingsSettings();

    // Then
    expect(await findWorkbenchShortcutsSwitch()).not.toBeChecked();
  });

  it("saves the switch and confirms when the shortcuts are turned off", async () => {
    // Given
    const fetchMock = stubSettingsFetch({});
    renderKeybindingsSettings();
    const workbenchSwitch = await findWorkbenchShortcutsSwitch();

    // When
    await userEvent.click(workbenchSwitch);

    // Then
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Workbench shortcuts disabled",
      ),
    );
    const putCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PUT",
    );
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({
      key: "workbench-chords-enabled",
      value: false,
    });
  });

  it("lists the direct key combos next to the switch", async () => {
    // Given
    stubSettingsFetch({});

    // When
    renderKeybindingsSettings();

    // Then
    const comboList = await screen.findByRole("list", {
      name: "Workbench key combos",
    });
    expect(within(comboList).getByText("Ctrl+Shift+]")).toBeInTheDocument();
    expect(within(comboList).getByText("Ctrl+Shift+\\")).toBeInTheDocument();
    expect(within(comboList).getAllByRole("listitem")).toHaveLength(6);
  });
});

describe("KeybindingsSettings leader groups", () => {
  it("groups the workbench leader actions under Workbench", async () => {
    // Given
    stubSettingsFetch({});
    renderKeybindingsSettings();
    const workbenchGroup = await screen.findByRole("button", {
      name: /^Workbench\s*23 bindings$/,
    });

    // When
    await userEvent.click(workbenchGroup);

    // Then
    expect(screen.getByText("Toggle context sidebar")).toBeInTheDocument();
  });
});
