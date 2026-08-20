import nextConfig from "eslint-config-next/core-web-vitals";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextConfig,
  {
    rules: {
      "react/react-in-jsx-scope": "off",
      // Base rule stays off: it cannot see type-only usage and would
      // double-report against its @typescript-eslint counterpart below.
      "no-unused-vars": "off",
      "react/prop-types": "off",
      "react/no-unknown-property": "off",
      "no-redeclare": "off",
      "react-hooks/exhaustive-deps": "off",
      "no-undef": "off",
    },
  },
  {
    // The @typescript-eslint plugin is registered by eslint-config-next's
    // "next/typescript" block, which is scoped to TS files only. Declaring the
    // rule in a matching scope keeps it resolvable — a global config object
    // would fail to find the plugin when linting .mjs/.js files.
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // "warn", not "error": the existing backlog of unused imports/vars would
      // otherwise fail CI in one step. Surface it first, ratchet to error later.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          // Leading underscore is the intentional "declared but unused" marker,
          // needed for positional params and destructuring holes.
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
        },
      ],
    },
  },
];
