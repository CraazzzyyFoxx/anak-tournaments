import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import messages from "@/i18n/messages/en.json";
import type { DisciplineDescriptor } from "@/types/discipline.types";

import { ContentDisciplineProvider } from "./_components/ContentDiscipline";

export { LOL, OVERWATCH } from "@/test/content-disciplines";

export async function settle(turns = 8) {
  for (let turn = 0; turn < turns; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

export async function click(element: Element | null | undefined) {
  if (!element) throw new Error("click target missing");
  await act(async () => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

export const buttonByText = (label: string) =>
  Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === label);

export function stubMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Renders a content page the way the section layout does: inside the selected game's provider. */
export async function mountContentPage(descriptor: DisciplineDescriptor, page: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <QueryClientProvider client={client}>
          <ContentDisciplineProvider descriptor={descriptor}>{page}</ContentDisciplineProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  await settle();
  return {
    container,
    client,
    unmount: async () => {
      await act(async () => root.unmount());
      client.clear();
      container.remove();
      document.body.innerHTML = "";
    },
  };
}
