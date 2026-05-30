"use strict";

const globals = require("globals");

module.exports = [
  { ignores: ["node_modules/**", "web-ext-artifacts/**", "coverage/**"] },

  // Extension scripts run in the browser / WebExtensions environment.
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: { ...globals.browser, ...globals.webextensions },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error",
    },
  },

  // The shared color module also exports under CommonJS for the unit tests.
  {
    files: ["**/color.js"],
    languageOptions: { globals: { module: "readonly" } },
  },

  // Node tooling / tests.
  {
    files: ["*.config.js", "**/*.cjs", "**/*.test.js", "**/test/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },
];
