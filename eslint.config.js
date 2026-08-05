import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/"] },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  reactHooks.configs.flat.recommended,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // TypeScript resolves globals itself; no-undef only produces false
      // positives on typed sources.
      "no-undef": "off",
      // Deliberate fire-and-forget calls are marked with `void`.
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Async handlers on JSX props are idiomatic React and safe here: every
      // api.* call resolves to `{error}` rather than rejecting.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      // Fires on the mount-time data fetch in Content and PlayerControl. Both
      // set state only after awaiting, so the cascading-render concern does not
      // apply; kept visible as a warning rather than silenced outright.
      "react-hooks/set-state-in-effect": "warn",
    },
  },

  // This config file is plain JS and is not part of tsconfig's `include`.
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Must stay last: switches off every rule Prettier already handles.
  prettier,
);
