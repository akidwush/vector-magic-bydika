import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  { ignores: ["src/engine/wasm/**"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
);
