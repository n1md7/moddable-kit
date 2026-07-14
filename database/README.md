# moddable-database

Persistent storage helpers for [Moddable](https://www.moddable.com/) (XS), written in
TypeScript. Two layers, both backed by the built-in `Preference` module (SPI flash):

- **`Storage`** — a typed wrapper around a single `Preference` key (get/set/delete/default).
- **`Entity`** — a very small, TypeORM/Sequelize-*flavoured* wrapper: a typed collection of
  records with an autoincrement `id`, defaults, and simple CRUD. **No relationships, no query
  language** — just typed get/find/insert/update/delete over one flat collection.

Moddable has no npm. A library here is just a folder with a `manifest.json`; consumers pull it
in through their own manifest's `include` array. `npm install` in this repo is **dev tooling
only** (TypeScript + types for editor/typecheck) — it is never used at build time.

> ⚠️ **Flash wear.** `Preference` lives in SPI flash, which has a limited number of erase
> cycles. Both layers are for **config-sized, rarely-written data** (settings, a handful of
> records) — not high-frequency writes. Updating on every tick/sensor read will wear out the
> chip. See the note in [`src/storage.ts`](./src/storage.ts).

## Modules

| Import specifier    | What it is                                            |
|---------------------|-------------------------------------------------------|
| `database/storage`  | `Storage<T>` — one typed `Preference` key             |
| `database/entity`   | `Entity` + `FieldDef`, `Schema`, `Row`, `Insert` types|

## Quick start

```ts
import { Entity } from "database/entity";

const users = new Entity({
  name: "users",
  fields: {
    name:   { type: "string", required: true },
    age:    { type: "number", default: 0 },
    active: { type: "boolean", default: true },
  },
});

const alice = users.insert({ name: "Alice" });   // { id: 1, name: "Alice", age: 0, active: true }
users.insert({ name: "Bob", age: 42 });          // { id: 2, name: "Bob", age: 42, active: true }

users.findById(1);                                // { id: 1, ... } | undefined
users.find((u) => u.age >= 18);                   // Row[]
users.update(1, { age: 31 });                     // merged Row | undefined
users.delete(2);                                  // void
users.all();                                       // every Row
```

## `Storage<T>`

A single persisted value. `T` is `string | number | boolean | ArrayBuffer`. The default (if
given) is written **once**, on first use — a device restart won't overwrite a stored value
with the default.

```ts
import { Storage } from "database/storage";

const brightness = new Storage<number>("display", "brightness", 128);

brightness.getValue();       // 128 (or the stored value)
brightness.hasValue();       // true
brightness.setValue(200);    // 200  (returns the value it set)
brightness.deleteValue();    // removes it from flash
```

| Method          | Purpose                                                        |
|-----------------|----------------------------------------------------------------|
| `getValue()`    | Read the value (`undefined` if unset).                         |
| `hasValue()`    | Whether a value is stored.                                     |
| `setValue(v)`   | Write `v` and return it. **A flash write — use sparingly.**    |
| `deleteValue()` | Remove the value. Also a flash write.                          |

> `domain` and `name` are each capped at **32 characters** (throws otherwise).

## `Entity`

### Defining fields

```ts
const devices = new Entity({
  name: "devices",                 // Preference domain, max 32 chars
  fields: {
    label:  { type: "string", required: true },
    pin:    { type: "number", required: true },
    on:     { type: "boolean", default: false },
    note:   { type: "string" },    // optional, no default → may be absent
  },
});
```

Each field is a `FieldDef`:

| Key        | Type                              | Purpose                                            |
|------------|-----------------------------------|----------------------------------------------------|
| `type`     | `"string" \| "number" \| "boolean"` | The value type. Validated at runtime on write.   |
| `required` | `boolean` (default `false`)       | Must be supplied on `insert` (unless `default` set). |
| `default`  | value matching `type`, **or a function returning it** | Used when the field is omitted on `insert`. |

A `default` may be a constant **or a callback evaluated on each `insert`** — handy for
dynamic values:

```ts
const events = new Entity({
  name: "events",
  fields: {
    kind:      { type: "string", required: true },
    createdAt: { type: "number", default: () => Date.now() },  // fresh timestamp per insert
    seq:       { type: "number", default: () => counter++ },
  },
});
```

> Field types are `string | number | boolean`, so store a timestamp as a number
> (`Date.now()`) rather than a `Date` object — see [Limitations](#limitations).

Every record also gets an implicit **`id: number`** — autoincrement, starting at `1`.

The record shape is inferred from the schema, so `insert`, `find`, and `update` are fully
typed: required-without-default fields are mandatory on `insert`, everything else is optional.

### Methods

| Method                    | Returns                | Notes                                             |
|---------------------------|------------------------|---------------------------------------------------|
| `insert(input)`           | `Row`                  | Applies defaults, validates, assigns `id`. 1 write.|
| `findById(id)`            | `Row \| undefined`     | Read one by id.                                    |
| `find(predicate?)`        | `Row[]`                | All records, optionally filtered.                  |
| `findOne(predicate)`      | `Row \| undefined`     | First match (stops early).                         |
| `all()`                   | `Row[]`                | Every record.                                      |
| `count()`                 | `number`               | Number of records (no parsing).                    |
| `update(id, patch)`       | `Row \| undefined`     | Merge `patch` into a record. 1 write. `id` is kept.|
| `delete(id)`              | `void`                 | Remove one. Safe for a missing id.                 |
| `clear()`                 | `void`                 | Remove all records and reset the id counter.       |

```ts
import { assertNumber } from "express/assertion";   // e.g. inside an express handler

const create = (ctx) => {
  assertNumber(ctx.body.pin, "pin must be a number");
  const device = devices.insert({ label: ctx.body.label, pin: ctx.body.pin });
  return ctx.apiSend(201, device);
};
```

### How records are stored

Each record is **one `Preference` entry**: `domain` = the entity `name`, `key` = the
stringified `id`, value = the record as JSON. Records are enumerated with
`Preference.keys(domain)`; only integer keys count as records, so the autoincrement counter
(stored under the reserved key `seq`) is skipped.

This means an `insert`/`update` rewrites **a single entry**, not the whole collection — which
keeps flash writes small. The trade-offs:

- **Every record must fit in one `Preference` value.** Keep records small; this is for
  config-sized data, not blobs.
- **Ids are not reused.** Deleting `#2` of `1, 2, 3` leaves `1, 3`; the counter keeps
  climbing. `clear()` resets it.
- **`find`/`all` read and `JSON.parse` every record** — fine for a few dozen, not thousands.

## Using it in a project

<details open>
<summary>1. Link the manifest</summary>

Paths in `include` resolve relative to the including manifest. This library needs the
Moddable `Preference` module, which `manifest_base.json` already provides.

```jsonc
// your-app/manifest.json
{
  "include": [
    "$(MODDABLE)/examples/manifest_base.json",
    "$(KIT)/database/manifest.json"             // <-- this library
  ],
  "preload": [
    "database/storage",
    "database/entity"
  ]
}
```

`$(KIT)` is the env var pointing at your `moddable-kit` checkout (see the
[repo README](../README.md)). A relative or vendored path works too.
</details>

<details>
<summary>2. Point TypeScript at the source</summary>

The manifest handles the build; `tsc`/your editor need a parallel `paths` entry. Both this
library and the consumer need `@moddable/typings` for the ambient `Preference` global.

```jsonc
// your-app/tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "database/storage": ["../database/src/storage.ts"],
      "database/*": ["../database/src/*"]
    }
  },
  "include": [
    "src/**/*",
    "../database/src/**/*",
    "node_modules/@moddable/typings/**/*.d.ts"
  ]
}
```

</details>

## Development

```sh
npm install        # dev tooling only (tsc, types, prettier)
npm run typecheck
```

## Limitations

An `Entity` is a convenience layer over a flat key/value store, **not** a database.

- **No relationships, joins, or foreign keys.** One entity = one flat collection.
- **No query language / indexes.** `find` linearly scans and parses every record in JS.
- **Field types are `string | number | boolean` only** — no nested objects, arrays, or dates.
  (Store them yourself as JSON strings / epoch numbers if you must.)
- **No transactions or concurrency control** — writes are individual `Preference` operations.
- **No migrations.** Changing a schema doesn't touch already-stored records; old records keep
  their old shape until rewritten.
- **Flash-bound**, per the wear warning above — for settings and small record sets, not
  frequently-mutated or large data.
