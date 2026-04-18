const { defineConfig } = require('eslint/config');
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const prettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = defineConfig(
    {
        ignores: ['dist/', '**/*.d.ts', 'node_modules/', '.yarn/', '.pnp.cjs', '.pnp.loader.mjs', 'vitest.config.ts'],
    },

    js.configs.recommended,
    prettierRecommended,

    {
        files: ['**/*.ts'],
        extends: [tseslint.configs.recommended, tseslint.configs.recommendedTypeChecked, prettierRecommended],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: 'module',
                projectService: true,
                tsconfigRootDir: __dirname,
            },
        },
    }
);
