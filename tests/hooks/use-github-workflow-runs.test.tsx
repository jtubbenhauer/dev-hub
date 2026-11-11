import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGitHubWorkflowRuns, useRerunWorkflow } from "@/hooks/use-github";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

interface StubWorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  created_at: string;
}

let workflowRuns: StubWorkflowRun[];

function stubGitHub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      if (url.pathname === "/api/github/repos/acme/web/actions/runs") {
        // GitHub leaves out runs whose status does not match the filter.
        const status = url.searchParams.get("status");
        return Response.json({
          workflow_runs: status
            ? workflowRuns.filter((run) => run.status === status)
            : workflowRuns,
        });
      }
      const rerun = url.pathname.match(
        /^\/api\/github\/repos\/acme\/web\/actions\/runs\/(\d+)\/rerun$/,
      );
      if (rerun && init?.method === "POST") {
        const runId = Number(rerun[1]);
        workflowRuns = workflowRuns.map((run) =>
          run.id === runId
            ? { ...run, status: "queued", conclusion: null }
            : run,
        );
        return Response.json({}, { status: 201 });
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${input}`);
    }),
  );
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function QueryWrapper({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return QueryWrapper;
}

beforeEach(() => {
  workflowRuns = [
    {
      id: 42,
      name: "Deploy preview",
      status: "completed",
      conclusion: "success",
      created_at: "2026-11-04T10:00:00Z",
    },
    {
      id: 41,
      name: "Deploy preview",
      status: "completed",
      conclusion: "success",
      created_at: "2026-11-03T10:00:00Z",
    },
  ];
  stubGitHub();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("re-running a preview deployment", () => {
  it("refreshes the branch's runs so the re-running run stays the one offered", async () => {
    const { result } = renderHook(
      () => ({
        runs: useGitHubWorkflowRuns("acme", "web", "feat-x"),
        rerun: useRerunWorkflow("acme", "web"),
      }),
      { wrapper: createWrapper() },
    );
    await waitFor(() =>
      expect(result.current.runs.data?.workflow_runs[0]).toMatchObject({
        id: 42,
        status: "completed",
      }),
    );

    act(() => result.current.rerun.mutate({ runId: 42 }));

    await waitFor(() =>
      expect(result.current.runs.data?.workflow_runs[0]).toMatchObject({
        id: 42,
        status: "queued",
      }),
    );
  });
});
