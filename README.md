# Moddable KIT

A personal collection of libraries for [Moddable](https://www.moddable.com/) (the XS
JavaScript engine for microcontrollers), written in TypeScript.

Moddable has no npm at build time. Each library here is just a folder with a `manifest.json`;
you pull it into your app through your own manifest's `include` array. Any `npm install` in
this repo is **dev tooling only** (TypeScript, types, prettier) — never used to build firmware.

## Hardware compatibility

- ✅ **Tested on ESP8266.** This is the only board these libraries have actually been run on.
- 🤷 **Should work on ESP32** — the code targets the standard Moddable/XS APIs, so it's
  *expected* to be compatible. But it hasn't been tested there, so no promises. Who knows :D
- Other Moddable targets (nRF52, Pico, etc.) are unexplored — try at your own risk.

If you run any of these on other hardware, PRs/notes on what worked are welcome.

## Layout

One repo, many self-contained libraries. Each lib is a folder with its own `manifest.json`
and `src/`. A top-level `manifest.json` re-includes every library, so consumers can pull in
**one** lib or **all** of them.

```
moddable-kit/
├── manifest.json        # includes every library below
├── express/             # Express-like HTTP server + router
│   ├── manifest.json
│   └── src/
└── …                    # more libs land here over time
```

The repo name and the **import prefixes are independent** — you import `express`,
`express/router`, etc., not `moddable-kit/express`. Prefixes are kept short and stable.

## Libraries

| Import prefix          | Folder                 | What it is                                              |
|------------------------|------------------------|---------------------------------------------------------|
| `express`              | [`express`](./express) | A tiny Express-like HTTP server + router for MCUs.      |

More to come — this repo is where they'll collect.

## Using it in a project

### 1. Point an env var at the kit (recommended)

Clone the repo once, then export `KIT` so every app can reference it without relative
paths — the same pattern Moddable uses for its own `$(MODDABLE)`:

```sh
git clone https://github.com/n1md7/moddable-kit ~/moddable-kit
export KIT=~/moddable-kit        # add to your shell profile to persist
```

### 2. Link it from your app's manifest

Pull in a **single** library:

```jsonc
// your-app/manifest.json
{
  "include": [
    "$(MODDABLE)/examples/manifest_base.json",
    "$(MODDABLE)/examples/manifest_net.json",   // e.g. express needs the http server module
    "$(KIT)/express/manifest.json"              // <-- just this one library
  ],
  "preload": [
    "express", "express/router", "express/assertion",
    "express/extension", "express/utils"
  ]
}
```

…or pull in **everything** via the top-level manifest:

```jsonc
{
  "include": [
    "$(MODDABLE)/examples/manifest_base.json",
    "$(MODDABLE)/examples/manifest_net.json",
    "$(KIT)/manifest.json"                      // <-- the whole kit
  ]
}
```

> Prefer a pinned checkout? Vendor the repo (submodule/copy) and use a relative path instead
> of the env var — e.g. `"../moddable-kit/express/manifest.json"`. Paths in `include` resolve
> relative to the including manifest.

### 3. Point TypeScript at the source

The manifest handles the build; `tsc`/your editor need a parallel `paths` entry:

```jsonc
// your-app/tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "express": ["../moddable-kit/express/src/express.ts"],
      "express/*": ["../moddable-kit/express/src/*"]
    }
  },
  "include": [
    "src/**/*",
    "../moddable-kit/express/src/**/*",
    "node_modules/@moddable/typings/**/*.d.ts"
  ]
}
```

Each library's own README has the exact manifest, `preload`, and `tsconfig` snippets for that
lib — see [`express/README.md`](./express/README.md).

## Development

```sh
cd <library>       # e.g. cd express
npm install        # dev tooling only (tsc, types, prettier)
npm run typecheck
```

## License

ISC
