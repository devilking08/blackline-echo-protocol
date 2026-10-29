# Security and privacy

- No secrets are required to build or play. `.env.example` intentionally contains no credentials.
- Do not place GitHub, Vercel, or any other secret into `VITE_*` variables: these are public client-side values.
- The GitHub credential supplied for delivery is not present in source, builds, docs, git remote URLs or archives. Revoke/rotate it after delivery because it was shared in a conversation.
- Runtime assets are self-hosted. No analytics, outbound API calls, microphone, camera, geolocation or remote execution service exists.
- Vercel headers deny objects and framing outside the same origin, apply nosniff/referrer policy, restrict permissions, and provide a same-origin CSP. Inline styles are allowed for DOM-driven HUD updates. No inline script handlers are required.
- GitHub Pages does not honor Vercel's response-header configuration. Do not assume those Vercel headers exist on Pages.
- Saved data is validated on read, but local saves are not authenticated. Players can edit their own resources. There is no competitive/multiplayer economy to protect.
- No user-controlled string is inserted as arbitrary HTML. Generated interface fragments use fixed application content and numeric state. Dialog text and notifications use textContent.
- WebGL context loss and blocked storage degrade to clear recovery messages rather than exposing stack traces to the interface.
- CI requests read-only repository contents. The Pages workflow uses scoped Pages/id-token permissions and a protected GitHub environment.

Report issues through the repository issue tracker. Never include credentials in an issue or screenshot.
