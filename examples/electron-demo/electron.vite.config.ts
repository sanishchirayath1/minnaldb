import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// electron-vite handles the three-process build (main / preload / renderer)
// with sane defaults. We only customise:
//   • externalize all node deps in main (so better-sqlite3's native binary
//     stays as a require() instead of being bundled)
//   • use React for the renderer
//   • output to ./out (electron-vite's default)
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // Emit ESM (.mjs) so we can `import` minnaldb (which is ESM-only).
      // Modern Electron (28+) supports ESM in the main process.
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        output: { format: 'es', entryFileNames: '[name].mjs' },
      },
    },
  },
  preload: {
    // Don't use externalizeDepsPlugin here: we WANT minnaldb-electron bundled
    // into the preload, so it doesn't require() an ESM module at runtime
    // (preload is CJS, minnaldb-electron is ESM). Only `electron` itself is
    // a built-in that must remain external.
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        external: ['electron'],
        // Force CJS .cjs because Electron's preload runtime is CJS-only as of
        // Electron 33, even when the surrounding package.json is "type":"module".
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react()],
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
})
