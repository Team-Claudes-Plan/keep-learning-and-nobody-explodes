"""Low-poly construction site for an island cell whose houses are still being built.

Run: flatpak run org.blender.Blender -b -P frontend/scripts/blender/construction.py -- <out.glb> [preview.png]
Blender is Z-up; the glTF exporter turns that into three.js Y-up. Origin = ground, centre of the lot.
The city camera sees the front (-Y) and right (+X) sides, so the crane stands in the back-left corner.

The crane jib is its own node with glTF extras (anim "swing" around the tower), animated by the
frontend like the moving parts of the house kits (see KitFacade).
"""

import math
import random
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = args[0] if args else "site.glb"
PREVIEW = args[1] if len(args) > 1 else None

LOT = 2.8  # a grid cell is 3.4 wide; houses use 2.2-2.8
PAD = 0.06
HALF = LOT / 2
CRANE = Vector((-0.95, 0.95, 0))
TOWER = 3.4
TOWER_W = 0.2
BEVEL = 0.01

random.seed(11)
bpy.ops.wm.read_factory_settings(use_empty=True)


def srgb(hex_color):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    h = hex_color.lstrip("#")
    return tuple(lin(int(h[i : i + 2], 16)) for i in (0, 2, 4))


def material(name, hex_color, roughness=0.8, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*srgb(hex_color), 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return m


DIRT = material("Dirt", "#9a7650")
GRAVEL = material("Gravel", "#b9a58a")
CONCRETE = material("Concrete", "#b8b8b0")
STEEL = material("Steel", "#c8502d", roughness=0.55, metallic=0.3)
CRANE_YELLOW = material("Crane", "#f2b632", roughness=0.5, metallic=0.2)
DARK = material("Dark", "#3a3f47", roughness=0.5, metallic=0.6)
ORANGE = material("Orange", "#f07a1a", roughness=0.6)
WHITE = material("White", "#f2f0ea", roughness=0.6)
WOOD = material("Wood", "#c99a5b")
POLE = material("Pole", "#8a9099", roughness=0.4, metallic=0.7)
GLASS = material("Glass", "#9fd3e8", roughness=0.15)
MIXER = material("Mixer", "#3d7fc4", roughness=0.5, metallic=0.2)
BRICK = material("Brick", "#b5533c")


def box(name, size, location, mat, rotation=(0, 0, 0), bevel=BEVEL):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = min(bevel, min(size) / 3)
        mod.segments = 1
    obj.data.materials.append(mat)
    return obj


def beam(name, start, end, thickness, mat):
    """A square bar from `start` to `end`."""
    start, end = Vector(start), Vector(end)
    direction = end - start
    rotation = direction.to_track_quat("Z", "Y").to_euler()
    return box(name, (thickness, thickness, direction.length), (start + end) / 2, mat, rotation=rotation, bevel=0)


def cylinder(name, radius, depth, location, mat, rotation=(0, 0, 0), vertices=8):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def cone(name, r1, r2, depth, location, mat, rotation=(0, 0, 0), vertices=8):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r1, radius2=r2, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


# ---------------------------------------------------------------------------
# Ground: a dirt pad with a few gravel heaps

box("Pad", (LOT, LOT, PAD), (0, 0, PAD / 2), DIRT, bevel=0.02)
for i, (x, y, r) in enumerate([(0.95, 0.35, 0.28), (1.05, 0.0, 0.18), (-0.2, 1.05, 0.22)]):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=r, location=(x, y, PAD))
    heap = bpy.context.object
    heap.name = f"Heap_{i}"
    heap.scale = (1, 1, 0.45)
    bpy.ops.object.transform_apply(scale=True)
    heap.data.materials.append(GRAVEL)

# ---------------------------------------------------------------------------
# Fence: striped barrier panels on posts, open at the front for the gate

FENCE = HALF - 0.06
POST_H = 0.32
SEGMENT = 0.35


