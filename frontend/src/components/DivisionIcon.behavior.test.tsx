// @vitest-environment happy-dom
//
// Rank crests are stored as whatever public S3 URL the deployment wrote, and
// the hosts `next/image` accepts come from NEXT_PUBLIC_IMAGE_REMOTE_PATTERNS.
// `next/image` is stubbed here for the same reason as in TeamName's test: the
// optimizer loader rewrites src to /_next/image?url=…, and the test reads the
// stored URL.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({
    unoptimized: _unoptimized,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => (
    // eslint-disable-next-line @next/next/no-img-element -- this IS the next/image stand-in
    <img {...props} alt={props.alt ?? ""} />
  )
}));

import DivisionIcon from "./DivisionIcon";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TIMEWEB_PLATINUM_3 =
  "https://s3.twcstorage.ru/2b45d037-3b22a410-82c3-4ca4-b9f4-e33bceb4c33a/assets/divisions/platinum-3.png";

vi.mock("@/hooks/useCurrentWorkspace", () => ({
  useDivisionGrid: () => ({
    tiers: [
      {
        number: 18,
        name: "Platinum 3",
        slug: "platinum-3",
        sort_order: 17,
        rank_min: 2200,
        rank_max: 2299,
        icon_url: TIMEWEB_PLATINUM_3
      }
    ]
  })
}));

let container: HTMLDivElement;

function render(ui: React.ReactNode) {
  const root = createRoot(container);
  act(() => root.render(ui));
  return () => act(() => root.unmount());
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

describe("DivisionIcon", () => {
  it("paints the stored S3 crest with its division label", () => {
    render(<DivisionIcon division={18} />);

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(TIMEWEB_PLATINUM_3);
    expect(img?.getAttribute("alt")).toBe("Platinum 3");
  });

  it("prefers a tournament grid's icon_url over the workspace default", () => {
    render(
      <DivisionIcon
        division={1}
        tournamentGrid={{
          tiers: [
            {
              number: 1,
              name: "Champion 1",
              slug: "champion-1",
              sort_order: 0,
              rank_min: 4900,
              rank_max: null,
              icon_url: "https://rustfs.craazzzyyfoxx.me/aqt/assets/divisions/champion-1.png"
            }
          ]
        }}
      />
    );

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://rustfs.craazzzyyfoxx.me/aqt/assets/divisions/champion-1.png"
    );
  });
});
