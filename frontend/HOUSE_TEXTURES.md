# House Texture Generation Brief

This document is a reusable brief for **design agents** (including text-to-image AI agents) that
produce facade textures for the isometric city. Fill in the parameter block in
[Design knobs](#5-design-knobs--style-constants), then generate the four PBR maps so they drop
straight into the repo with no code changes.

---

## 1. Overview

The city is rendered with a near-isometric orthographic camera and a deliberate **low-poly**
look. Every house is drawn as a stack of **box "tiers"** (see `src/components/facade/Facade.tsx`).
Each tier is a `boxGeometry`, and all six faces of every box share one tiling texture, with the
number of repeats computed per face.

Your job: produce **seamless, tiling PBR textures** for one facade style ("set"). They are applied
to those boxes, lit by simple scene lights, and viewed from a single isometric angle. Textures must
look correct at small on-screen size, tile without visible seams, and not fight the 3D lighting.

A set is not just one image — it is up to **four maps** (`albedo`, `emissive`, `normal`,
`roughness`) that must line up with each other in UV space.

---

## 2. Drop-in contract

Deliver files into a folder named after the **set id**:

```
frontend/src/assets/<setId>/albedo.png
frontend/src/assets/<setId>/emissive.png
frontend/src/assets/<setId>/normal.png
frontend/src/assets/<setId>/roughness.png
```

Rules:

- **Folder name** must start with `house-` (the discovery glob is `house-*`), e.g. `house-d`.
- **`<setId>`** must match the `textures` field of a house in `src/data/houses.ts`
  (e.g. `facade: { shape: '...', design: '...', textures: '<setId>' }`). This links the house to
  your files.
- **File base names must be exactly** `albedo`, `emissive`, `normal`, `roughness`.
- **Extensions**: `.png`, `.jpg`, `.jpeg`, or `.webp`. **PNG is preferred.**
- Files are auto-discovered — adding a new folder needs **no code change**, only the
  `facade.textures` reference on the house.
- If the folder has **zero** files, the app falls back to a procedural texture
  (`src/components/facade/facadeTexture.ts`). As soon as **any** slot file exists, **all**
  discovered slots are applied (an unexpected `normal.png` will change the look — ship the maps
  together or not at all).
- Do not add extra image files to the folder (any recognized slot name will be picked up).

Recommended geometry:

- **Resolution**: `256×256` (or `512×512` for high detail). Non-power-of-two is fine on WebGL2.
- **Aspect**: square. The pattern's real-world period is set by `tileWidth`/`tileHeight` (below).

---

## 3. Per-map technical spec

| Slot        | Filename        | Color space (auto)     | Content rules |
|-------------|-----------------|------------------------|---------------|
| `albedo`    | `albedo.png`    | sRGB (color)           | Base color only. **No baked lighting, shadows, AO, or gradients.** Seamlessly tileable. |
| `emissive`  | `emissive.png`  | sRGB (color)           | Pure black everywhere except lit regions (windows, strips, panels). Lit regions must align in UV with the same features in `albedo`. |
| `normal`    | `normal.png`    | Linear (data)          | Tangent-space normal map. Neutral = `rgb(128, 128, 255)`. Subtle relief only; avoid strong edges that alias at small size. |
| `roughness` | `roughness.png` | Linear (data)          | Grayscale data map only (black = smooth/glossy, white = rough). No color, no shading, no text. |

Additional constraints for all maps:

- **No alpha** channels are used.
- **No text, logos, watermarks, signatures, or UI.**
- Keep the maps mutually consistent: same layout, same window/panel positions in UV.
- Color space is assigned **automatically** by the loader — author `albedo`/`emissive` as ordinary
  color images and `normal`/`roughness` as raw linear data (do **not** apply display gamma/contrast
  curves to the data maps).
- Anisotropic filtering is fixed at `4` in the shader; no need to encode that.

---

## 4. Tiling & wrapping rules

These are enforced by the code — design to them:

- `wrapS` and `wrapT` are always set to **`RepeatWrapping`**. Your images **must be seamless on
  both the horizontal (U) and vertical (V) axes**.
- Per box face, the number of repeats is:

  ```
  repeatU = round(faceWorldWidth  / tileWidth)
  repeatV = round(faceWorldHeight / tileHeight)
  ```

  Repeats are **rounded to whole numbers** with a minimum of `1`. Therefore:
  - The texture must tile cleanly at integer repeat counts (typically 1–3).
  - Do not rely on fractional alignment or a one-off full-building layout; the same texture repeats
    across every face and every tier.
- All six box faces share the texture, in Three.js group order **`+X, -X, +Y, -Y, +Z, -Z`**. Design
  a **generic, all-sides pattern** — there is no separate "front" or "roof" texture.
- Choose `tileWidth`/`tileHeight` to match the real-world period of the pattern so features are not
  stretched. Example: if one window band should span ~1 world unit, set `tileHeight` ≈ `1.0`.
- Before delivering, verify seams by offsetting the image by 50% in both axes and checking that no
  hard edge appears at the wrap boundary.

---

## 5. Design knobs & style constants

Copy this block and fill in the values for your set. The first group maps to the set's
`BaseDesign` (`src/data/baseDesigns.ts`); the second group is shared scene style.

### Per-set parameters (fill in)

```
setId:              house-<...>        # must match the folder name and House.facade.textures
design label:       <short human name, e.g. "Brutalist concrete">
tint:               #4a5468           # dominant base color of the facade
metalness:          0.0 – 1.0         # 0 = matte/stone/foliage, 1 = bare metal/chrome
roughness:          0.0 – 1.0         # 0 = mirror, 1 = fully diffuse
emissiveIntensity:  0.0 – 1.5         # brightness multiplier for the emissive map
tileWidth:          <world units>     # horizontal period represented by one texture tile
tileHeight:         <world units>     # vertical period represented by one texture tile
roofColor:          <hex>             # coordinates with the Roof prop color
accentColors:       <list of hex>     # glow/detail accents (see shared palette)
motif:              <free text>       # e.g. "glass curtain wall", "riveted plating", "bark + vines"
```

Guidance for the knobs:

- **Low `roughness`** → glossy panels/glass; **high `roughness`** → concrete, stone, bark, foliage.
- **High `metalness`** (≥0.5) → metallic panels; keep `albedo` darker, since metal tints reflections.
- **`emissiveIntensity`** only matters where `emissive.png` is non-black. Use it for windows,
  light strips, signage bars — not for diffuse surfaces.

### Shared style constants (keep these)

Iso city palette — harmonize your set with these:

| Role            | Hex       |
|-----------------|-----------|
| Background      | `#0b0e14` |
| Primary accent  | `#4f8cff` |
| Light accent    | `#6ea8fe` |
| Green           | `#4fd18b` |
| Orange          | `#ff8f4f` |
| Teal            | `#4fd1d1` |
| Violet          | `#8f6bff` |
| Red             | `#ff5f6d` |
| Amber           | `#ffb347` |
| Default roof    | `#1c2438` |
| Light metal     | `#c9d4e6` |
| Wood/bark       | `#5a4a38` |

Style constraints (non-negotiable):

- **Low-poly / flat, stylized.** No photorealism, no film grain, no heavy noise, no lens effects.
- **Readable at small scale.** Clear shapes and high value contrast between features; avoid
  fine detail that dissolves when the tile is only a few dozen pixels on screen.
- **No perspective or camera cues** baked in (no vanishing points, no directional shadows, no
  ambient occlusion). The 3D scene provides lighting and shadows.
- Consistent value range: keep `albedo` mid-tone so scene lights can brighten and dim it.

---

## 6. Prompt templates

Paste these into your image agent. Replace every `<...>` placeholder with your parameter values.
Keep the seamlessness and color-space lines verbatim.

### 6.1 Combined brief (all four maps)

> **Task:** Create a seamless, tileable PBR texture set for a stylized low-poly isometric building.
>
> **Set:** `<setId>` — motif: `<motif>`. Base tint `<tint>`, metalness `<metalness>`, roughness
> `<roughness>`, emissive intensity `<emissiveIntensity>`. One tile represents `<tileWidth>` ×
> `<tileHeight>` world units.
>
> **Output four images, all `256×256`, all seamless on both axes, all sharing the same UV layout:**
> 1. `albedo.png` — base color only, sRGB, flat and mid-tone, **no lighting, shadows, or AO**.
> 2. `emissive.png` — sRGB; pure black except the lit windows/features, which must line up exactly
>    with the albedo layout. Use accents from: `<accentColors>`.
> 3. `normal.png` — tangent-space normal map, neutral color `rgb(128,128,255)`, subtle surface
>    relief only, linear data (no gamma).
> 4. `roughness.png` — grayscale data map only, linear (no gamma), no color.
>
> **Style:** stylized, low-poly, clean geometric shapes, high value contrast, readable at small
> size. No text, logos, watermarks, perspective, or directional shadows. Palette harmonizes with
> `#0b0e14`, `#4f8cff`, `#6ea8fe`.
>
> **Tile test:** offset each image by 50% horizontally and vertically — there must be no visible
> seam.

### 6.2 Albedo only

> Seamless tileable **albedo** (base color) texture, `256×256`, top-down flat layout of `<motif>`,
> base color `<tint>`, stylized low-poly building facade, geometric panels/windows, mid-tone
> values, **no shadows, no lighting, no ambient occlusion, no text**, edges tile perfectly on all
> sides, harmonizes with palette `#0b0e14 / #4f8cff / #6ea8fe`.

### 6.3 Emissive only

> Seamless tileable **emissive** texture, `256×256`, **pure black background**, only the lit window
> and light-strip regions in colors `<accentColors>`, must align in UV with the albedo layout of
> `<setId>`, `<motif>`, glowing lights only, no diffuse surface color, edges tile perfectly.

### 6.4 Normal only

> Seamless tileable **tangent-space normal map**, `256×256`, neutral base `rgb(128,128,255)`,
> subtle relief matching `<motif>` (`<setId>`), gentle bevels at panel/window edges, **no color, no
> lighting baked in**, linear data, edges tile perfectly.

### 6.5 Roughness only

> Seamless tileable **roughness** map, `256×256`, grayscale only, `<setId>` (`<motif>`), matte
> areas near white and glossy areas near black based on material zones, **no color, no shading, no
> text**, linear data, edges tile perfectly.

---

## 7. Validation checklist

Before handing the set over, confirm:

- [ ] Folder is `frontend/src/assets/house-<...>/` and `<setId>` matches a house's
      `facade.textures` in `src/data/houses.ts`.
- [ ] Files are named exactly `albedo`, `emissive`, `normal`, `roughness` with an accepted
      extension; no extra images in the folder.
- [ ] All maps are the same resolution and share the same UV layout.
- [ ] Every map is seamless: shift by 50% in U and V, no hard seam.
- [ ] `albedo`/`emissive` authored as sRGB color; `normal`/`roughness` as raw linear data.
- [ ] `emissive` is black except the lit features, which align with `albedo`.
- [ ] `normal` neutral color is `rgb(128,128,255)`; `roughness` is grayscale only.
- [ ] No text, logos, watermarks, baked shadows, or perspective cues.
- [ ] Pattern reads clearly at 1–3 repeats and at small on-screen size.
- [ ] `tileWidth`/`tileHeight` chosen so features are not stretched on the boxes.

Preview in-app: drop the files in, run `bun run dev` in `frontend/`, open the city and a house
that references the set. Check the facade tiles from the isometric angle and that lit windows glow
appropriately.

---

## Reference (implementation)

- Loader & discovery: `src/components/facade/useHouseTextures.ts`
- Procedural fallback: `src/components/facade/facadeTexture.ts`
- Face repeats, wrapping, material setup: `src/components/facade/Facade.tsx`
- Set-to-house link & house list: `src/data/houses.ts`
- Design defaults (tint/metalness/roughness/tiling): `src/data/baseDesigns.ts`
- Shape/tier layout: `src/data/facadeShapes.ts`