def fence_side(name, start, end, gap=None):
    """Posts and two striped rails from `start` to `end` (2D); skips the range `gap` (0..1)."""
    start, end = Vector((*start, 0)), Vector((*end, 0))
    length = (end - start).length
    count = max(1, round(length / SEGMENT))
    along = (end - start) / count
    angle = math.atan2(along.y, along.x)
    for i in range(count + 1):
        t = i / count
        if gap and gap[0] < t < gap[1]:
            continue
        p = start + along * i
        box(f"{name}_Post_{i}", (0.04, 0.04, POST_H), (p.x, p.y, PAD + POST_H / 2), WHITE, bevel=0.005)
    for i in range(count):
        t = (i + 0.5) / count
        if gap and gap[0] < t < gap[1]:
            continue
        p = start + along * (i + 0.5)
        for k, z in enumerate((0.13, 0.26)):
            mat = ORANGE if (i + k) % 2 == 0 else WHITE
            box(
                f"{name}_Rail_{i}_{k}",
                (along.length - 0.02, 0.025, 0.07),
                (p.x, p.y, PAD + z),
                mat,
                rotation=(0, 0, angle),
                bevel=0.004,
            )


fence_side("Front", (-FENCE, -FENCE), (FENCE, -FENCE), gap=(0.42, 0.75))
fence_side("Right", (FENCE, -FENCE), (FENCE, FENCE))
fence_side("Back", (FENCE, FENCE), (-FENCE, FENCE))
fence_side("Left", (-FENCE, FENCE), (-FENCE, -FENCE))

# ---------------------------------------------------------------------------
# The house going up: foundation slab, a steel frame with one floor done and scaffolding

SLAB = Vector((0.05, -0.15, 0))
SLAB_W, SLAB_D = 1.5, 1.2
box("Foundation", (SLAB_W, SLAB_D, 0.14), (SLAB.x, SLAB.y, PAD + 0.07), CONCRETE, bevel=0.015)

FLOOR_H = 1.1
COLUMN = 0.08
base_z = PAD + 0.14
corners = [(sx, sy) for sx in (-1, 1) for sy in (-1, 1)]
for sx, sy in corners:
    x = SLAB.x + sx * (SLAB_W / 2 - 0.08)
    y = SLAB.y + sy * (SLAB_D / 2 - 0.08)
    box(f"Column_{sx}_{sy}", (COLUMN, COLUMN, FLOOR_H), (x, y, base_z + FLOOR_H / 2), STEEL, bevel=0.006)
    # the back columns already reach for the second floor
    if sy > 0:
        box(f"Column_Up_{sx}", (COLUMN, COLUMN, 0.8), (x, y, base_z + FLOOR_H + 0.4), STEEL, bevel=0.006)

top_z = base_z + FLOOR_H
for sy in (-1, 1):
    y = SLAB.y + sy * (SLAB_D / 2 - 0.08)
    box(f"Girder_X_{sy}", (SLAB_W - 0.08, COLUMN, 0.09), (SLAB.x, y, top_z), STEEL, bevel=0.006)
for sx in (-1, 1):
    x = SLAB.x + sx * (SLAB_W / 2 - 0.08)
    box(f"Girder_Y_{sx}", (COLUMN, SLAB_D - 0.08, 0.09), (x, SLAB.y, top_z), STEEL, bevel=0.006)
