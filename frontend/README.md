# Iso City (frontend)

React + TypeScript + Vite app rendering three.js scenes via
[React Three Fiber](https://docs.pmnd.rs/react-three-fiber) and
[drei](https://github.com/pmndrs/drei), with client-side routing via
[React Router](https://reactrouter.com). It is a starting point for an
isometric game.

## Stack

- Vite 8 + React 19 + TypeScript
- three.js, `@react-three/fiber`, `@react-three/drei`
- `react-router` (data router)
- bun as package manager

## Run

```bash
bun install
bun run dev       # dev server with HMR
bun run build     # type-check (tsc -b) + production build
bun run lint      # oxlint
bun run preview   # serve the production build
bun run e2e       # two-player sessions against the real backend (needs Postgres)
```

## Routes

- `/`, `/islands/:islandId?` — the user's islands; each topic stands as a house.
- `/islands/:islandId/houses/:topicId` — one house: one storey per skill of the
  topic's skill tree that is unlocked (the passed ones and the next). Clicking a
  storey starts a session there with the island partner.
- `/islands/:islandId/houses/:topicId/storeys/:storeyId` — practising a storey
  alone; only without a backend (mock mode).
- `/koop/spiel/:gameId` — a session game (`?rolle=expert` to join as expert,
  `?insel=` to lead back to the house afterwards). `/koop` is the lobby for
  games over whole topics.
- `/minigames/…` — the bomb modules on their own.

## Game sessions

With a backend (`VITE_API_URL`) every game runs over the websockets:

- the user channel (`src/api/invites.ts`, `schema/user-channel.md`) for the
  partner's presence and the invite,
- the session socket (`src/api/session.ts`, `schema/session-protocol.md`) for
  the game itself; the server picks the questions of the storey's skill, runs
  the clock and judges every answer.

The bomb of storey *n* has `questionsForStorey(n)` modules (4 on the ground
floor, one more per storey, at most 8; `src/game/sessionRules.ts`). Winning it
passes the storey and unlocks the next one. Without `VITE_API_URL` the app runs
on in-memory mocks (`src/api/mock*.ts`) and a fake user channel.

## End-to-end tests

`bun run e2e` plays full two-player sessions in Chromium against the real
backend and Postgres; see [`e2e/README.md`](e2e/README.md).

## Data & structure

- `src/router.tsx` — route table (`createBrowserRouter`).
- `src/data/houses.ts` — `House` / `Storey` / `Room` / `RoomItem` types plus the
  mock `HOUSES` data and lookup helpers. This is the seam to swap in real data.
- `src/components/SceneCanvas.tsx` — reusable `<Canvas>` with lights, ground and
  `MapControls` (rotation disabled); camera and controls are configurable.
  `grid={false}` hides the ground grid (used by the island), and `panBounds`
  clamps panning to a shape.
- `src/components/city/Island.tsx` — low-poly island: terraced rocky plateau
  and a rough boulder ring. Geometry comes from `src/data/island.ts`.
- `src/components/city/River.tsx` — low-poly lake at the origin of the river,
  plus the river itself, which follows the island edge and cascades down the
  terrace steps into a waterfall falling into the void.
- `src/components/Room.tsx` — generic, customizable room template (size, colors,
  which walls are rendered, items, item selection). Used by both the house front
  view (front wall/ceiling hidden) and the isometric storey view.
- `src/components/Skyscraper.tsx` — clickable city block.
- `src/components/ItemBox.tsx` — generic clickable room item.
- `src/pages/` — `CityPage`, `HousePage`, `StoreyPage`, `NotFoundPage`.

## Adding a new house (static assets)

Each house is a low-poly tower whose facade is textured from a folder of PBR
maps. To add a house, drop its textures in and register it — no changes to the
texture loader are needed, since asset folders are auto-discovered.

1. **Place the textures** in a folder named after the house set:
   `frontend/src/assets/house-<name>/` (the folder **must** start with `house-`,
   e.g. `house-d` or `house-math-tower`). Accepted files, named exactly:
   `albedo.png`, `emissive.png`, `normal.png`, `roughness.png` (`.png`/`.jpg`/
   `.jpeg`/`.webp`; PNG preferred). They are discovered by the glob in
   `src/components/facade/useHouseTextures.ts`, so new folders need no code
   change. If a folder is empty, a procedural texture is generated instead.
   See `HOUSE_TEXTURES.md` for the full map spec and drop-off contract.
2. **Register the design** in `src/data/baseDesigns.ts` (tint, roughness,
   metalness, emissiveIntensity, tiling) and reference it from the house.
3. **Add the house** to `HOUSES` in `src/data/houses.ts` with its
   `facade: { shape, design, textures }`, where `textures` is the folder name
   from step 1 and `shape`/`design` are keys from `src/data/facadeShapes.ts`
   and `src/data/baseDesigns.ts`.
4. **Place it in the city** by adding an entry to `HOUSE_BLOCKS` in
   `src/data/city.ts`; `houseBlockCenter()` then derives the house position and
   the block is cleared of field props.

Static house assets are placed under `frontend/src/assets/`, not `public/`
(they are bundled and resolved by the loader). Reference packs from outside the
app (e.g. downloadable texture drops) should be moved into
`frontend/src/assets/house-<name>/` before wiring them up.

## Next steps for the game

- Replace `HOUSES` with real game item/house data.
- Add item types beyond boxes and richer room customization.
- Consider shadows, a tileset, and richer island terrain.

