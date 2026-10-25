"""Low-poly decoration standing by the back wall of each storey in the house view.

Run: flatpak run org.blender.Blender -b -P frontend/scripts/blender/storey_decor.py -- <out_dir> [preview_dir]
Writes <out_dir>/<kind>.glb for flowerPot, lamp, bench and vine.

Origin = on the floor, horizontally centred, with the back of the prop on the wall (Blender y = 0).
Everything sticks out towards Blender -Y, which the glTF exporter turns into three.js +Z.
Sizes are real metres for a 1.4-1.6 m storey; the app places them as they are.

Material names are read by the app, which recolours them per house:
  Accent -> house colour, AccentDark -> a darker shade of it. Shade and Bulb glow brighter on hover.
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
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*srgb(hex_color), 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*srgb(hex_color), 1)
        bsdf.inputs["Emission Strength"].default_value = emission
    return m


def bevel(obj, width):
    """Chamfer every edge once: cheap, but catches the light like real joinery."""
    if width <= 0:
        return
    mod = obj.modifiers.new("Bevel", "BEVEL")
    mod.width = width
    mod.segments = 1
    mod.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)


def box(name, mat, size, location, chamfer=0.0, rotation=(0, 0, 0)):
    """size/location as (x, depth, z). Front faces -Y."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    bevel(obj, chamfer)
    return obj


