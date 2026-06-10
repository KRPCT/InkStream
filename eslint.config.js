import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'src-tauri/target/', 'src-tauri/gen/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // 项目立约：前端只允许 src/ipc/ 接触 Tauri API
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tauri-apps/*'],
              message: '只允许 src/ipc/ 接触 Tauri API（项目立约）',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/ipc/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // public/ 静态脚本（boot.js 首帧引导）：浏览器全局
    files: ['public/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  prettier,
);
