// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'packages/shared/src/generated/**',
      'mobile/.expo/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['web/**/*.{ts,tsx}', 'mobile/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // R1.11: en móvil los tokens y datos sensibles solo se guardan en expo-secure-store.
    files: ['mobile/**/*.{ts,tsx,js}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@react-native-async-storage/async-storage',
              message:
                'Prohibido AsyncStorage (R1.11): usa src/api/secureStorage.ts (expo-secure-store).',
            },
            {
              name: 'react-native',
              importNames: ['AsyncStorage'],
              message:
                'Prohibido AsyncStorage (R1.11): usa src/api/secureStorage.ts (expo-secure-store).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['mobile/*.config.js', 'mobile/jest.setup.ts'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'writable', __dirname: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    rules: {
      // Dinero: prohibido parsear montos con punto flotante (NFR-2).
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: 'No uses parseFloat: los montos se manejan como centavos enteros.',
        },
        {
          selector:
            "CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']",
          message: 'No uses Number.parseFloat: los montos se manejan como centavos enteros.',
        },
        {
          selector: "CallExpression[callee.property.name='toFixed']",
          message: 'No uses toFixed para dinero: redondea en punto flotante.',
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
);
