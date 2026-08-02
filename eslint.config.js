import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: [
            "dist/",
            "node_modules/"
        ]
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: [
            "src/**/*.ts"
        ],
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
            ]
        }
    },
    {
        files: [
            "public/sw.js"
        ],
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
