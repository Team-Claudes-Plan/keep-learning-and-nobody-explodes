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

## Audio

All sounds are synthesised with the Web Audio API — there are no audio files to
download. The speaker button in the top-right corner mutes everything and the
setting is kept in `localStorage`.

- `src/audio/engine.ts` — one shared `AudioContext`, master/compressor, mute
  state, and the procedural ambience beds (islands, house, room, bomb, book).
- `src/audio/music.ts` — a continuous generative piece (Dmaj9 → Bm9 → Gmaj9 →
  A7sus4) with pads, bass, plucks and bells. It runs across route changes and is
  only ducked, never restarted.
- `src/audio/sfx.ts` — the sound library (`playSfx(name)`): UI clicks, timer
  ticks (the last ten seconds are deliberately loud), correct/wrong/strike,
  explosion, debris clanks, fanfare, every module's mechanical signature, page
  flips, doors, bridges, birds/cars and upload feedback.
- `src/audio/AudioRoot.tsx` — unlocks audio on the first gesture, plays a quiet
  click for ordinary buttons and links, and hosts the mute switch.
- `src/audio/useAmbience.ts` — starts a soundscape for a page and sprinkles in
  wildlife one-shots.

UI controls get a default click automatically. Use `data-sfx="none"` to opt out
when a handler plays its own sound, or `data-sfx="whoosh"` (any name from
`SoundName`) to pick a specific effect. Module cards opt out as a group because
their value changes already play the matching mechanical sound.

Open `/soundtest` (also linked from the Minigames page) to hear every effect
individually or play the whole library in sequence.

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
- `*` — not found page.

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

