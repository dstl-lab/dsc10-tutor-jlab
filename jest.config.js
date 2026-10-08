const jestJupyterLab = require('@jupyterlab/testutils/lib/jest-config');

const esModules = [
  '@codemirror',
  '@marijn',
  '@microsoft',
  '@jupyter/react-components',
  '@jupyter/web-components',
  '@jupyter/ydoc',
  '@jupyterlab/',
  'color',
  'exenv-es6',
  'lib0',
  'marked',
  'nanoid',
  'vscode-ws-jsonrpc',
  'y-protocols',
  'y-websocket',
  'yjs'
].join('|');

const baseConfig = jestJupyterLab(__dirname);

module.exports = {
  ...baseConfig,
  automock: false,
  moduleNameMapper: {
    ...baseConfig.moduleNameMapper,
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  modulePathIgnorePatterns: [
    ...(baseConfig.modulePathIgnorePatterns ?? []),
    '<rootDir>/.venv/',
    '<rootDir>/dsc10_tutor_jlab_backend/labextension/'
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/.ipynb_checkpoints/*'
  ],
  coverageReporters: ['lcov', 'text'],
  testRegex: 'src/.*/.*.spec.ts[x]?$',
  transformIgnorePatterns: [`/node_modules/(?!${esModules}).+`]
};
