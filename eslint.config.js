import globals from "globals"

const nodeCommands = ["bin/test", "bin/gnome"]

export default [
  {
    ignores: [
      "dist/**",
      "firefox/native-host/debian/build/**",
      "firefox/native-host/debian/tmp/**",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs}", ...nodeCommands],
    rules: {
      "no-const-assign": "error",
      "no-dupe-args": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-fallthrough": "error",
      "no-undef": "error",
      "no-unreachable": "error",
      "no-unsafe-finally": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "valid-typeof": "error",
    },
  },
  {
    files: ["*.js", "omp/**/*.js", "**/*.mjs", ...nodeCommands],
    languageOptions: {
      globals: globals.nodeBuiltin,
    },
  },
  {
    files: ["firefox/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.browser,
        browser: "readonly",
      },
    },
  },
  {
    files: ["firefox/background.js", "firefox/content.js"],
    languageOptions: {
      globals: {
        ompSendContext: "readonly",
      },
    },
  },
  {
    files: ["firefox/context.js"],
    languageOptions: {
      globals: {
        module: "readonly",
      },
    },
  },
  {
    files: ["gnome-shell/*.js", "test/gnome-shell/*.js"],
    languageOptions: {
      globals: {
        ARGV: "readonly",
        console: "readonly",
        global: "readonly",
        print: "readonly",
        TextDecoder: "readonly",
        TextEncoder: "readonly",
      },
    },
  },
]
