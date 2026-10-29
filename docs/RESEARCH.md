# Research and skill provenance

## Work actually performed

The requested repository `vercel-labs/skills` was cloned and `skills/find-skills/SKILL.md` read. The skills CLI was used to discover Three.js skills and install the selected testing/graphics guidance. Additional source repositories were cloned and relevant development/design guidance read. These instructions informed implementation; they are not runtime dependencies, and no claim is made that a different model was invoked or that third-party agents produced this code.

| Source                                      | Read/used for                                        | Examined commit |
| ------------------------------------------- | ---------------------------------------------------- | --------------- |
| https://github.com/vercel-labs/skills       | Discovery and quality-check procedure                | 92a9a34         |
| https://github.com/obra/superpowers         | Test-first and verification-before-completion        | 2ce8aa1         |
| https://github.com/cloudai-x/threejs-skills | Fundamentals, shaders, interaction                   | 0e18186         |
| https://github.com/pbakaus/impeccable       | Interface hierarchy, craft, responsive/visual review | e945845         |

Installed skill records are preserved in `skills-lock.json`. The install-time local skill copies are not bundled into the game. To restore selected guidance, inspect each upstream repository, then use `npx skills add obra/superpowers --skill test-driven-development -y` and `npx skills add cloudai-x/threejs-skills --skill threejs-fundamentals --skill threejs-shaders --skill threejs-interaction -y`.

The supplied `ilabai/3dcodeverse` repository could not be verified: the unauthenticated public repository API returned 404 and the page crawl failed. No dataset assets or license claims from it were used.

In-chat delegated research was attempted but account membership did not permit creating that subtask. Research, implementation and verification were performed directly. No fabricated multi-agent contribution is claimed.

## Engineering references and comparison decisions

This is a focused source-backed reference review, not a claim to have benchmarked hundreds of competitors.

| Reference                                                                               | What was examined                                             | Resulting decision                                                                                         |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)             | Repeated geometry, draw calls, bounding volumes               | Batch repeated static boxes by material and compute bounds                                                 |
| [Three.js PointerLockControls](https://threejs.org/docs/pages/PointerLockControls.html) | Lock/unlock interaction                                       | Use native pointer lock with explicit pause and drag-look fallback                                         |
| [Three.js source/examples](https://github.com/mrdoob/three.js/)                         | General browser rendering/FPS context                         | Keep a small renderer-based game, not a full engine/editor fork                                            |
| [Yuka](https://github.com/Mugen87/yuka)                                                 | Perception, state-driven AI, navigation concepts; MIT         | Implement a smaller inspectable patrol/chase/stun state model; do not pretend it is advanced goal-based AI |
| [PlayCanvas engine](https://github.com/playcanvas/engine)                               | WebGL2/WebGPU browser-engine scope; MIT                       | Use a static lightweight application without editor/server requirements                                    |
| [Babylon.js](https://github.com/BabylonJS/Babylon.js)                                   | Alternative full browser engine                               | Three.js retained for direct procedural scene control; not a comparative performance win                   |
| [three-pathfinding](https://github.com/donmccurdy/three-pathfinding)                    | Navigation-mesh path/clamping approach                        | Defer navmesh routing and disclose simple-chase limitations                                                |
| [Cyberpunk 2077 official site](https://www.cyberpunk.net/us/en/cyberpunk-2077)          | Genre context: first-person action, hacking, narrative choice | Implement original compact equivalents of genre pillars, not its assets, map or story                      |
| [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite)                      | Static build/output and environment behavior                  | Commit Vite framework/output configuration; no backend credentials                                         |
| [Skills directory](https://skills.sh/)                                                  | Discovery                                                     | Select relevant skills rather than installing unrelated token/video/writing packs                          |

No images from those references are used as game assets or screenshots. Release screenshots are actual renders of this codebase.

## Review loops

1. Core tests were executed against implementation stubs first: ten meaningful failures confirmed missing behavior. Weak assertions were strengthened, then the implemented simulation passed all 17 tests.
2. Visual inspection caught foreground skyline geometry occluding the playable corridor; skyline buildings were moved outside district bounds.
3. Browser regression tests exposed pointer-capture aim deltas and software-rendering timing pressure. Pointer suppression, merged rigid geometry, lightweight materials, bounded frame delta, and low-profile adaptive resolution were applied.
4. Browser save fixtures were corrected to seed once rather than overwrite persisted progress and to avoid page-exit saves overwriting test checkpoint edits. All final browser checks passed, including both endings and actual route traversal.

No claim of unlimited crawling, competitor superiority, true AAA visual fidelity, or unperformed hardware benchmarks is made.
