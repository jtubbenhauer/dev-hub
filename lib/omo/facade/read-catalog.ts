import { getCatalog } from "@/lib/omo/adapter/catalog";
import { jsonResponse, type OmoReadContext } from "@/lib/omo/facade/read-types";

export type OmoCatalogRoute =
  | "/command"
  | "/agent"
  | "/config/providers"
  | "/mcp";

export async function readOmoCatalog(
  context: OmoReadContext,
  route: OmoCatalogRoute,
): Promise<Response> {
  const catalog = await getCatalog(
    context.runtime,
    context.workspace.path,
    context.source,
  );
  switch (route) {
    case "/command":
      return jsonResponse(catalog.commands);
    case "/agent":
      return jsonResponse(catalog.agents);
    case "/config/providers":
      return jsonResponse(catalog.providers);
    case "/mcp":
      return jsonResponse(catalog.mcp);
  }
}
