"""Low-poly background decoration for the storey rooms: a potted flower plant and a floor lamp.

Run: flatpak run org.blender.Blender -b -P frontend/scripts/blender/decor.py -- <out_dir> [preview_dir]
Writes <out_dir>/plant.glb and <out_dir>/floor_lamp.glb. Origin = floor, centre of the object.
Blender is Z-up; the glTF exporter turns that into three.js Y-up.
"""

import math
import os
import random
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT_DIR = args[0] if args else "."
PREVIEW_DIR = args[1] if len(args) > 1 else None


def srgb(hex_color):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    h = hex_color.lstrip("#")
    return tuple(lin(int(h[i : i + 2], 16)) for i in (0, 2, 4))


def material(name, hex_color, roughness=0.8, metallic=0.0, emission=0.0):
    m = bpy.data.materials.new(name)
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*srgb(hex_color), 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*srgb(hex_color), 1)
        bsdf.inputs["Emission Strength"].default_value = emission
    return m


def finish(obj, mat):
    obj.data.materials.append(mat)
    return obj


def cylinder(name, mat, radius, depth, location, vertices=8, radius2=None, rotation=(0, 0, 0)):
    if radius2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=radius2, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    return finish(obj, mat)


def blob(name, mat, scale, location, rotation=(0, 0, 0)):
    """Flattened icosphere: leaves, flower petals, foliage."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    return finish(obj, mat)


def export(name, path):
    """Flat-shade, join everything in the scene into one object and write a GLB."""
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.shade_flat()
    bpy.ops.object.join()
    bpy.context.object.name = name
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=False, export_apply=True)
    print("exported", path)


def preview(path, target_z, distance):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 600
    scene.render.resolution_y = 800
    world = bpy.data.worlds.new("World")
    world.color = (0.05, 0.07, 0.12)
    scene.world = world
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(50), math.radians(10), math.radians(30)))
    bpy.context.object.data.energy = 4
    bpy.ops.object.camera_add(location=(distance * 0.5, -distance, target_z + distance * 0.3))
    cam = bpy.context.object
    target = bpy.data.objects.new("Target", None)
    target.location = (0, 0, target_z)
    scene.collection.objects.link(target)
    cam.constraints.new("TRACK_TO").target = target
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# --- Potted flower plant (about 0.85 m tall) -------------------------------------------------
def build_plant():
    random.seed(3)
    clay = material("Clay", "#c4673f")
    clay_dark = material("Clay Rim", "#a8532f")
    soil = material("Soil", "#3b2a1e")
    leaf_a = material("Leaf A", "#4f9a4a")
    leaf_b = material("Leaf B", "#3d7f3e")
    stem = material("Stem", "#4a6b2f")
    petal = material("Petal", "#f28fb0")
    centre = material("Flower Centre", "#ffd25a")

    pot_h = 0.32
    cylinder("Pot", clay, 0.15, pot_h, (0, 0, pot_h / 2), radius2=0.2)
    cylinder("Rim", clay_dark, 0.215, 0.05, (0, 0, pot_h + 0.01))
    cylinder("Soil", soil, 0.19, 0.02, (0, 0, pot_h + 0.03))

    # Leaves fan out from the soil
    for i in range(9):
        a = i / 9 * math.tau + random.uniform(-0.2, 0.2)
        tilt = random.uniform(0.6, 1.0)
        length = random.uniform(0.17, 0.24)
        r = length * 0.75
        blob(
            f"Leaf_{i}",
            leaf_a if i % 2 else leaf_b,
            (length, 0.06, 0.012),
            (math.cos(a) * r, math.sin(a) * r, pot_h + 0.08 + math.cos(tilt) * length * 0.6),
            rotation=(0, -math.pi / 2 + tilt, a),
        )

    # Three flowers on straight stems
    for i, (a, h) in enumerate([(0.3, 0.82), (2.4, 0.7), (4.3, 0.76)]):
        x, y = math.cos(a) * 0.06, math.sin(a) * 0.06
        base = pot_h + 0.03
        cylinder(f"Stem_{i}", stem, 0.008, h - base, (x, y, (h + base) / 2), vertices=5)
        blob(f"Centre_{i}", centre, (0.025, 0.025, 0.018), (x, y, h + 0.01))
        for p in range(5):
            pa = p / 5 * math.tau + i
            blob(
                f"Petal_{i}_{p}",
                petal,
                (0.04, 0.022, 0.008),
                (x + math.cos(pa) * 0.035, y + math.sin(pa) * 0.035, h),
                rotation=(0, -0.25, pa),
            )
        blob(f"StemLeaf_{i}", leaf_a, (0.06, 0.022, 0.006), (x + math.cos(a) * 0.04, y + math.sin(a) * 0.04, h * 0.7), rotation=(0, -0.5, a))


# --- Floor lamp (about 1.5 m tall) -----------------------------------------------------------
def build_lamp():
    metal = material("Lamp Metal", "#2f343b", roughness=0.4, metallic=0.8)
    brass = material("Lamp Brass", "#c9a15a", roughness=0.35, metallic=0.9)
    shade = material("Shade", "#f3e2bd", roughness=0.9, emission=0.6)
    bulb = material("Bulb", "#ffe6a3", roughness=0.3, emission=4.0)

    cylinder("Base", metal, 0.17, 0.035, (0, 0, 0.0175), vertices=12)
    cylinder("Base Top", brass, 0.06, 0.03, (0, 0, 0.05), vertices=8)
    cylinder("Pole", metal, 0.014, 1.3, (0, 0, 0.7), vertices=6)
    cylinder("Collar", brass, 0.025, 0.04, (0, 0, 1.18), vertices=8)
    cylinder("Shade", shade, 0.24, 0.3, (0, 0, 1.33), vertices=8, radius2=0.13)
    cylinder("Shade Top", brass, 0.135, 0.015, (0, 0, 1.485), vertices=8)
    blob("Bulb", bulb, (0.05, 0.05, 0.06), (0, 0, 1.25))


reset()
build_plant()
export("Plant", os.path.join(OUT_DIR, "plant.glb"))
if PREVIEW_DIR:
    preview(os.path.join(PREVIEW_DIR, "plant.png"), 0.4, 1.6)

reset()
build_lamp()
export("FloorLamp", os.path.join(OUT_DIR, "floor_lamp.glb"))
if PREVIEW_DIR:
    preview(os.path.join(PREVIEW_DIR, "floor_lamp.png"), 0.75, 2.6)
