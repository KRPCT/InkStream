import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'src-tauri/target/', 'src-tauri/gen/', '.planning/', '.cdp-probe.mjs'] },
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
    // 重构立约（设计 §3.9 / 铁律 2）：view 级破坏性操作（CM6 view.setState / compartment.reconfigure）
    // 只允许 src/editor/ 内的统一冻结门实现调用，组合期排队、compositionend 后执行一次。
    // editor/ 之外裸调即重开 IME 吞字面（撕 IME 锚定的 DocView），故机器强制收口。
    // 注：store.setState（useXxxStore）不在禁列——选择器按 view.setState 精确匹配。
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.name='view'][callee.property.name='setState']",
          message: 'view.setState 只允许经 src/editor/ 统一冻结门（swapState）调用，组合期撕 DocView 必吞字（铁律 2）。',
        },
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='reconfigure']",
          message: 'compartment.reconfigure 只允许经 src/editor/ 门包裹（queueAfterComposition），组合期同步 reconfigure 撕 DocView 吞字。',
        },
      ],
    },
  },
  {
    // editor/ 内是门实现本身：swapState/languages/renderMode 持有 view.setState 与 reconfigure 的唯一合法位。
    files: ['src/editor/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // public/ 静态脚本（boot.js 首帧引导）：浏览器全局
    files: ['public/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  prettier,
);
