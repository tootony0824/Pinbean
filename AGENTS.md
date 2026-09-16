# PinBean Development Guide

## Read First

Before making product or code changes, read:

- `README.md` for workspace structure and launch workflow
- `docs/core-spec/BEAD_CORE_V1.md` for the shared core behavior contract
- `docs/REFACTOR_STATUS.md` and `experience.md` for current migration status and validation caveats

Older planning files can be useful background, but verify current files before relying on line counts, missing-module lists, or unfinished milestone claims.

## Workspace Structure

- `apps/miniapp-uni/` is the active WeChat/H5 client and the current delivery target.
- `apps/web/` is the Next.js web workbench and behavior reference.
- `packages/bead-core/` is the platform-independent TypeScript source of truth for generation, numeric grids, editing transactions, production planning, progress and project serialization.
- `packages/palette-data/` owns supplier palette mapping and stable Color ID APIs.
- `color-palette/` contains original palette source material.
- `docs/` contains live specs, migration records and workflow notes.
- The `v1` branch preserves the retired native WeChat mini program for historical reference; it is not present in the `main` worktree and must not be treated as a live workspace package.

The root is the only active Git repository. `apps/*` and `packages/*` are npm workspaces with one root `package-lock.json`; do not create child lockfiles. The root `project.config.json` points to the uni-app production WeChat build output: `apps/miniapp-uni/dist/build/mp-weixin/`.

## Product Direction

- Keep the core flow stable: import image, generate bead pattern, optionally remove background/edit, export a usable pattern, then support making and publishing.
- Favor a smooth user workflow over adding settings or abstractions that do not improve the actual result.
- New cross-platform business logic belongs in `bead-core`; platform clients should only adapt images, UI events, Canvas rendering, storage, files, clipboard, album and share APIs.

## Cross-Platform Alignment

- `packages/bead-core/` is the source of truth for generation, palette identity, grid semantics, merging, statistics, editing history, project serialization, material planning, 29×29 board planning and production progress.
- Core behavior is defined by `docs/core-spec/BEAD_CORE_V1.md`, unit tests, and approved Golden Fixtures. Do not canonize a Web, uni-app or archived native discrepancy without a product or algorithm decision.
- Core must not depend on Vue, React, Pinia, `wx`, `uni`, DOM, Canvas, Node runtime APIs, or platform file APIs.
- Core cells use a numeric `BeadGrid`: `0 = EMPTY`, `1...N = project palette index`. Palette identity uses stable Color IDs rather than Hex.
- Canvas is a Renderer, never the grid source of truth. Image Adapters may decode files, but deterministic resize and sampling belong in core.
- Every result-affecting parameter belongs in `GenerationConfig`; every result-affecting algorithm change must consider `algorithmVersion` and update fixtures deliberately.

## Main Entry Points

- Active miniapp page: `apps/miniapp-uni/src/pages/index/index.vue`
- Active miniapp store: `apps/miniapp-uni/src/stores/pattern.ts`
- Active miniapp adapters: `apps/miniapp-uni/src/adapters/`
- Web workbench: `apps/web/src/app/page.tsx`
- Web adapters: `apps/web/src/adapters/`
- Shared core public API: `packages/bead-core/src/index.ts`
- Shared palette public API: `packages/palette-data/src/index.ts`
- Shared core V1 spec: `docs/core-spec/BEAD_CORE_V1.md`

## Validation

For shared core changes:

```bash
cd packages/bead-core
npm run check
```

Core algorithm changes must add or update a reproducible test. Golden outputs may only change with an explained product or algorithm decision; do not delete tests or weaken assertions to make a regression pass.

For web changes, run from the repository root:

```bash
npm run dev:web
npm run build:web
npm run test:web
```

Check upload/crop, generation modes, background removal, editing/undo/redo when affected, focus mode, project/CSV compatibility and export.

For miniapp changes, run from the repository root:

```bash
npm run check:uni
npm run build:uni:mp-weixin
```

Open the root workspace in WeChat DevTools after building because `project.config.json` points to the uni-app build output. At minimum check generation in both modes, background removal, editing/undo/redo, project restore, material list, board exports and album/share behavior when touched.

## Security And Repository Hygiene

- Never commit `env`, `.env*`, token-bearing Git remotes, local `.claude` settings, `.wrangler` state, build caches, or nested `.git` metadata.
- The legacy VolcEngine credentials are currently invalid, but configuration files containing credentials remain local-only.
- Do not push or publish the monorepo unless explicitly requested. Original app remotes remain only in external Git backups; do not restore independent repositories inside `apps/`.
