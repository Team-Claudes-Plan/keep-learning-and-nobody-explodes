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
- `/city` — isometric cityscape on a low-poly island floating in the sky:
  rough rocky shorelines mark the edge of the world and panning is clamped to
  the shoreline. A small lake feeds a river that flows to the edge and spills
  off the island as a waterfall into the void. Skyscraper blocks stand in for
  houses; clicking one navigates to the house.
- `/houses/:houseId` — 2.5D slightly-angled front view of one house. Each
  storey is a single room; the wall facing the camera is omitted so the storeys
  are visible from outside. Clicking a storey opens that room.
- `/houses/:houseId/storeys/:storeyId` — a single storey in the isometric
  view. Room items are clickable and can be selected/highlighted.
- `/ar-demo` — the playable bomb as an AR object: place it in the room with 8th
  Wall and tap its modules to solve the 2D tasks (see below).
- `*` — not found page.

## AR demo (`/ar-demo`)

A small 8th Wall demo that turns the bomb into a playable room-scale AR object:

- Pick one of the six learning levels (Foundations … Analysis) or the
  all-module-types level. The level is the **module pool**; a round plans five
  modules from it onto the bomb.
- The 3D turntable preview runs anywhere, including the desktop; drag to turn the
  bomb, scroll/pinch to zoom, and tap a module to try its task.
- "AR starten" loads the free/open-source 8th Wall engine from jsDelivr
  (`@8thwall/engine-binary`, world-tracking `slam` chunk), opens the camera, shows
  a reticle and places the bomb on the first surface tap. Drag to turn it, pinch
  or use the buttons to scale it.
- Tap a module plate: the bomb pulls that module in front of the camera and its
  **2D minigame** opens in a card over the AR view. The five-minute timer starts
  after placement; three mistakes end the round. The bomb's timer display, module
  LEDs and strike lights update live.
- Levels can be switched while the bomb is placed. A new plan rebuilds the bomb
  without losing its spot on the floor.

This AR mode is single-player: the question is shown on the module card. The
two-player manual is not part of this demo.

The level presets live in `src/ar/levels.ts`, the three.js scene, focus animation
and 8th Wall integration in `src/ar/ArBombExperience.ts`, and the UI in
`src/pages/ArDemoPage.tsx`.

### HTTPS for testing on a phone

The camera and 8th Wall need HTTPS. The repo includes a small script that
creates a local development CA and a server certificate valid for `localhost`,
the machine's `.local`/`.fritz.box` names and all current IPv4 addresses:

```bash
npm run cert
npm run dev
```

`certs/` is gitignored; private keys never belong in a commit.

**Install the CA once on the phone** (AirDrop or email the file to yourself):

- **iOS (recommended):** `certs/keep-learning-local-ca.mobileconfig`
  Install the profile under *Settings → General → VPN & Device Management*,
  then enable full trust under
  *Settings → General → About → Certificate Trust Settings*.
- **iOS / Android:** alternatively `certs/keep-learning-local-ca.crt`.
  On Android install it under *Settings → Security → Encryption & credentials →
  Install a certificate → CA certificate*.

Then open the dev server on the phone, e.g.
`https://192.168.178.26:5173/ar-demo` (the exact addresses are printed by
`npm run cert` and `npm run dev`). The phone must be on the same network, and the
macOS firewall must allow incoming connections for `node`.

After a network change, run `npm run cert` again so the server certificate
contains the new IP. Use only the CA certificate/profile on the phone — never
send `ca.key` or `server.key`. Remove the profile from the phone when you are
done testing.

On the Mac itself you can optionally trust the CA to avoid the browser warning:

```bash
security add-trusted-cert -d -r trustRoot -k ~/Library/Keychains/login.keychain-db certs/keep-learning-local-ca.crt
```

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

