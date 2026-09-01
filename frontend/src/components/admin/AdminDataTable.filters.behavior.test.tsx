// @vitest-environment happy-dom
//
// Header filters on the admin table. What is pinned here:
//  1. a column that declares a filter renders a funnel next to its sort button,
//     and the two stay separate click targets;
//  2. checking an option refetches with that value and writes it to the URL
//     under the endpoint's own param name;
//  3. a filter change resets to page 1 — narrowing while on page 4 otherwise
//     lands on a page the new result set does not have;
//  4. back/forward restores the filter from the URL.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { adminColumnMeta } from "@/components/admin/admin-table-columns";
import type { AdminTableFilters } from "@/components/admin/admin-table-filters";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/encounters"
}));

interface Row {
  id: number;
  status: string;
}

const columns: ColumnDef<Row>[] = [
  {
    accessorKey: "status",
    header: "Status",
    meta: adminColumnMeta<Row>({
      filter: {
        param: "status",
        label: "Filter by status",
        options: [
          { value: "OPEN", label: "Open" },
          { value: "PENDING", label: "Pending" }
        ]
      }
    })
  }
];

const queryFn = vi.fn();
let container: HTMLElement;
let root: Root;

function lastCallFilters(): AdminTableFilters {
  const call = queryFn.mock.calls.at(-1);
  return (call?.[5] ?? {}) as AdminTableFilters;
}

function lastCallPage(): number {
  return queryFn.mock.calls.at(-1)?.[0] as number;
}

async function click(element: Element | null | undefined) {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function render(search = "") {
  window.history.replaceState(null, "", `/admin/encounters${search}`);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <AdminDataTable<Row>
          queryKey={(page, searchValue, pageSize, sortField, sortDir, filters) => [
            "rows",
            page,
            searchValue,
            pageSize,
            sortField,
            sortDir,
            filters
          ]}
          queryFn={queryFn}
          columns={columns}
        />
      </QueryClientProvider>
    );
  });
}

function funnel() {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-label^="Filter by status"]'
  );
}

function option(label: string) {
  return [...document.querySelectorAll('[cmdk-item=""]')].find(
    (item) => item.textContent?.trim() === label
  );
}

beforeEach(() => {
  queryFn.mockReset();
  queryFn.mockResolvedValue({
    results: [{ id: 1, status: "OPEN" }],
    total: 100,
    page: 1,
    per_page: 15
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("AdminDataTable header filters", () => {
  it("renders a funnel beside the column's sort button", async () => {
    await render();
    expect(funnel()).not.toBeNull();
    // The sort control stays its own target rather than swallowing the funnel.
    const sortButton = [...container.querySelectorAll("th button")].find((node) =>
      node.textContent?.includes("Status")
    );
    expect(sortButton).toBeDefined();
    expect(sortButton?.contains(funnel()!)).toBe(false);
  });

  it("refetches with the checked value and puts it in the URL", async () => {
    await render();
    await click(funnel());
    await click(option("Open"));

    expect(lastCallFilters()).toEqual({ status: ["OPEN"] });
    expect(new URLSearchParams(window.location.search).get("status")).toBe("OPEN");
    expect(funnel()?.getAttribute("aria-label")).toBe("Filter by status (1 applied)");
  });

  it("resets to page 1 when a filter changes", async () => {
    await render("?page=4");
    expect(lastCallPage()).toBe(4);

    await click(funnel());
    await click(option("Pending"));

    expect(lastCallPage()).toBe(1);
    expect(new URLSearchParams(window.location.search).get("page")).toBeNull();
  });

  it("restores the filter from the URL on back/forward", async () => {
    await render();
    window.history.replaceState(null, "", "/admin/encounters?status=PENDING");
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(lastCallFilters()).toEqual({ status: ["PENDING"] });
    expect(funnel()?.getAttribute("aria-label")).toBe("Filter by status (1 applied)");
  });

  it("grows the list one batch at a time when paging is infinite", async () => {
    queryFn.mockClear();
    const rows = Array.from({ length: 7 }, (_unused, index) => ({
      id: index + 1,
      status: index % 2 === 0 ? "OPEN" : "PENDING"
    }));
    window.history.replaceState(null, "", "/admin/encounters");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <AdminDataTable<Row>
            rows={rows}
            columns={columns}
            getRowId={(row) => String(row.id)}
            initialPageSize={3}
            paging="infinite"
            rowUnit="encounters"
          />
        </QueryClientProvider>
      );
    });

    expect(container.querySelectorAll("tbody tr").length).toBe(3);
    expect(container.textContent).toContain("Showing 3 of 7 encounters");
    // No page numbers compete with the sentinel.
    expect(container.querySelector("button[aria-label='Next page']")).toBeNull();

    const loadMore = [...container.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("Load more encounters")
    );
    await click(loadMore);
    expect(container.querySelectorAll("tbody tr").length).toBe(6);

    await click(loadMore);
    expect(container.querySelectorAll("tbody tr").length).toBe(7);
    // Everything loaded: the button retires, the count stays.
    expect(container.textContent).toContain("Showing 7 of 7 encounters");
    expect(
      [...container.querySelectorAll("button")].some((node) =>
        node.textContent?.includes("Load more")
      )
    ).toBe(false);
  });

  it("ignores a value the column does not declare", async () => {
    await render("?status=NONSENSE");
    expect(lastCallFilters()).toEqual({});
  });
});
