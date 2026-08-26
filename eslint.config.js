import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: [".release-candidates/", ".release-components/", ".release-secrets/", "dist/", "desktop/build/", "desktop/dist/", "node_modules/"]
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ["about/theme.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "script",
            globals: {
                ...globals.browser
            }
        }
    },
    {
        files: ["pwa/src/**/*.ts"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                ...globals.browser
            }
        },
        rules: {
            "@typescript-eslint/no-empty-object-type": "off",
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    args: "none",
                    caughtErrors: "none"
                }
            ],
            "no-loss-of-precision": "off",
            "no-empty": [
                "error",
                {
                    allowEmptyCatch: true
                }
            ],
            "lines-between-class-members": ["error", "always", { exceptAfterSingleLine: true }]
        }
    },
    {
        files: ["pwa/vite.config.ts"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                ...globals.node
            }
        },
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    args: "none",
                    caughtErrors: "none"
                }
            ]
        }
    },
    {
        files: ["scripts/**/*.mjs"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                ...globals.node
            }
        }
    },
    {
        files: ["pwa/public/sw.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "script",
            globals: {
                ...globals.serviceworker
            }
        },
        rules: {
            "no-empty": [
                "error",
                {
                    allowEmptyCatch: true
                }
            ]
        }
    }
);
