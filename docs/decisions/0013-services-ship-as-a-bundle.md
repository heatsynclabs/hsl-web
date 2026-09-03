# 0013. The services ship as a bundle, not as node_modules

Date: 2026-09-02
Status: accepted

## Context

Both service images were built with `pnpm deploy --prod --legacy`, and the API
image measured 475 MB. Inside it, `/app` was 186 MB and almost all of it was
build tooling: typescript 23.6 MB, two rolldown bindings at 33 MB, two esbuild
binaries at 19 MB, two lightningcss binaries at 17 MB, drizzle-kit 9.7 MB, plus
vite, vitest, vue and babel. None of it runs.

`--prod` prunes the deployed package's own devDependencies. It does not prune a
workspace dependency's, and `@hsl/schema` depends on drizzle-kit, typescript and
vitest to develop with. `--legacy` deploy installs the shared workspace
lockfile into the target directory, so the whole workspace's graph arrives.

Two pnpm-shaped fixes were tried and measured. Stripping `devDependencies` from
the workspace manifests before deploying changed nothing, because the legacy
deploy resolves the lockfile rather than the manifests. The non-legacy deploy
does prune, but it refuses to run unless `inject-workspace-packages=true` is set
in the workspace and recorded in the lockfile. Turning that on rewrites the
lockfile, so `pnpm install --frozen-lockfile` in every Dockerfile and in CI
fails until the change is committed, and the setting then applies to every
install anybody runs rather than only to the deploy that wanted it. Reaching for
a workspace-wide install mode to work around one flag on one command is the
wrong size of change for the problem.

## Alternatives

Read from the npm registry and the GitHub API on 2026-09-02.

| Option | Latest | Published | License | npm publishers | Open issues | Why not |
|---|---|---|---|---|---|---|
| esbuild 0.28.2 | 0.28.2 | 2026-08-08 | MIT | 1 | 618 | Chosen. |
| rolldown 1.2.7 | 1.2.7 | 2026-09-02 | MIT | 4 | 403 | The runner up, and better on the maintainer question: Vite 8 already pulls it into this tree and it has four publishers. It lost on age. Its 1.0 is months old, bundling a Node service to one file is not the job it was built for, and this is the step that produces the only production artifact. If it were the finding of a bug rather than a preference, that would flip. |
| rollup 4.63.1 | 4.63.1 | 2026-08-28 | NOASSERTION on GitHub, MIT on npm | 5 | 609 | Needs `@rollup/plugin-node-resolve`, `-commonjs` and `-json` to bundle a Node service at all. Three more dependencies to reach the same file. |

esbuild has one npm publisher account and one author writes almost all of it,
which is what 0009 and 0011 declined a package for. The risk is not the same
here: this produces a build artifact rather than running in production or in
every test, the Dockerfile that calls it keeps working whether or not there is
another release, and swapping it for rolldown is one file.

## Decision

Each service has a `bundle.mjs` that runs esbuild over its own entry points and
writes one self-contained file per entry into `dist/`. The Dockerfiles call
`pnpm bundle` instead of `pnpm deploy`, and the runtime stage copies the bundle
and nothing else. There is no `node_modules` in either runtime image.

Two services means two short scripts, thirty lines and twenty, rather than one
shared one, per section 7: two uses is a coincidence, not an abstraction.

The API bundle is ESM and carries a `createRequire` banner, because nodemailer
and pg are CommonJS and reach for `require` as they load. Every `require` left in
the emitted file comes from one of those two, fifty from nodemailer and
twenty-five from pg and its helpers, and each resolves to a Node builtin. The
door bundle emits none and carries the banner only so the two scripts read the
same.

## Consequence

Easy: the runtime image is Node and one file per entry point. Nothing that is
not reachable from an entry point can ship, so the question of which
devDependency leaked stops existing.

Hard: a stack trace from production points into a bundled file. Source maps are
not emitted, because they would put the source back in the image, which is what
this removes. The line number in the bundle plus the function name is enough to
find the source, and the same commit rebuilds the same bundle.

Also hard: the bundle is built from TypeScript source with types stripped rather
than checked. `pnpm typecheck` is what checks them, and `pnpm check` runs it.

Flip condition: a dependency that cannot be bundled, such as one with a native
addon. `pg` and `bcryptjs` are both pure JavaScript today, which is what makes
this possible.
