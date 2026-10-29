import { useQuery } from "@tanstack/react-query";
import type { ProviderAccessOption, WorkspaceProvider } from "@/types";

interface AccessOptionsResponse {
  options?: ProviderAccessOption[];
  error?: string;
}

export function useProviderAccessOptions(
  provider: WorkspaceProvider | undefined,
) {
  const providerId = provider?.id;
  const hasAccessOptions = !!provider?.commands.accessOptions;

  return useQuery<ProviderAccessOption[]>({
    queryKey: ["provider-access-options", providerId],
    queryFn: async () => {
      const response = await fetch(
        `/api/providers/access-options?providerId=${encodeURIComponent(providerId ?? "")}`,
      );
      const body = (await response.json()) as AccessOptionsResponse;
      if (!response.ok) {
        throw new Error(body.error ?? "Could not load access options");
      }
      return body.options ?? [];
    },
    enabled: !!providerId && hasAccessOptions,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
