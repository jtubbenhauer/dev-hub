import { redirect } from "next/navigation";
import {
  legacyChatSearchToHref,
  toUrlSearchParams,
  type SearchParamsRecord,
} from "@/lib/workbench/workbench-href";

export default async function ChatRedirectPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  redirect(legacyChatSearchToHref(toUrlSearchParams(await searchParams)));
}
