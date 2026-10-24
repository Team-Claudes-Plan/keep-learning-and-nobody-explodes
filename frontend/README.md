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
```

## Routes

- `/` → redirects to `/city`.
- `/city` — isometric cityscape. Skyscraper blocks stand in for houses;
  clicking one navigates to the house.
- `/houses/:houseId` — 2.5D slightly-angled front view of one house. Each
  storey is a single room; the wall facing the camera is omitted so the storeys
  are visible from outside. Clicking a storey opens that room.
- `/houses/:houseId/storeys/:storeyId` — a single storey in the isometric
  view. Room items are clickable and can be selected/highlighted.
- `*` — not found page.

## Data & structure

- `src/router.tsx` — route table (`createBrowserRouter`).
- `src/data/houses.ts` — `House` / `Storey` / `Room` / `RoomItem` types plus the
  mock `HOUSES` data and lookup helpers. This is the seam to swap in real data.
- `src/components/SceneCanvas.tsx` — reusable `<Canvas>` with lights, ground and
  `MapControls` (rotation disabled); camera and controls are configurable.
- `src/components/Room.tsx` — generic, customizable room template (size, colors,
  which walls are rendered, items, item selection). Used by both the house front
  view (front wall/ceiling hidden) and the isometric storey view.
- `src/components/Skyscraper.tsx` — clickable city block.
- `src/components/ItemBox.tsx` — generic clickable room item.
- `src/pages/` — `CityPage`, `HousePage`, `StoreyPage`, `NotFoundPage`.

## Next steps for the game

- Replace `HOUSES` with real game item/house data.
- Add item types beyond boxes and richer room customization.
- Consider shadows, a tileset, and camera bounds for map edges.

