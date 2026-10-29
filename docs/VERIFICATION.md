# Verification report

## Executed evidence

- Core suite: **17/17 passed**, Vitest.
- TypeScript: strict no-emit check passed.
- Production bundler: Vite build succeeded.
- Browser suite: **13/13 passed**, Chromium via Playwright, no skips, no flaky tests, no unexpected failures.
- Browser suite duration: **358.5 seconds**. Execution start: 2026-10-29T18:11:22.996Z.
- Production dependency audit: **0 reported vulnerabilities** from `npm audit --omit=dev` at verification time.
- Release screenshot sessions: title High, gameplay/dialogue/puzzle Balanced, mobile portrait; no uncaught browser errors in those capture sessions.

Machine-readable browser results: [browser-results.json](verification/browser-results.json). The JSON includes test sources and paths from the test environment; those paths are evidence, not required runtime locations.

## Browser coverage

- menu, settings and manual have no serious WCAG 2 AA violations
- boots offline-ready assets, renders city, and has no browser errors
- start preserves level aim, movement works, and pause freezes simulation
- fires, reloads, scanner toggles, journal and map are accessible
- contact dialogue advances and persists its checkpoint
- relay puzzle rejects a wrong node and unlocks archive
- archive offers broadcast ending and extraction pays once
- archive offers sell ending and extraction pays once
- quickhack stuns a target and headshots neutralize real geometry
- settings persist, keyboard focus is trapped, and saves survive reload
- corrupt save is ignored and disabled storage is survivable
- complete mission is reachable with actual locomotion, no teleports
- portrait touch layout has usable controls without horizontal overflow

The full-route scenario uses keyboard locomotion between all objective locations; no mid-run teleporting is used. Separate checkpoint-fixture scenarios isolate branches and validate save parsing. Menu/settings/manual accessibility checks use axe WCAG 2/2.1 A/AA tags and reject serious or critical violations. They are not a comprehensive guarantee of accessibility for first-person 3D combat.

## Test environment and interpretation

Tests run a built `dist` through Vite preview, not the development server. Chromium uses ANGLE SwiftShader with unsafe-software-rendering enabled for the isolated test process. Default browser-test viewport is 960×640; touch scenario is 390×844. The full route runs with story assist and Low rendering to isolate functionality on a software rasterizer.

Only Chromium was executed. Firefox, Safari and real mobile hardware were not tested. Test success is not a universal frame-rate guarantee. Displayed FPS is smoothed, can be skewed during boot, and is diagnostic rather than a rigorous benchmark. No GPU-less AAA quality claim is made.

The renderer vendor chunk produces a Vite >500 KB warning (about 568 KB minified / 141 KB gzip); this is documented rather than hidden. No production errors accompanied the warning.

## Reproduction

```sh
npm ci
npm run check
npx playwright install --with-deps chromium
npm run test:e2e
npm audit --omit=dev
```

## Limits not covered by automated tests

Long-duration soak testing, physical mobile devices, cross-browser validation, gamepad input, constrained-memory hardware, anti-cheat, and multiplayer are not covered. There is no multiplayer implementation. Performance should be measured on deployment target devices before broad release.
