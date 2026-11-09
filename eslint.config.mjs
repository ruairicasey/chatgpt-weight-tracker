import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import next from '@next/eslint-plugin-next';

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': next },
    settings: { next: { rootDir: 'apps/web/' } },
    rules: next.configs['core-web-vitals'].rules,
  },
  globalIgnores(['references/**', '**/.next/**', '**/next-env.d.ts', '**/dist/**', 'playwright-report/**', 'test-results/**']),
]);
