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
  },
})
