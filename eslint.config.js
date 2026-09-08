import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `android/` is a generated native project — Capacitor's own `native-bridge.js`
  // lands in its build output and would otherwise add errors nobody can fix.
  globalIgnores(['dist', 'dist-shell', 'android']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // The codebase already marks a deliberately-discarded binding by prefixing
      // it with "_" — destructuring a field out of an object precisely so it is
      // NOT forwarded (`const { supplier: _s, ...rest } = body`), or an unused
      // handler argument. Teach the rule that convention instead of rewriting
      // ten call sites to work around it.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern:         '^_',
        varsIgnorePattern:         '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
    },
  },
])
