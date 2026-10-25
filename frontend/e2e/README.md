# End-to-end tests

`session.spec.ts` plays storey sessions between two island partners, each in
their own browser context, against the real backend: presence and the invite go
over `/api/users/ws`, the game over `/api/sessions/ws`.

- Winning the ground floor unlocks the next storey, which gets a bigger bomb.
- Three wrong answers blow up the bomb; the storey stays the top one.
- A reloaded page resumes the running game.
- A declined invite ends the waiting game.

Every test seeds fresh users, an island and a house with three storeys
(`seed.ts`: users and island through the API, topics, skills and tasks straight
into Postgres, as Akasha would write them). Nothing is cleaned up and no reset
is needed, so the tests can run against the dev database.

The bomb is drawn with three.js, so the defuser's page answers through
`window.__bomb` (`src/game/e2eHook.ts`), which only exists in `VITE_E2E=true`
builds and sends the same `submit_answer` a click on the bomb would. The expert
side leafs through the real manual until it finds the page with a module's
symbols, and reads off the symbol of the right answer.

## Running

Playwright starts the backend (`cargo run -p backend` on `127.0.0.1:18081`) and
Vite (port 5179, `VITE_E2E=true`) unless they already run. Only Postgres must be
up, e.g. `nix run .#dev` or any server with an existing database:

```bash
cd frontend
bun run e2e                                         # DATABASE_URL from the dev shell
E2E_DATABASE_URL=postgres://postgres@localhost:5433/upload bun run e2e
```

On NixOS, Playwright's downloaded browsers do not start; use a system Chromium:

```bash
E2E_CHROMIUM=$(readlink -f "$(which chromium)") bun run e2e
```

Elsewhere, `bunx playwright install chromium` once. CI does not run these tests;
run them locally before changing the session flow.
