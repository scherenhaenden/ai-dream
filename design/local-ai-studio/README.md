# Local AI Studio design prototype

This directory contains a standalone React/Vite visual prototype for AI Dream. It is a design reference, not the production application: the shipped application is the Angular app in [`../../web`](../../web). The prototype does not connect to the local API, execute model operations, or persist changes. Counts, model cards, logs, connection states, dialogs, and action outcomes shown here are illustrative unless a screen explicitly says otherwise.

## Run locally

Prerequisites: Node.js and npm.

```sh
npm install
npm run dev
```

Vite prints the local URL. To create a static preview build, run `npm run build`, then `npm run preview`. No API key, cloud account, or environment file is required.

## Product parity

See [`PARITY.md`](./PARITY.md) for the screen-to-route mapping, current Angular capabilities, and prototype-only gaps. Keep that map aligned with `web/src/app/app.routes.ts` when either application changes.

See [`UNIT-COVERAGE.md`](./UNIT-COVERAGE.md) for the atomic 13-Unit check inventory. It distinguishes route presence from interaction coverage and does not infer 100% readiness from navigation alone.

## Readiness and QA boundary

The parity map and token/contrast calculations are source-level evidence; they do not by themselves establish visual, accessibility, or behavioral approval. The current partial browser and keyboard results, along with the remaining screen-reader and viewport checks, are recorded in [`ACCESSIBILITY-AUDIT.md`](./ACCESSIBILITY-AUDIT.md). Before calling the reference UX-ready, check each screen at compact, tablet, and desktop widths; confirm there is no clipped content or horizontal overflow; inspect visible focus and disabled states; and verify rendered foreground/background pairs, including alpha overlays. Record browser, viewport sizes, and exceptions alongside the readiness score.
