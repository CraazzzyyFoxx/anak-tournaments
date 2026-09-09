export type DocLink = {
  href: string;
  title: string;
  keywords: string;
  /** Same-origin but not a Next route (gateway Scalar, static HTML). */
  bypassNext?: boolean;
};

export type DocGroup = {
  label: string;
  items: DocLink[];
};

export const DOC_GROUPS: DocGroup[] = [
  {
    label: "Платформа",
    items: [
      { href: "/docs", title: "Обзор", keywords: "owt платформа воркспейс tenant" },
      { href: "/docs/workspaces", title: "Воркспейсы", keywords: "домен rbac members branding" },
      { href: "/docs/identity", title: "Аккаунты и доступ", keywords: "oauth jwt api key player session" },
    ],
  },
  {
    label: "Турниры",
    items: [
      { href: "/docs/tournaments", title: "Турниры и сетка", keywords: "stage bracket standings phase" },
      { href: "/docs/registration", title: "Регистрация и ростер", keywords: "check-in roster shape sheets" },
      { href: "/docs/matches", title: "Встречи и логи", keywords: "encounter match report veto log" },
      { href: "/docs/balancer", title: "Балансировщик и драфт", keywords: "balancer draft captains" },
      { href: "/docs/realtime", title: "Realtime", keywords: "websocket topic replay" },
    ],
  },
  {
    label: "API",
    items: [
      { href: "/docs/api", title: "HTTP API", keywords: "v1 v2 envelope auth errors openapi" },
      {
        href: "/api/docs",
        title: "Справочник эндпоинтов",
        keywords: "scalar swagger openapi v1 v2",
        bypassNext: true,
      },
    ],
  },
  {
    label: "Для разработчиков",
    items: [
      { href: "/docs/schema", title: "Схема БД", keywords: "erd postgres таблицы alembic" },
    ],
  },
];

export const ARTICLE_SLUGS = [
  "workspaces",
  "identity",
  "tournaments",
  "registration",
  "matches",
  "balancer",
  "realtime",
  "api",
] as const;

export type ArticleSlug = (typeof ARTICLE_SLUGS)[number] | "";

export function isArticleSlug(slug: string): slug is Exclude<ArticleSlug, ""> {
  return (ARTICLE_SLUGS as readonly string[]).includes(slug);
}
