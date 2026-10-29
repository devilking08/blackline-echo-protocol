# Architecture

## Plain-language view

Your browser runs the whole game. Keyboard, mouse, or touch input updates your character and mission. Three.js draws the city, ordinary HTML draws menus and the HUD, and Web Audio synthesizes sound. Your browser saves checkpoints locally. Vercel or GitHub Pages only sends files; neither runs the game simulation.

## Modules

| Module               | Responsibility                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core.ts`        | Pure mission state, combat resource updates, swept circle/AABB collision, segment visibility, seeded randomness, puzzle logic, and save parsing |
| `src/world.ts`       | Procedural city construction, scenery batching, material caches, rigid geometry merging, actors, pickups, rain, weapon and scene lifecycle      |
| `src/main.ts`        | Application modes, input routing, camera, simulation loop, actor behavior, rendering, interactions, maps, audio coordination and persistence    |
| `src/ui.ts`          | Semantic interface markup and small DOM helpers                                                                                                 |
| `src/style.css`      | Self-hosted typography, cinematic title, HUD, overlays and mobile layouts                                                                       |
| `src/audio.ts`       | Gesture-activated Web Audio synthesizer and ambient oscillators                                                                                 |
| `tests/core.test.ts` | Unit and boundary tests without WebGL                                                                                                           |
| `e2e/*.spec.ts`      | Production-browser scenarios and accessibility checks                                                                                           |

## Data flow

`input → Game.action/updatePlayer → core state updates → HUD + City + Sound → render`.

Inputs only trigger gameplay actions in playing mode. Utility panels pause simulation and release the pointer. Pointer lock, visibility loss, and window blur are treated explicitly. Entering mouse capture suppresses recentering deltas briefly to avoid aim jumps.

## Mission state machine

`contact --talk→ relay --hack→ archive --broadcast/sell→ escape --extract→ complete`.

Wrong-stage events are no-ops. A dead runner cannot advance. Extraction rewards are issued only when moving from escape to complete, so repeated extraction cannot duplicate credits. The unused generic download event has no transition; archive choice is the commit point.

## World coordinates and collision

The ground is XZ; Y is height. Forward at yaw 0 is negative Z. The runner starts at (0,48), Iona at (5,32), relay at (-6,2), archive objective at (0,-58), and extraction at (0,62). The authored district is bounded at approximately X ±62, Z -87..84.

Static walls are axis-aligned rectangles. The runner and chasing guards are circles in XZ. Movement is subdivided into steps shorter than the collision radius, resolving axes separately for wall sliding and tunneling resistance. Cover visibility uses slab intersection of the actor-to-runner segment. This conservative two-dimensional visibility also treats low cover as fully blocking.

Jump changes camera height but not ground collision. Buildings cannot be entered or climbed. Patrol movement is a small local oscillation; chase movement uses circle collision but no pathfinding.

## Frame loop and render profiles

Animation uses requestAnimationFrame. Delta is bounded at 0.25 seconds, so severe rendering stalls slow the simulation rather than allowing large damage/movement jumps. Hidden tabs pause gameplay and skip rendering. HUD updates are throttled to approximately 10 Hz.

Static boxes share geometry/materials and are rendered in material-grouped InstancedMesh batches. Rigid actor and vehicle components are merged per material. Buildings use explicit repeated window geometry; signage is drawn into local canvas textures. No asset download service or runtime CDN is involved.

Low profile disables bloom, rain, ambient pedestrians and flying traffic, starts at half-resolution, and can reduce resolution to 0.25 pixel ratio under sustained low FPS. Balanced caps pixel ratio at 1, enables restrained bloom; High caps at 1.7 with stronger bloom. Dynamic shadows are not used. Browser software rasterization is supported where WebGL2 is available but is not a performance target.

## Persistence and privacy

A version-1 envelope stores mission/resources, XZ position, and yaw. The parser copies allowed fields and rejects malformed JSON, foreign versions, invalid mission names, non-finite/out-of-range values, invalid counters and impossible coordinate bounds. Local storage access is wrapped in error handling. No cloud sync, personal-data collection, telemetry network calls or authentication exists.

## Build and deployment

Vite compiles TypeScript ES modules and CSS into static dist files. Three.js is separated into a vendor chunk. The approximately 568 KB minified vendor chunk generates an expected Vite size warning; a monolithic renderer chunk is deliberately retained rather than claiming the warning disappeared. Gzipped it is approximately 141 KB in the verified build. There is no SSR or server runtime.

The default build uses root paths for Vercel. GitHub Pages uses a separate build with `vite build --base=/blackline-echo-protocol/`. Do not reuse the Pages build for a root-path Vercel deployment.

## Resource lifecycle

World resources have a dispose traversal; the audio class exposes disposal. The game is one long-lived scene per page, not a route-mounted component. Ordinary page navigation releases it. Context loss displays recovery UI and keeps the last checkpoint; a reload recreates the scene. A hot in-page graphics-context rebuild is not implemented.