# half of the first floor slab is poured
box("Floor_1", (SLAB_W - 0.1, SLAB_D / 2, 0.07), (SLAB.x, SLAB.y + SLAB_D / 4 - 0.04, top_z + 0.08), CONCRETE, bevel=0.01)
# a cross brace in the open side wall
x = SLAB.x + SLAB_W / 2 - 0.08
beam("Brace_A", (x, SLAB.y - SLAB_D / 2 + 0.1, base_z + 0.05), (x, SLAB.y + SLAB_D / 2 - 0.1, top_z - 0.05), 0.035, STEEL)
beam("Brace_B", (x, SLAB.y + SLAB_D / 2 - 0.1, base_z + 0.05), (x, SLAB.y - SLAB_D / 2 + 0.1, top_z - 0.05), 0.035, STEEL)
# a few bricks of the first wall on the back
for i in range(5):
    for row in range(3 if i < 3 else 2):
        box(
            f"Wall_{i}_{row}",
            (0.24, 0.1, 0.1),
            (SLAB.x - SLAB_W / 2 + 0.25 + i * 0.25 + (0.12 if row % 2 else 0), SLAB.y + SLAB_D / 2 - 0.08, base_z + 0.05 + row * 0.105),
            BRICK,
            bevel=0.008,
        )

# scaffolding along the front
SCAFFOLD_Y = SLAB.y - SLAB_D / 2 - 0.22
for i, x in enumerate((SLAB.x - 0.65, SLAB.x, SLAB.x + 0.65)):
    for dy in (0, 0.16):
        cylinder(f"Scaffold_Pole_{i}_{dy}", 0.015, 1.35, (x, SCAFFOLD_Y + dy, base_z + 0.6), POLE, vertices=6)
for level, z in enumerate((base_z + 0.5, base_z + 1.15)):
    box(f"Scaffold_Plank_{level}", (1.4, 0.2, 0.03), (SLAB.x, SCAFFOLD_Y + 0.08, z), WOOD, bevel=0.005)
    box(f"Scaffold_Rail_{level}", (1.36, 0.02, 0.02), (SLAB.x, SCAFFOLD_Y - 0.01, z + 0.25), POLE, bevel=0)
beam("Scaffold_Diag", (SLAB.x - 0.65, SCAFFOLD_Y - 0.01, base_z), (SLAB.x + 0.65, SCAFFOLD_Y - 0.01, base_z + 1.15), 0.02, POLE)

# ---------------------------------------------------------------------------
# Props: steel beams, a brick pallet, cones at the gate, a cement mixer

# two layers of two beams
for i in range(4):
    layer, slot = divmod(i, 2)
    box(f"Stock_Beam_{i}", (0.95, 0.07, 0.06), (0.75 + layer * 0.04, 0.84 + slot * 0.09, PAD + 0.03 + layer * 0.065), STEEL, bevel=0.006)
box("Pallet", (0.4, 0.32, 0.05), (-0.7, -0.95, PAD + 0.025), WOOD, bevel=0.006)
for i in range(3):
    for j in range(2):
        box(f"Bricks_{i}_{j}", (0.12, 0.14, 0.09), (-0.83 + i * 0.13, -1.02 + j * 0.15, PAD + 0.1), BRICK, bevel=0.008)

for i, (x, y) in enumerate([(0.18, -1.45), (0.62, -1.42)]):
    cone(f"Cone_{i}", 0.07, 0.012, 0.22, (x, y, PAD + 0.11), ORANGE)
    cylinder(f"Cone_Band_{i}", 0.048, 0.04, (x, y, PAD + 0.12), WHITE)
    box(f"Cone_Foot_{i}", (0.16, 0.16, 0.02), (x, y, PAD + 0.01), ORANGE, bevel=0.004)

MIX = Vector((1.0, -0.85, PAD))
box("Mixer_Frame", (0.32, 0.14, 0.05), (MIX.x, MIX.y, MIX.z + 0.16), DARK, bevel=0.005)
for sy in (-1, 1):
    cylinder(f"Mixer_Wheel_{sy}", 0.08, 0.04, (MIX.x - 0.08, MIX.y + sy * 0.1, MIX.z + 0.08), DARK, rotation=(math.pi / 2, 0, 0), vertices=10)
