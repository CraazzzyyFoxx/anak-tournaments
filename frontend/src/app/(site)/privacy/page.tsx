import { getTranslations } from "next-intl/server";

import { LegalDocument, type LegalSection } from "@/components/LegalDocument";
import { SITE_NAME } from "@/config/site";

// Order mirrors the reading order of `legal.privacy.sections` in the message
// dictionaries (en.json / ru.json) — insertion order there doesn't drive
// render order, so it's spelled out explicitly here.
const SECTION_KEYS = [
  "collection",
  "use",
  "cookies",
  "sharing",
  "retention",
  "rights",
  "children",
  "security",
  "changes",
  "contact"
] as const;

export default async function PrivacyPage() {
  const t = await getTranslations();

  const sections: LegalSection[] = SECTION_KEYS.map((key) => ({
    key,
    title: t(`legal.privacy.sections.${key}.title` as never),
    body: t(`legal.privacy.sections.${key}.body` as never, { siteName: SITE_NAME } as never)
  }));

  return (
    <LegalDocument
      title={t("legal.privacy.title")}
      intro={t("legal.privacy.intro", { siteName: SITE_NAME })}
      sections={sections}
    />
  );
}
