import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateMetadata } from "./page";

const NOT_FOUND = "NEXT_NOT_FOUND";
const getBySlug = vi.fn();
const getAll = vi.fn();

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  }
}));
vi.mock("../_components/CommunityPage", () => ({
  CommunityPage: () => null,
  communityMetadata: ({ workspace }: { workspace: { name: string } }) => ({ title: workspace.name })
}));
vi.mock("@/services/workspace.service", () => ({
  default: {
    getBySlug: (...args: unknown[]) => getBySlug(...args),
    getAll: (...args: unknown[]) => getAll(...args)
  }
}));

beforeEach(() => {
  getBySlug.mockReset();
  getAll.mockReset();
});

describe("/workspace/[slug]", () => {
  it("resolves its community with one by-slug read, never the whole workspace list", async () => {
    getBySlug.mockResolvedValue({ id: 1, slug: "owt", name: "OWT" });

    expect(await generateMetadata({ params: Promise.resolve({ slug: "owt" }) })).toEqual({ title: "OWT" });
    expect(getBySlug).toHaveBeenCalledWith("owt");
    expect(getAll).not.toHaveBeenCalled();
  });

  it("is a 404 when the read refuses the viewer (hidden or unverified, not theirs)", async () => {
    getBySlug.mockRejectedValue(new Error("Workspace not found"));

    await expect(generateMetadata({ params: Promise.resolve({ slug: "hidden" }) })).rejects.toThrow(NOT_FOUND);
  });
});
