// The balance actions speak the reader's language: their words come from the
// message catalogs, not from English literals in the component.
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import en from "@/i18n/messages/en.json";
import ru from "@/i18n/messages/ru.json";

import { BalanceActionsBar } from "./BalanceActionsBar";

const noop = () => {};

function render(messages: typeof en, locale: string, state: { saved?: boolean; exported?: boolean } = {}) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <BalanceActionsBar
        activeVariantStats={null}
        activeVariant={{ payload: {} as never }}
        canRunBalance
        isSavePending={false}
        isExportPending={false}
        isBalanceSaved={state.saved ?? false}
        isBalanceExported={state.exported ?? false}
        canExportRanks
        isExportRanksPending={false}
        onRunBalance={noop}
        onSaveBalance={noop}
        onExportBalance={noop}
        onExportRanks={noop}
        onDownloadJson={noop}
        onCopyNames={noop}
        onScreenshot={noop}
      />
    </NextIntlClientProvider>
  );
}

describe("BalanceActionsBar", () => {
  it("names every action in Russian for a Russian reader", () => {
    const html = render(ru, "ru");
    const actions = ru.balancerTool.actions;

    for (const label of [actions.regenerate, actions.save, actions.export, actions.exportRanks, actions.advanced]) {
      expect(html).toContain(label);
    }
    for (const english of ["Regenerate", ">Save<", "Export to tournament", "Re-export ranks", "Advanced"]) {
      expect(html).not.toContain(english);
    }
  });

  it("says a saved and exported balance is done, and why the button is off", () => {
    const html = render(ru, "ru", { saved: true, exported: true });
    const actions = ru.balancerTool.actions;

    expect(html).toContain(actions.saved);
    expect(html).toContain(actions.exported);
    expect(html).toContain(`title="${actions.savedHint}"`);
    expect(html).toContain(`title="${actions.exportedHint}"`);
  });
});
