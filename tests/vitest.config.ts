const path = require('node:path')
const { defineConfig } = require('vitest/config')

const root = path.resolve(__dirname, '..')

module.exports = defineConfig({
  root,
  resolve: {
    alias: { '@': path.join(root, 'src') },
  },
  test: {
    environment: 'node',
    // The experimental package uses node:test and runs its own suite.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
