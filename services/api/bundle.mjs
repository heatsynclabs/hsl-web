import { build } from 'esbuild'

/**
 * Bundles each entry point to one self-contained file in dist/, so the runtime
 * image is Node and these four files. See
 * docs/decisions/0013-services-ship-as-a-bundle.md.
 *
 * These four are what anything actually starts: the Dockerfile's CMD, the
 * migrate container in compose.yaml, and the two Makefile targets.
 */
const ENTRY_POINTS = [
  'src/main.ts',
  'src/migrate.ts',
  'src/seed.ts',
  'src/make-admin.ts',
]

await build({
  entryPoints: ENTRY_POINTS,
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  // nodemailer and pg are CommonJS and call require() as they load. Every
  // require left in the emitted bundle comes from one of them, fifty from
  // nodemailer and twenty-five from pg and its helpers, and each resolves to a
  // Node builtin. An ESM bundle has no require, so one is made here.
  banner: {
    js: "import { createRequire as hslCreateRequire } from 'node:module'\nconst require = hslCreateRequire(import.meta.url)",
  },
})
