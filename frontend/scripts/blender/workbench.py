"""Low-poly workbench for the storey rooms.

Run: flatpak run org.blender.Blender -b -P frontend/scripts/blender/workbench.py -- <out.glb> [preview.png]
Blender is Z-up; the glTF exporter turns that into three.js Y-up. Origin = floor, centre of the table.
"""

import math
import random
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = args[0] if args else "workbench.glb"
PREVIEW = args[1] if len(args) > 1 else None

WIDTH = 1.1
DEPTH = 0.6
HEIGHT = 0.42
TOP = 0.045
LEG = 0.075
BEVEL = 0.008

random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color, roughness=0.8, metallic=0.0):
    m = bpy.data.materials.new(name)
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return m


def srgb(hex_color):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    h = hex_color.lstrip("#")
    return tuple(lin(int(h[i : i + 2], 16)) for i in (0, 2, 4))


PLANKS = [
    material("Plank A", srgb("#b07a4a")),
    material("Plank B", srgb("#9c6a3e")),
    material("Plank C", srgb("#c08a56")),
]
FRAME = material("Frame", srgb("#6b452a"))
SHELF = material("Shelf", srgb("#7d5232"))
METAL = material("Metal", srgb("#3a3f47"), roughness=0.45, metallic=0.8)
BRASS = material("Brass", srgb("#c9a15a"), roughness=0.35, metallic=0.9)


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


# Top: three planks along the length, small gaps and a little hand-made unevenness
plank_count = 3
gap = 0.006
plank_depth = (DEPTH - gap * (plank_count - 1)) / plank_count
for i in range(plank_count):
    y = -DEPTH / 2 + plank_depth / 2 + i * (plank_depth + gap)
    box(
        f"Top_{i}",
        (WIDTH + random.uniform(-0.01, 0.01), plank_depth, TOP),
        (random.uniform(-0.006, 0.006), y, HEIGHT - TOP / 2 + random.uniform(-0.002, 0.002)),
        PLANKS[i % len(PLANKS)],
        rotation=(0, 0, math.radians(random.uniform(-0.4, 0.4))),
    )

# Cleats under the top at both ends
for sx in (-1, 1):
    box(f"Cleat_{sx}", (0.05, DEPTH - 0.03, 0.025), (sx * (WIDTH / 2 - 0.09), 0, HEIGHT - TOP - 0.0125), FRAME)

# Legs: square, slightly splayed outwards
leg_x = WIDTH / 2 - 0.09
leg_y = DEPTH / 2 - 0.07
leg_h = HEIGHT - TOP - 0.02
splay = math.radians(3)
for sx in (-1, 1):
    for sy in (-1, 1):
        box(
            f"Leg_{sx}_{sy}",
            (LEG, LEG, leg_h),
            (sx * leg_x, sy * leg_y, leg_h / 2),
            FRAME,
            rotation=(-sy * splay, sx * splay, 0),
        )
        # metal foot cap
        box(f"Foot_{sx}_{sy}", (LEG + 0.012, LEG + 0.012, 0.018), (sx * (leg_x + 0.012), sy * (leg_y + 0.012), 0.009), METAL, bevel=0.003)

# Aprons
apron_z = HEIGHT - TOP - 0.06
for sy in (-1, 1):
    box(f"Apron_Long_{sy}", (2 * leg_x - LEG, 0.022, 0.08), (0, sy * leg_y, apron_z), FRAME, bevel=0.004)
for sx in (-1, 1):
    box(f"Apron_Short_{sx}", (0.022, 2 * leg_y - LEG, 0.08), (sx * leg_x, 0, apron_z), FRAME, bevel=0.004)

# Drawer in the front apron (front = -Y in Blender = +Z in three.js)
drawer_y = -leg_y - 0.016
box("Drawer", (0.34, 0.016, 0.06), (0.22, drawer_y, apron_z), PLANKS[1], bevel=0.004)
bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.012, depth=0.02, location=(0.22, drawer_y - 0.016, apron_z), rotation=(math.pi / 2, 0, 0))
knob = bpy.context.object
knob.name = "Drawer_Knob"
knob.data.materials.append(BRASS)

# Stretchers and slatted lower shelf
shelf_z = 0.1
for sx in (-1, 1):
    box(f"Stretcher_{sx}", (0.03, 2 * leg_y, 0.04), (sx * (leg_x - 0.005), 0, shelf_z - 0.03), FRAME, bevel=0.004)
slats = 4
slat_d = 0.085
for i in range(slats):
    y = -leg_y + 0.05 + i * ((2 * leg_y - 0.1) / (slats - 1))
    box(f"Shelf_{i}", (2 * leg_x + 0.03, slat_d, 0.018), (0, y, shelf_z), SHELF, bevel=0.003)

# Corner brackets and a few nail heads on the top
for sx in (-1, 1):
    for sy in (-1, 1):
        box(f"Bracket_{sx}_{sy}", (0.06, 0.006, 0.05), (sx * leg_x, sy * (leg_y + LEG / 2 + 0.004), HEIGHT - TOP - 0.035), METAL, bevel=0.002)
for i in range(plank_count):
    y = -DEPTH / 2 + plank_depth / 2 + i * (plank_depth + gap)
    for sx in (-1, 1):
        bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.007, depth=0.003, location=(sx * (WIDTH / 2 - 0.09), y, HEIGHT + 0.001))
        nail = bpy.context.object
        nail.name = f"Nail_{i}_{sx}"
        nail.data.materials.append(METAL)

# Flat shading for the low-poly look
for obj in bpy.data.objects:
    if obj.type == "MESH":
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
bpy.ops.object.shade_flat()

# Bake modifiers and merge everything into one object
for obj in list(bpy.data.objects):
    bpy.context.view_layer.objects.active = obj
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = bpy.data.objects["Top_0"]
bpy.ops.object.join()
bpy.context.object.name = "Workbench"

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=False, export_apply=True)
print("exported", OUT)

if PREVIEW:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 600
    world = bpy.data.worlds.new("World")
    world.color = (0.05, 0.07, 0.12)
    scene.world = world
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(50), math.radians(10), math.radians(30)))
    bpy.context.object.data.energy = 4
    bpy.ops.object.light_add(type="AREA", location=(-1.5, -1.5, 1.5))
    bpy.context.object.data.energy = 120
    bpy.ops.object.camera_add(location=(1.2, -1.7, 1.1))
    cam = bpy.context.object
    target = bpy.data.objects.new("Target", None)
    target.location = (0, 0, 0.2)
    scene.collection.objects.link(target)
    track = cam.constraints.new("TRACK_TO")
    track.target = target
    scene.camera = cam
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
