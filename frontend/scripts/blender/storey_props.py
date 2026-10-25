"""Low-poly door and wooden sign for the back wall of each storey in the house view.

Run: flatpak run org.blender.Blender -b -P frontend/scripts/blender/storey_props.py -- <out_dir> [preview_dir]
Writes <out_dir>/door.glb and <out_dir>/sign.glb.

Origin = centre of the door leaf / sign board, with the back face on the wall (Blender y = 0).
Everything sticks out towards Blender -Y, which the glTF exporter turns into three.js +Z.
Door: 0.5 x 1.0 m leaf (a real door's 1:2). Sign: 0.62 x 0.2 m board. The app scales them to fit.

Material names are read by the app, which recolours them per house:
  Door, DoorPanel -> house door colour, Frame -> house edge colour.
The sign's carved lettering is a canvas texture laid over the board in the app.
"""

import math
import os
import sys

import bmesh
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


def box(name, mat, size, location, chamfer=0.0):
    """size/location as (x, depth, z). Front faces -Y."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    bevel(obj, chamfer)
    return obj


def cylinder(name, mat, radius, depth, location, rotation=(0, 0, 0), vertices=8):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def clipped_board(name, mat, width, depth, height, corner, location, chamfer):
    """Box with its four corners cut off at 45 degrees, like a sawn sign plank."""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co.x *= width
        v.co.y *= depth
        v.co.z *= height
    # The edges running front-to-back sit at the four corners of the outline.
    corner_edges = [e for e in bm.edges if abs(e.verts[0].co.y - e.verts[1].co.y) > depth * 0.5]
    bmesh.ops.bevel(bm, geom=corner_edges, offset=corner, segments=1, affect="EDGES", profile=0.5)
    bm.to_mesh(mesh)
    bm.free()
    obj.location = location
    obj.data.materials.append(mat)
    bevel(obj, chamfer)
    return obj


def export(name, path):
    """Flat-shade, join everything in the scene into one object and write a GLB."""
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
    scene.render.resolution_x = 800
    scene.render.resolution_y = 800
    world = bpy.data.worlds.new("World")
    world.color = (0.05, 0.07, 0.12)
    scene.world = world
    # A wall behind the prop, so depth and shadows read.
    bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0.001, target_z), rotation=(math.radians(90), 0, 0))
    bpy.context.object.data.materials.append(material("Wall", "#d9cbb4"))
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(55), math.radians(-25), math.radians(-20)))
    bpy.context.object.data.energy = 4
    bpy.ops.object.camera_add(location=(distance * 0.45, -distance, target_z + distance * 0.25))
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


# --- Door: framed leaf with a lit window, two raised panels, lever handle --------------------
DOOR_W = 0.5
DOOR_H = 1.0


def build_door():
    leaf = material("Door", "#8a5a3c", roughness=0.7)
    panel = material("DoorPanel", "#7a4e33", roughness=0.7)
    frame = material("Frame", "#5b3d2a", roughness=0.75)
    glass = material("Glass", "#ffd98a", roughness=0.2, emission=1.2)
    brass = material("Brass", "#c9a15a", roughness=0.35, metallic=0.9)
    iron = material("Iron", "#2f343b", roughness=0.5, metallic=0.7)
    stone = material("Stone", "#9a958c", roughness=0.95)

    w, h = DOOR_W, DOOR_H
    top = h / 2

    # Leaf, sitting a little behind the frame
    box("Leaf", leaf, (w, 0.03, h), (0, -0.015, 0), chamfer=0.006)

    # Frame: two jambs, a lintel and a small cornice on top
    jamb = 0.06
    for side in (-1, 1):
        box(f"Jamb_{side}", frame, (jamb, 0.05, h + jamb), (side * (w / 2 + jamb / 2), -0.025, jamb / 2), chamfer=0.008)
    box("Lintel", frame, (w + 2 * jamb, 0.05, jamb), (0, -0.025, top + jamb / 2), chamfer=0.008)
    box("Cornice", frame, (w + 2 * jamb + 0.06, 0.075, 0.025), (0, -0.0375, top + jamb + 0.0125), chamfer=0.006)

    # Window in the upper part: glowing glass behind a cross of muntins
    win_w, win_h, win_z = w * 0.56, 0.2, top - 0.2
    box("Glass", glass, (win_w, 0.004, win_h), (0, -0.031, win_z))
    rail = 0.025
    for side in (-1, 1):
        box(f"WinSide_{side}", panel, (rail, 0.014, win_h + 2 * rail), (side * (win_w / 2 + rail / 2), -0.035, win_z), chamfer=0.004)
        box(f"WinRail_{side}", panel, (win_w, 0.014, rail), (0, -0.035, win_z + side * (win_h / 2 + rail / 2)), chamfer=0.004)
    box("MuntinV", panel, (0.012, 0.01, win_h), (0, -0.034, win_z))
    box("MuntinH", panel, (win_w, 0.01, 0.012), (0, -0.034, win_z))

    # Two tall raised panels below, chamfered so they read as carved
    panel_w, panel_h = w * 0.28, 0.5
    panel_z = -top + 0.08 + panel_h / 2
    for side in (-1, 1):
        box(f"Panel_{side}", panel, (panel_w, 0.018, panel_h), (side * w * 0.18, -0.031, panel_z), chamfer=0.009)

    # Lever handle on a brass backplate, with a keyhole
    hx, hz = w / 2 - 0.05, -0.02
    box("Backplate", brass, (0.032, 0.008, 0.12), (hx, -0.034, hz), chamfer=0.003)
    cylinder("Spindle", brass, 0.008, 0.025, (hx, -0.048, hz + 0.025), rotation=(math.radians(90), 0, 0), vertices=6)
    cylinder("Lever", brass, 0.009, 0.075, (hx - 0.03, -0.06, hz + 0.025), rotation=(0, math.radians(90), 0), vertices=6)
    box("Keyhole", iron, (0.008, 0.004, 0.02), (hx, -0.039, hz - 0.03))

    # Iron hinges on the left
    for z in (top - 0.15, -top + 0.15):
        box(f"Hinge_{z:.2f}", iron, (0.08, 0.006, 0.03), (-w / 2 + 0.04, -0.033, z), chamfer=0.002)
        cylinder(f"HingePin_{z:.2f}", iron, 0.009, 0.05, (-w / 2 - 0.004, -0.03, z), vertices=6)

    # Stone doorstep across the gap below the door
    box("Step", stone, (w + 2 * jamb + 0.04, 0.1, 0.02), (0, -0.05, -top - 0.01), chamfer=0.005)


# --- Wooden sign: plank with sawn-off corners, nailed to the wall ----------------------------
SIGN_W = 0.62
SIGN_H = 0.2
SIGN_D = 0.03


def build_sign():
    wood = material("SignWood", "#c99a62", roughness=0.85)
    nail = material("Nail", "#3a3530", roughness=0.4, metallic=0.8)

    clipped_board("Board", wood, SIGN_W, SIGN_D, SIGN_H, 0.03, (0, -SIGN_D / 2, 0), chamfer=0.006)
    for side in (-1, 1):
        cylinder(
            f"Nail_{side}",
            nail,
            0.009,
            0.006,
            (side * (SIGN_W / 2 - 0.032), -SIGN_D - 0.003, 0),
            rotation=(math.radians(90), 0, 0),
            vertices=6,
        )


reset()
build_door()
export("Door", os.path.join(OUT_DIR, "door.glb"))
if PREVIEW_DIR:
    preview(os.path.join(PREVIEW_DIR, "door.png"), 0.0, 2.2)

reset()
build_sign()
export("Sign", os.path.join(OUT_DIR, "sign.glb"))
if PREVIEW_DIR:
    preview(os.path.join(PREVIEW_DIR, "sign.png"), 0.0, 0.9)
