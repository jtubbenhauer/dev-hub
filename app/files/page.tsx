import { redirect } from "next/navigation";
import {
  legacyFilesSearchToHref,
  toUrlSearchParams,
  type SearchParamsRecord,
} from "@/lib/workbench/workbench-href";

export default async function FilesRedirectPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  redirect(legacyFilesSearchToHref(toUrlSearchParams(await searchParams)));
}