def cylinder(name, mat, radius, depth, location, rotation=(0, 0, 0), vertices=8, radius2=None):
    if radius2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    else:
        bpy.ops.mesh.primitive_cone_add(
            vertices=vertices, radius1=radius, radius2=radius2, depth=depth, location=location, rotation=rotation
        )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def blob(name, mat, scale, location, rotation=(0, 0, 0)):
    """Squashed icosphere: leaves, petals, foliage."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    return obj


def rod(name, mat, start, end, radius, vertices=5):
    """Thin cylinder from start to end (stems, vine tendrils)."""
    sx, sy, sz = start
    ex, ey, ez = end
    dx, dy, dz = ex - sx, ey - sy, ez - sz
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=length, location=((sx + ex) / 2, (sy + ey) / 2, (sz + ez) / 2)
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "XYZ"
    # Tilt +Z about X (towards -Y), then turn about Z so it points along (dx, dy, dz).
    obj.rotation_euler = (math.acos(dz / length), 0, math.atan2(dx, -dy))
    obj.data.materials.append(mat)
    return obj


def flower(name, mat_petal, mat_centre, location, radius, facing=(0, 0, 0), petals=5):
    """Flat ring of petals around a round centre, tilted by `facing` (x, y, z Euler)."""
    x, y, z = location
    cx, _, cz = facing
    for i in range(petals):
        a = i / petals * math.tau
        # Petals laid in the flower's local XY plane, then tilted with the head.
        px, py = math.cos(a) * radius, math.sin(a) * radius
        # Tilt about X: y' = y cos - z sin, z' = y sin (z=0 here)
        py2, pz2 = py * math.cos(cx), py * math.sin(cx)
        # Then about Z
        px3 = px * math.cos(cz) - py2 * math.sin(cz)
        py3 = px * math.sin(cz) + py2 * math.cos(cz)
        blob(f"{name}_Petal_{i}", mat_petal, (radius * 0.9, radius * 0.55, radius * 0.18), (x + px3, y + py3, z + pz2), rotation=(cx, 0, cz + a))
    blob(f"{name}_Centre", mat_centre, (radius * 0.5, radius * 0.5, radius * 0.35), location, rotation=(cx, 0, cz))


def export(name, path):
    """Flat-shade, join everything into one object and write a GLB."""
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_flat()
    bpy.ops.object.join()
    bpy.context.object.name = name
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=False, export_apply=True)
    print("exported", path)


def preview(path, target_z, distance):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 600
    scene.render.resolution_y = 600
    world = bpy.data.worlds.new("World")
    world.color = (0.05, 0.07, 0.12)
    scene.world = world
    # Wall and floor behind the prop, so depth and shadows read.
    bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0.001, 2), rotation=(math.radians(90), 0, 0))
    bpy.context.object.data.materials.append(material("PreviewWall", "#3d4a6b"))
    bpy.ops.mesh.primitive_plane_add(size=4, location=(0, -2, 0))
    bpy.context.object.data.materials.append(material("PreviewFloor", "#2b3550"))
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(55), math.radians(-25), math.radians(-20)))
    bpy.context.object.data.energy = 4
    bpy.ops.object.camera_add(location=(distance * 0.45, -distance, target_z + distance * 0.3))
    cam = bpy.context.object
    target = bpy.data.objects.new("Target", None)
    target.location = (0, -0.1, target_z)
    scene.collection.objects.link(target)
    cam.constraints.new("TRACK_TO").target = target
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def accent():
    return material("Accent", "#4a7fd6", roughness=0.65), material("AccentDark", "#335a9c", roughness=0.7)


# --- Potted plant: tapered pot with a rim, a fan of leaves and three flowers (~0.48 m) ---------
def build_flower_pot():
    random.seed(7)
    pot, rim = accent()
    soil = material("Soil", "#3b2a1e", roughness=0.95)
    leaf_a = material("LeafA", "#4f9a4a", roughness=0.7)
    leaf_b = material("LeafB", "#3d7f3e", roughness=0.7)
    stem = material("Stem", "#4a6b2f", roughness=0.8)
    petal = material("Petal", "#f6a5c0", roughness=0.6)
    centre = material("FlowerCentre", "#ffd25a", roughness=0.5)

    cy = -0.14
    pot_h = 0.2
    cylinder("Pot", pot, 0.085, pot_h, (0, cy, pot_h / 2), vertices=10, radius2=0.115)
    cylinder("Rim", rim, 0.125, 0.035, (0, cy, pot_h + 0.005), vertices=10)
    cylinder("Soil", soil, 0.108, 0.01, (0, cy, pot_h + 0.022), vertices=10)
    cylinder("Saucer", rim, 0.1, 0.015, (0, cy, 0.0075), vertices=10)

    # Leaves fan out from the soil, leaning outwards
    for i in range(11):
        a = i / 11 * math.tau + random.uniform(-0.2, 0.2)
        length = random.uniform(0.09, 0.13)
        lean = random.uniform(0.5, 0.9)
        r = length * 0.7
        blob(
            f"Leaf_{i}",
            leaf_a if i % 2 else leaf_b,
            (length, 0.035, 0.008),
            (math.cos(a) * r, cy + math.sin(a) * r, pot_h + 0.04 + math.cos(lean) * length * 0.5),
            rotation=(0, -lean, a),
        )

    # Three flowers on stems, heads turned towards the room
    for i, (a, h) in enumerate([(0.4, 0.46), (2.5, 0.4), (4.4, 0.43)]):
        x, y = math.cos(a) * 0.045, cy + math.sin(a) * 0.035
        base = pot_h + 0.02
        rod(f"Stem_{i}", stem, (x * 0.4, cy + (y - cy) * 0.4, base), (x, y, h), 0.006)
        flower(f"Flower_{i}", petal, centre, (x, y - 0.005, h + 0.01), 0.032, facing=(math.radians(55), 0, a * 0.15))


# --- Side table with a table lamp: round pedestal table, ceramic base, glowing shade (~0.66 m) ---
def build_lamp():
    body, _ = accent()
    wood = material("Wood", "#8a5a3c", roughness=0.7)
    wood_dark = material("WoodDark", "#6b4430", roughness=0.75)
    brass = material("Brass", "#c9a15a", roughness=0.35, metallic=0.9)
    shade = material("Shade", "#ffe2b0", roughness=0.8, emission=0.6)
    bulb = material("Bulb", "#fff3d0", roughness=0.3, emission=3.0)

    cy = -0.15
    top = 0.32
    cylinder("Foot", wood_dark, 0.1, 0.025, (0, cy, 0.0125), vertices=10)
    cylinder("Column", wood, 0.022, top - 0.025, (0, cy, (top + 0.025) / 2 - 0.0125), vertices=8)
    cylinder("Collar", wood_dark, 0.04, 0.03, (0, cy, top - 0.04), vertices=8)
    cylinder("Top", wood, 0.14, 0.025, (0, cy, top - 0.0125), vertices=12)
    cylinder("TopEdge", wood_dark, 0.145, 0.008, (0, cy, top - 0.026), vertices=12)

    # Lamp: brass plinth, bulbous ceramic body in the house colour, brass stem
    z = top
    cylinder("LampPlinth", brass, 0.05, 0.015, (0, cy, z + 0.0075), vertices=10)
    cylinder("LampBodyLow", body, 0.045, 0.06, (0, cy, z + 0.045), vertices=10, radius2=0.06)
    cylinder("LampBodyHigh", body, 0.06, 0.07, (0, cy, z + 0.11), vertices=10, radius2=0.022)
    cylinder("LampStem", brass, 0.007, 0.08, (0, cy, z + 0.185), vertices=6)
    blob("Bulb", bulb, (0.028, 0.028, 0.034), (0, cy, z + 0.235))
    # Open-ended conical shade (a cone with its caps removed would need bmesh; a thin cone reads fine)
    cylinder("Shade", shade, 0.115, 0.12, (0, cy, z + 0.25), vertices=12, radius2=0.07)
    cylinder("ShadeTrim", brass, 0.117, 0.008, (0, cy, z + 0.19), vertices=12)

    # A small book on the table, for scale
    box("Book", material("Book", "#b8453a", roughness=0.8), (0.09, 0.065, 0.018), (0.075, cy + 0.03, top + 0.009), chamfer=0.002, rotation=(0, 0, 0.35))


# --- Park bench: slatted seat and back in the house colour, cast-iron sides (~0.5 m wide) -------
def build_bench():
    slat, _ = accent()
    iron = material("Iron", "#2f343b", roughness=0.5, metallic=0.7)

    w = 0.5
    seat_z = 0.2
    side_x = w / 2 - 0.04
    for side in (-1, 1):
        x = side * side_x
        # Front leg, taller back leg leaning against the wall, seat rail, armrest
        box(f"FrontLeg_{side}", iron, (0.025, 0.025, seat_z), (x, -0.2, seat_z / 2), chamfer=0.004)
        box(f"BackLeg_{side}", iron, (0.025, 0.025, 0.42), (x, -0.035, 0.21), chamfer=0.004, rotation=(math.radians(-6), 0, 0))
        box(f"SeatRail_{side}", iron, (0.025, 0.19, 0.022), (x, -0.115, seat_z - 0.02), chamfer=0.004)
        box(f"Arm_{side}", iron, (0.03, 0.2, 0.018), (x, -0.12, seat_z + 0.1), chamfer=0.004)
        box(f"ArmPost_{side}", iron, (0.02, 0.02, 0.1), (x, -0.205, seat_z + 0.05), chamfer=0.003)
        cylinder(f"Foot_{side}", iron, 0.018, 0.012, (x, -0.2, 0.006), vertices=6)
    box("Stretcher", iron, (2 * side_x, 0.02, 0.02), (0, -0.115, 0.07), chamfer=0.003)

    # Seat slats, slightly gapped
    for i, y in enumerate((-0.05, -0.095, -0.14, -0.185)):
        box(f"SeatSlat_{i}", slat, (w, 0.038, 0.022), (0, y, seat_z + 0.011), chamfer=0.005)
    # Back slats, leaning back with the back legs
    for i, z in enumerate((seat_z + 0.08, seat_z + 0.135, seat_z + 0.19)):
        lean_y = -0.045 + (z - 0.21) * math.tan(math.radians(6))
        box(f"BackSlat_{i}", slat, (w, 0.02, 0.04), (0, lean_y, z), chamfer=0.005, rotation=(math.radians(-6), 0, 0))


# --- Climbing vine: planter box with a trellis on the wall and leafy tendrils (~0.75 m) --------
def build_vine():
    random.seed(11)
    box_mat, trim = accent()
    soil = material("Soil", "#3b2a1e", roughness=0.95)
    wood = material("Trellis", "#a8825a", roughness=0.8)
    stem = material("Stem", "#4a6b2f", roughness=0.8)
    leaf_a = material("LeafA", "#4f9a4a", roughness=0.7)
    leaf_b = material("LeafB", "#3d7f3e", roughness=0.7)
    petal = material("Petal", "#f6e27a", roughness=0.6)
    centre = material("FlowerCentre", "#e07b39", roughness=0.5)

    # Planter
    pw, pd, ph = 0.34, 0.13, 0.15
    py = -0.02 - pd / 2
    box("Planter", box_mat, (pw, pd, ph), (0, py, ph / 2), chamfer=0.008)
    box("PlanterTrim", trim, (pw + 0.02, pd + 0.02, 0.025), (0, py, ph - 0.005), chamfer=0.005)
    for side in (-1, 1):
        box(f"PlanterFoot_{side}", trim, (0.04, pd - 0.02, 0.02), (side * (pw / 2 - 0.04), py, 0.01))
    box("PlanterSoil", soil, (pw - 0.03, pd - 0.03, 0.01), (0, py, ph + 0.005))

    # Trellis: three uprights and three rungs, on small standoffs from the wall
    top = 0.78
    for i, x in enumerate((-0.12, 0.0, 0.12)):
        box(f"Upright_{i}", wood, (0.018, 0.014, top - 0.1), (x, -0.018, 0.1 + (top - 0.1) / 2), chamfer=0.003)
    for i, z in enumerate((0.33, 0.52, 0.71)):
        box(f"Rung_{i}", wood, (0.3, 0.012, 0.016), (0, -0.03, z), chamfer=0.003)

    # Two tendrils winding up the trellis, with leaves along them
    leaves = 0
    for t, (x0, phase) in enumerate(((-0.07, 0.0), (0.07, 1.7))):
        pts = []
        for k in range(9):
            z = ph + 0.01 + k * (top - ph) / 8.5
            x = x0 + math.sin(phase + k * 0.9) * 0.07
            y = -0.04 - 0.012 * math.cos(phase + k * 0.9)
            pts.append((x, y, z))
        for k in range(len(pts) - 1):
            rod(f"Tendril_{t}_{k}", stem, pts[k], pts[k + 1], 0.006)
        for k, (x, y, z) in enumerate(pts[1:], start=1):
            for side in (-1, 1):
                a = side * random.uniform(0.5, 1.1)
                size = random.uniform(0.03, 0.045) * (1.1 - k * 0.04)
                blob(
                    f"Leaf_{leaves}",
                    leaf_a if leaves % 2 else leaf_b,
                    (size, 0.008, size * 0.7),
                    (x + side * size * 0.8, y - 0.012, z + random.uniform(-0.02, 0.02)),
                    rotation=(math.radians(random.uniform(-25, -10)), a, 0),
                )
                leaves += 1
        # A flower near the top of each tendril, and one lower down
        for k in (4, 7):
            x, y, z = pts[k]
            flower(f"Flower_{t}_{k}", petal, centre, (x, y - 0.03, z + 0.02), 0.022, facing=(math.radians(80), 0, 0))

    # Some leaves spilling over the planter's front edge
    for i in range(7):
        x = -pw / 2 + 0.03 + i * (pw - 0.06) / 6
        blob(
            f"Spill_{i}",
            leaf_a if i % 2 else leaf_b,
            (0.035, 0.03, 0.01),
            (x, py - pd / 2 - 0.005, ph - 0.005 + random.uniform(-0.01, 0.01)),
            rotation=(math.radians(-60), 0, random.uniform(-0.4, 0.4)),
        )


BUILDERS = {
    "flowerPot": (build_flower_pot, 0.25, 1.1),
    "lamp": (build_lamp, 0.33, 1.4),
    "bench": (build_bench, 0.2, 1.2),
    "vine": (build_vine, 0.4, 1.6),
}

for kind, (build, target_z, distance) in BUILDERS.items():
    reset()
    build()
    export(kind, os.path.join(OUT_DIR, f"{kind}.glb"))
    if PREVIEW_DIR:
        preview(os.path.join(PREVIEW_DIR, f"{kind}.png"), target_z, distance)
