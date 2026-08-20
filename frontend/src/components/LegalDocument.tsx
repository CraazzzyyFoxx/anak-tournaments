import type { ReactNode } from "react";

export type LegalSection = {
  key: string;
  title: string;
  body: string;
};

type LegalDocumentProps = {
  title: string;
  intro: string;
  sections: LegalSection[];
  /** Extra content rendered above the sections (e.g. an effective-date line). */
  children?: ReactNode;
};

/**
 * Shared prose layout for the platform's legal pages (`/terms`, `/privacy`).
 * Both are static, server-rendered translations of the same
 * `{ title, body }[]` section shape, so a single renderer keeps them
 * visually consistent instead of duplicating the article markup twice.
 */
export function LegalDocument({ title, intro, sections, children }: Readonly<LegalDocumentProps>) {
  return (
    <div className="mx-auto max-w-2xl py-16">
      <h1 className="text-balance font-display text-2xl uppercase tracking-wide text-foreground sm:text-3xl">
        {title}
      </h1>
      <p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground">{intro}</p>
      {children}
      <div className="mt-10 space-y-8">
        {sections.map((section) => (
          <section key={section.key}>
            <h2 className="text-base font-semibold text-foreground">{section.title}</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {section.body}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
