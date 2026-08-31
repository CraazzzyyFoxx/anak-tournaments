// The trigger label must name the SAME days the calendar highlights and the
// same ISO strings the form holds. It did not: next-intl resolves its default
// zone on the server (UTC in the container) and `NextIntlClientProvider`
// inherits it, so formatting the picker's local-midnight Dates through that
// formatter printed the previous day for every viewer east of UTC — the
// tournament settings calendar highlighted 12-13 Sep under a label reading
// "11 сент. - 12 сент.".
process.env.TZ = "Europe/Moscow";

import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DateRangePicker } from "./date-range-picker";

/** Deployment zone the provider carries in production, not the viewer's. */
const DEPLOYMENT_ZONE = "UTC";

function render(startDate?: string, endDate?: string): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={{}} timeZone={DEPLOYMENT_ZONE}>
      <DateRangePicker startDate={startDate} endDate={endDate} onChange={() => {}} />
    </NextIntlClientProvider>
  );
}

describe("DateRangePicker", () => {
  it("runs in a zone east of the deployment's, where the bug was visible", () => {
    // Guards the premise: with TZ === UTC the regression cannot reproduce and
    // the assertions below would pass on the broken code too.
    expect(new Date("2026-09-12T00:00:00").getTimezoneOffset()).toBe(-180);
  });

  it("labels the days it was given, not the day before", () => {
    expect(render("2026-09-12", "2026-09-13")).toContain("Sep 12, 2026 - Sep 13, 2026");
  });

  it("labels a lone start date without shifting it", () => {
    const markup = render("2026-01-01");
    expect(markup).toContain("Jan 01, 2026");
    expect(markup).not.toContain("Dec 31, 2025");
  });
});
