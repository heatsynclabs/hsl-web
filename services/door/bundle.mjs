import { build } from 'esbuild'

/**
 * Bundles the service to one self-contained file in dist/, so the runtime image
 * is Node and that file. See
 * docs/decisions/0013-services-ship-as-a-bundle.md.
 */
await build({
  entryPoints: ['src/main.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  // Several transitive packages are CommonJS and call require() as they load.
  // An ESM bundle has no require, so one is made here.
  banner: {
    js: "import { createRequire as hslCreateRequire } from 'node:module'\nconst require = hslCreateRequire(import.meta.url)",
  },
})
