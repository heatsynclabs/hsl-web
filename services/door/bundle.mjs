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
  // This bundle emits no require today. The banner is here so the two service
  // bundle scripts read the same, and so adding a CommonJS dependency does not
  // fail at load time in production.
  banner: {
    js: "import { createRequire as hslCreateRequire } from 'node:module'\nconst require = hslCreateRequire(import.meta.url)",
  },
})