beam("Mixer_Leg", (MIX.x + 0.12, MIX.y, MIX.z), (MIX.x + 0.12, MIX.y, MIX.z + 0.16), 0.03, DARK)
tilt = (0, math.radians(-35), 0)
cone("Mixer_Drum", 0.13, 0.07, 0.24, (MIX.x + 0.02, MIX.y, MIX.z + 0.33), MIXER, rotation=tilt, vertices=10)
cone("Mixer_Back", 0.13, 0.09, 0.08, (MIX.x - 0.08, MIX.y, MIX.z + 0.26), MIXER, rotation=(0, math.radians(145), 0), vertices=10)

# ---------------------------------------------------------------------------
# Tower crane: a lattice mast on a concrete footing, the cab and the turning jib on top

box("Crane_Footing", (0.42, 0.42, 0.12), (CRANE.x, CRANE.y, PAD + 0.06), CONCRETE, bevel=0.01)
mast_bottom = PAD + 0.12
h = TOWER_W / 2
corner_offsets = [Vector((sx * h, sy * h, 0)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
for i, off in enumerate(corner_offsets):
    p = CRANE + off
    beam(f"Mast_Chord_{i}", (p.x, p.y, mast_bottom), (p.x, p.y, TOWER), 0.03, CRANE_YELLOW)
SECTION = 0.34
z = mast_bottom
section = 0
while z + SECTION <= TOWER + 0.001:
    for i in range(4):
        a, b = CRANE + corner_offsets[i], CRANE + corner_offsets[(i + 1) % 4]
        lo, hi = (a, b) if section % 2 == 0 else (b, a)
        beam(f"Mast_Diag_{section}_{i}", (lo.x, lo.y, z), (hi.x, hi.y, z + SECTION), 0.016, CRANE_YELLOW)
        beam(f"Mast_Ring_{section}_{i}", (a.x, a.y, z + SECTION), (b.x, b.y, z + SECTION), 0.016, CRANE_YELLOW)
    z += SECTION
    section += 1
box("Slewing_Ring", (0.28, 0.28, 0.06), (CRANE.x, CRANE.y, TOWER + 0.03), DARK, bevel=0.008)

static = [obj for obj in bpy.data.objects if obj.type == "MESH"]

# --- the jib: everything above the slewing ring turns. Built in place, pivot = tower axis.
PIVOT = Vector((CRANE.x, CRANE.y, TOWER + 0.06))
JIB_LEN = 2.3
COUNTER = 0.75
jib_z = PIVOT.z + 0.12
direction = Vector((1, -0.35, 0)).normalized()  # towards the front right, over the site
side = Vector((-direction.y, direction.x, 0))
jib = []


def along(d, lateral=0.0, height=0.0):
    p = PIVOT + direction * d + side * lateral
    return (p.x, p.y, jib_z + height)


cab = box("Cab", (0.2, 0.18, 0.18), along(0.05, 0.15, 0.0), CRANE_YELLOW, rotation=(0, 0, math.atan2(direction.y, direction.x)), bevel=0.012)
window = box("Cab_Window", (0.19, 0.185, 0.08), along(0.07, 0.15, 0.03), GLASS, rotation=(0, 0, math.atan2(direction.y, direction.x)), bevel=0)
jib += [cab, window]
# a triangular lattice boom: two bottom chords and one top chord
for k, lateral in enumerate((-0.06, 0.06)):
    jib.append(beam(f"Jib_Chord_{k}", along(-COUNTER, lateral), along(JIB_LEN, lateral), 0.025, CRANE_YELLOW))
jib.append(beam("Jib_Top", along(0.1, 0, 0.11), along(JIB_LEN - 0.05, 0, 0.02), 0.022, CRANE_YELLOW))
steps = 9
for i in range(steps):
    d0 = 0.1 + (JIB_LEN - 0.15) * i / steps
    d1 = 0.1 + (JIB_LEN - 0.15) * (i + 1) / steps
    lateral = -0.06 if i % 2 == 0 else 0.06
    t1 = 0.11 - 0.09 * (i + 1) / steps
    jib.append(beam(f"Jib_Diag_{i}", along(d0, lateral), along(d1, 0, t1), 0.012, CRANE_YELLOW))
# the peak with tie bars to the tip and the counterweight
jib.append(beam("Peak", along(0, 0, 0), along(0, 0, 0.55), 0.04, CRANE_YELLOW))
jib.append(beam("Tie_Front", along(0, 0, 0.55), along(JIB_LEN * 0.65, 0, 0.08), 0.01, DARK))
jib.append(beam("Tie_Back", along(0, 0, 0.55), along(-COUNTER + 0.1, 0, 0.05), 0.01, DARK))
jib.append(box("Counterweight", (0.22, 0.2, 0.2), along(-COUNTER + 0.12, 0, -0.08), CONCRETE, rotation=(0, 0, math.atan2(direction.y, direction.x)), bevel=0.012))
# trolley, cable and the hook carrying a beam
HOOK_D = 1.55
HOOK_Z = 2.45
jib.append(box("Trolley", (0.12, 0.16, 0.05), along(HOOK_D, 0, -0.04), DARK, bevel=0.006))
tx, ty, _ = along(HOOK_D)
for k, lateral in enumerate((-0.025, 0.025)):
    cx, cy, cz = along(HOOK_D, lateral, -0.06)
    jib.append(beam(f"Cable_{k}", (cx, cy, cz), (cx, cy, HOOK_Z + 0.08), 0.008, DARK))
jib.append(box("Hook_Block", (0.08, 0.08, 0.1), (tx, ty, HOOK_Z + 0.05), ORANGE, bevel=0.008))
for k, lateral in enumerate((-0.25, 0.25)):
    p = Vector((tx, ty, 0)) + side * lateral
    jib.append(beam(f"Sling_{k}", (tx, ty, HOOK_Z), (p.x, p.y, HOOK_Z - 0.22), 0.006, DARK))
lifted = box("Lifted_Beam", (0.07, 0.75, 0.06), (tx, ty, HOOK_Z - 0.25), STEEL, rotation=(0, 0, math.atan2(direction.y, direction.x)), bevel=0.006)
jib.append(lifted)

# ---------------------------------------------------------------------------
# Flat shading, bake modifiers, join into the site and the jib


def finish(objects, name, origin=None):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        bpy.context.view_layer.objects.active = obj
        for mod in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.shade_flat()
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = name
    if origin is not None:
        bpy.context.scene.cursor.location = origin
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    return joined


site = finish(static, "Construction_Site")
site["module"] = "site"
site["footprint"] = [LOT, LOT]
crane_jib = finish(jib, "Crane_Jib", origin=PIVOT)
# glTF is Y-up: Blender's Z axis becomes [0, 1, 0]
crane_jib["anim"] = "swing"
crane_jib["axis"] = [0, 1, 0]
crane_jib["amplitude"] = 0.55
crane_jib["speed"] = 0.35
crane_jib.parent = site

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_extras=True,
    export_apply=True,
    export_texcoords=False,
)
print("exported", OUT)

if PREVIEW:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    world = bpy.data.worlds.new("World")
    world.color = (0.55, 0.7, 0.85)
    scene.world = world
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(50), math.radians(10), math.radians(30)))
    bpy.context.object.data.energy = 4
    bpy.ops.object.light_add(type="AREA", location=(-3, -3, 4))
    bpy.context.object.data.energy = 400
    # roughly the island camera: from the front right, looking down
    bpy.ops.object.camera_add(location=(7.5, -7.5, 6.5))
    cam = bpy.context.object
    target = bpy.data.objects.new("Target", None)
    target.location = (0, 0, 1.7)
    scene.collection.objects.link(target)
    track = cam.constraints.new("TRACK_TO")
    track.target = target
    scene.camera = cam
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
