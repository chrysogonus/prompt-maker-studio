// eslint-config-next 16 exports native ESLint 9 flat config objects directly.
// No FlatCompat wrapper is needed — it caused circular reference errors when its
// legacy validator tried to serialize the already-flat plugin objects.
import nextConfig from "eslint-config-next/core-web-vitals";
import typescriptEslint from "@typescript-eslint/eslint-plugin";

const eslintConfig = [
  // Next.js core-web-vitals: includes React, React Hooks, @next/next, import,
  // jsx-a11y, and TypeScript rules with proper flat config structure.
  ...nextConfig,
  // Project-specific rule overrides
  {
    plugins: {
      "@typescript-eslint": typescriptEslint,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      "no-var": "error",
    },
  },
];

export default eslintConfig;
