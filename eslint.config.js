/**
 * Flat config for ESLint 10. It gates two things and nothing else: the four
 * function ceilings in section 6 of CONTRIBUTING.md, and the dependency
 * direction in section 5 and docs/architecture.md.
 *
 * max-lines is deliberately absent. Section 6 demotes file length to a review
 * guideline because the previous attempt gated it at 300 lines and files got
 * split to satisfy the rule rather than to help a reader. Do not add it back.
 */

import boundaries from 'eslint-plugin-boundaries'
import vue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

const LINTED = ['**/*.ts', '**/*.mts', '**/*.js', '**/*.mjs', '**/*.vue']

export default [
  {
    ignores: [
      // Generated SQL. drizzle-kit writes both the statements and the snapshots
      // it diffs against, per docs/decisions/0006-generated-migrations.md.
      // Named by path because section 6 says an exemption is explicit and never
      // a blanket glob.
      'packages/schema/migrations/*.sql',
      'packages/schema/migrations/meta/*.json',
      // Build output. Nobody edits it and it is not checked in.
      '**/dist/',
    ],
  },

  ...tseslint.configs.recommended,

  // After the TypeScript configs so vue-eslint-parser wins for single file
  // components, with the TypeScript parser handed to it for the script block.
  ...vue.configs['flat/recommended'].map((config) => ({
    ...config,
    files: ['**/*.vue'],
  })),
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },

  {
    files: LINTED,
    rules: {
      'max-lines-per-function': ['error', 50],
      complexity: ['error', 10],
      'max-params': ['error', 4],
      'max-depth': ['error', 4],
      // A leading underscore is how this codebase says "destructured on purpose
      // and not used", which is the readable way to drop a field.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  {
    // A describe block is a container, not a function with logic, and the rule
    // counts it as one. Left on, it reports a 250 line suite as a 250 line
    // function, which is not a finding anybody would act on, and a gate that
    // reports non-problems is one people learn to bypass. The three ceilings
    // that measure real complexity stay on for tests as well.
    files: ['**/*.test.ts', '**/*.test.mts', '**/test-support/**'],
    rules: { 'max-lines-per-function': 'off' },
  },

  {
    // The rule exists so a component name cannot collide with an HTML element.
    // These are the design system's primitives and Card, Button and Pill are
    // what the mockups and the lab call them. Renaming them to HslCard would
    // make every app read worse to satisfy a lint rule.
    files: ['packages/ui/src/components/*.vue'],
    rules: { 'vue/multi-word-component-names': 'off' },
  },

  {
    // Formatting is not this tool's job. These two fire on line breaks inside
    // templates, produce more noise than every real rule here combined, and
    // reviewing them teaches people to skim lint output.
    files: ['**/*.vue'],
    rules: {
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
    },
  },

  {
    files: LINTED,
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'app', pattern: 'apps/*' },
        { type: 'package', pattern: 'packages/*' },
        { type: 'service', pattern: 'services/*' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          // Workspace packages are imported by name, and a bare specifier
          // resolves outside the three trees below, so the element patterns
          // never see it. Checking every origin is what puts "@hsl/api" in
          // front of the last policy.
          checkAllOrigins: true,
          policies: [
            // The one direction that crosses a boundary in this repository.
            // Apps read packages, services read packages, packages read
            // packages.
            { allow: { to: { element: { type: 'package' } } } },

            // Three apps, and none of them is the others' library.
            {
              from: { element: { type: 'app' } },
              disallow: { to: { element: { type: 'app' } } },
            },

            // Nothing imports from a service. An app calls the HTTP API, and
            // the API calls the door service over HTTP, never across the file
            // system.
            { disallow: { to: { element: { type: 'service' } } } },

            // Third party and Node builtin modules are not the architecture's
            // business, except that the two service package names are the ban
            // above wearing a different hat. Both effects share one policy
            // because a disallow stops its own policy's allow, while an allow
            // in any other policy would win over it.
            {
              disallow: {
                to: {
                  module: {
                    origin: 'external',
                    source: ['@hsl/api', '@hsl/door'],
                  },
                },
              },
              allow: [
                { to: { module: { origin: 'external' } } },
                { to: { module: { origin: 'core' } } },
              ],
            },
          ],
        },
      ],
    },
  },
]
