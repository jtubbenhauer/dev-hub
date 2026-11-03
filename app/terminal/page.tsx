import { redirect } from "next/navigation";
import {
  legacyTerminalSearchToHref,
  toUrlSearchParams,
  type SearchParamsRecord,
} from "@/lib/workbench/workbench-href";

export default async function TerminalRedirectPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  redirect(legacyTerminalSearchToHref(toUrlSearchParams(await searchParams)));
}
