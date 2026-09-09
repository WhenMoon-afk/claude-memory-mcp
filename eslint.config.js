import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
    },
    rules: {
      complexity: ["error", 20],
    },
  },
];
