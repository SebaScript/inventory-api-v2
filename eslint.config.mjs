// @ts-check
import eslint from '@eslint/js';
import prettier from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'scripts/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      sourceType: 'commonjs',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // ignoreRestSiblings allows the standard `const { drop, ...keep } = obj`
      // pattern used to omit keys.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: 'error',
    },
  },
  // Seeds and tests legitimately log and use loose typing on JSON payloads.
  { files: ['src/database/**', 'test/**'], rules: { 'no-console': 'off' } },
);
