// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // Les handlers Discord attachent des promesses à des events void — le
      // pattern `void promise` est la façon assumée de le dire.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
    },
  },
  { ignores: ['dist/', 'eslint.config.js'] },
);
