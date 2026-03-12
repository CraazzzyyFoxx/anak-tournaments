import encounterService from "@/services/encounter.service";
import EncountersTable from "@/components/EncountersTable";

const DEFAULT_PAGE = 1;

type EncountersPageProps = {
  searchParams: Promise<{
    page?: string;
    search?: string;
  }>;
};

type ParsedSearchParams = {
  page: number;
  search: string;
};

function parseSearchParams(params: { page?: string; search?: string }): ParsedSearchParams {
  const parsedPage = Number.parseInt(params.page ?? String(DEFAULT_PAGE), 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : DEFAULT_PAGE;

  return {
    page,
    search: params.search ?? "",
  };
}

async function EncountersContent({ page, search }: ParsedSearchParams) {
  const data = await encounterService.getAll(page, search);

  return <EncountersTable data={data} search={search} InitialPage={page} />;
}

export default async function EncountersPage({ searchParams }: EncountersPageProps) {
  const params = parseSearchParams(await searchParams);

  return <EncountersContent page={params.page} search={params.search} />;
}
