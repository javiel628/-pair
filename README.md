# SHADOW PAIR starter

This package is a split frontend/backend starter for your existing SHADOW MD project.

## Important
- The frontend is static and can be deployed to Vercel.
- The backend must run as a persistent Node.js process on a host that supports WebSockets/long-lived processes.
- This uses your existing `src/session.js`; it does not create a second WhatsApp socket implementation.
- Do not run the standalone bot process and pairing backend simultaneously against the same session directory.
- Pair only accounts you own or are authorized to manage. Pairing codes are sensitive.

## Backend integration
1. Copy `backend/server.js` into the root of the SHADOW MD project.
2. Add Express is NOT required; this server uses Node's built-in HTTP module.
3. The backend expects `../src/session.js` relative to the backend folder. If you copy `backend/server.js` to the project root instead, change the require to `./src/session`.
4. Set environment variable `ALLOWED_ORIGIN` to the exact Vercel frontend origin, e.g. `https://shadow-pair.vercel.app`.
5. Set `PORT` if your host requires it.
6. Start it with `node server.js` if copied to the project root.

## Frontend / Vercel
1. Deploy the contents of `frontend/` as a static Vercel project.
2. Edit `frontend/config.js` and set `window.SHADOW_PAIR_API` to the backend's public HTTPS URL.
3. In the backend host, set `ALLOWED_ORIGIN` to the Vercel domain (no trailing slash).

## Important current compatibility check
Your uploaded package declares `@whiskeysockets/baileys` `^7.0.0-rc.9`, while `src/lib/baileys.js` uses CommonJS `require()`. Verify the installed Baileys package supports the current loader before deployment. Do not change the dependency blindly; a compatible version or a planned ESM migration is required.

## Current limitations
- This first integration exposes pairing-code flow only. QR flow is not wired because the existing session manager does not expose QR updates.
- Request status is held in memory. A backend restart clears pending request IDs, but already-paired auth files remain in the session folder.
- This starter has basic origin checks and per-IP rate limiting, not full user authentication. Add stronger abuse controls before public launch.
- Free hosting may sleep or stop the process, so confirm the provider supports persistent background connections before relying on it.
