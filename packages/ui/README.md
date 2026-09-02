# @hsl/ui

The GANTRY design system as Vue components. Tokens, the 29 HeatSync marks, and
the fifteen components the three apps are built from. It renders. It does not
fetch, and it holds no business rule.

## The components

| Component | What it is |
|---|---|
| `AppBar` | Top bar of an app: the mark, the app name, and a slot for who is signed in |
| `Avatar` | Initials in an amber square, decorative because the name is always beside it |
| `Button` | A `button`, or an `a` when given `href`. Primary is amber with a block shadow |
| `ButtonRow` | Buttons side by side, sharing the width evenly |
| `Card` | Bordered block on the raised ground, with an eyebrow and a title above the slot |
| `DataTable` | Rows and columns from props, with a plain empty state when there are none |
| `Field` | A label wired to one box by `for` and `id`, plus the error message wiring. `rows` above one makes it a text area |
| `KeyValue` | Two column list of labels and values, where a value may carry pills |
| `Link` | Small uppercase text link in the accent ink |
| `LoginPanel` | Centred mark, title, subtitle and a slot for the sign in form |
| `Mark` | One of the 29 marks, inlined as SVG |
| `Note` | A line of small mono text below a control, for the thing a member needs to know |
| `Pill` | Short uppercase tag. `on` is filled amber, `dim` is tinted, `off` is faded |
| `StatusTile` | One door and its state, sized to be read across the room |
| `ActionRow` | One line of a recent activity list: what happened, and when |

Everything is exported from `src/index.ts`. Nothing outside reaches past it.

## Running it

There is nothing to run on its own. An app imports the tokens once at its entry
point and the components where it needs them.

```ts
import '@hsl/ui/tokens.css'
import { Button, Card, DataTable } from '@hsl/ui'
```

Two things a caller needs to know.

`DataTable` cells are strings. When a cell needs a component instead, name a slot
after the column key:

```vue
<DataTable :columns="columns" :rows="cards" empty-text="No cards yet. Ask an admin.">
  <template #cell-state="{ row }">
    <Pill state="on">{{ row.state }}</Pill>
  </template>
</DataTable>
```

`Field` takes `v-model` and an `error` string. Passing an error sets
`aria-invalid` on the input and points `aria-describedby` at the message, so a
screen reader reads the reason with the field rather than after it. Give it
`:rows` above one and the box is a text area instead, for the fields that hold a
paragraph:

```vue
<Field v-model="skills" label="Skills you have" :rows="4" />
```

## Testing it

```
pnpm --filter @hsl/ui test
pnpm --filter @hsl/ui typecheck
```

The suites render components and assert on the markup a person would notice: a
disabled button carries `disabled` and drops its `href`, a table with no rows
prints its empty text, a field label points at its own input.

Suites that only read markup use `renderToString`, which is faster and says
plainly that nothing is being clicked. Suites that assert on an interaction, such
as typing into a multi-line `Field`, use `mount` under jsdom. See
`docs/decisions/0011-a-dom-for-the-vue-suites.md`.

## What it depends on

`vue` as a peer. `@vitejs/plugin-vue`, `vitest`, `@vue/test-utils`, `jsdom`,
`typescript` and `vue-tsc` to develop with, all pinned in the workspace catalog.
It imports nothing else in this repository.

## Marks

`src/marks.ts` imports all 29 SVGs as raw strings with Vite's `?raw` query and
maps them by file name. `Mark` writes the string into a span. Raw strings rather
than components because the files are exported artwork that nobody edits by hand,
and inlining means a mark never costs a request.

The cost is that all 29 files, 512 KB on disk, land in the bundle whether or not
a mark is used. If that starts to matter, switch `markSources` to a lazy
`import.meta.glob` and make `Mark` async.

Prefer the three variants that carry `fill="currentColor"`, because they take
their colour from the container and stay right when the theme flips:
`hsl-mark-1c-current`, `hsl-mark-current` and `hsl-wordmark-current`. The other
26 are fixed colour and are named for the ground they belong on.

## Tokens

`src/styles/tokens.css` is GANTRY v2.0, from the design system shipping in
`heatsynclabs/new-hsl`. Components read tokens and never write a colour literal.

`--g-plate` was referenced by the mockups and defined nowhere, so this package
defines it in each ground block: `var(--grime)` on page and raised,
`var(--tape-dark)` on plate, and the lighter amber on hazard so text on it stays
readable. It is the recessed surface: table zebra stripes, input boxes, the app
bar.
