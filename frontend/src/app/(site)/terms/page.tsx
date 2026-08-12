import { getTranslations } from "next-intl/server";

import { LegalDocument, type LegalSection } from "@/components/LegalDocument";
import { SITE_NAME } from "@/config/site";

// Order mirrors the reading order of `legal.terms.sections` in the message
// dictionaries (en.json / ru.json) — insertion order there doesn't drive
// render order, so it's spelled out explicitly here.
const SECTION_KEYS = [
  "acceptance",
  "service",
  "eligibility",
  "accounts",
  "workspaces",
  "conduct",
  "content",
  "prohibited",
  "suspension",
  "thirdParty",
  "liability",
  "changes",
  "contact"
] as const;

export default async function TermsPage() {
  const t = await getTranslations();

  const sections: LegalSection[] = SECTION_KEYS.map((key) => ({
    key,
    title: t(`legal.terms.sections.${key}.title` as never),
    body: t(`legal.terms.sections.${key}.body` as never, { siteName: SITE_NAME } as never)
  }));

  return (
    <LegalDocument
      title={t("legal.terms.title")}
      intro={t("legal.terms.intro", { siteName: SITE_NAME })}
      sections={sections}
    />
  );
}
