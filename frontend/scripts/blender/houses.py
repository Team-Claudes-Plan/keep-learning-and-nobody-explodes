"""Stackable low-poly house kits for the city, one per topic.

Run: flatpak run org.blender.Blender -b -P frontend/scripts/blender/houses.py -- <out_dir> [preview_prefix]
Writes <out_dir>/<topic>.glb for every kit below.

Each kit has three modules, exported as separate root nodes with glTF extras:
  base   - ground storey with the entrance           (extras: module="base",   height)
  middle - one repeatable storey, stacked as needed  (extras: module="middle", height)
  top    - roof crown with the topic's landmark      (extras: module="top")
Every module's origin is the centre of its footprint at floor level. Features that run
through storeys (pipes, the DNA helix, pilasters) start and end at the same place, so
modules line up when stacked, even when scaled vertically to a storey's height.

Blender is Z-up; the glTF exporter turns that into three.js Y-up. The city camera looks
from three (+X, +Y, +Z), which is Blender (+X, -Y, +Z): the front (-Y) and right (+X)
faces are the visible ones, so entrances and landmarks face that way.
"""

import math
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT_DIR = args[0] if args else "."
PREVIEW = args[1] if len(args) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)

BASE_H = 1.6
MIDDLE_H = 1.5


# ---------------------------------------------------------------------------
# Materials


def srgb(hex_color):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    h = hex_color.lstrip("#")
    return tuple(lin(int(h[i : i + 2], 16)) for i in (0, 2, 4))


_materials = {}


def mat(hex_color, roughness=0.75, metallic=0.0, emission=0.0, alpha=1.0):
    key = (hex_color, roughness, metallic, emission, alpha)
    if key in _materials:
        return _materials[key]
    m = bpy.data.materials.new(f"{hex_color}_{len(_materials)}")
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*srgb(hex_color), 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*srgb(hex_color), 1)
        bsdf.inputs["Emission Strength"].default_value = emission
    if alpha < 1:
        bsdf.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    _materials[key] = m
    return m


# ---------------------------------------------------------------------------
# Geometry helpers: one bmesh per module, one material slot per colour.


def trs(loc, rot=(0, 0, 0), scale=(1, 1, 1)):
    return (
        Matrix.Translation(Vector(loc))
        @ Euler(rot, "XYZ").to_matrix().to_4x4()
        @ Matrix.Diagonal((*scale, 1))
    )


class Module:
    def __init__(self, kit, kind, height=None, footprint=None):
        self.name = f"{kit}_{kind}"
        self.kind = kind
        self.height = height
        self.footprint = footprint
        self.bm = bmesh.new()
        self.mats = []
        self.parts = []
        self.pivot = None
        self.anim = None

    def part(self, name, pivot, anim, axis=(0, 0, 1), **params):
        """A moving piece, exported as a child object that the frontend animates (see KitFacade).

        Build it in module coordinates like anything else. It turns or scales around `pivot`.
        anim: "spin" (speed rad/s), "swing" (amplitude rad, speed rad/s), "wobble" (amplitude rad)
        or "blink" (squashes vertically now and then). `axis` is in Blender coordinates.
        """
        part = Module(self.name, name)
        part.pivot = Vector(pivot)
        a = Vector(axis).normalized()
        part.anim = {"anim": anim, "axis": [a.x, a.z, -a.y], **params}  # glTF is Y-up
        self.parts.append(part)
        return part

    def _paint(self, verts, material):
        if material not in self.mats:
            self.mats.append(material)
        index = self.mats.index(material)
        for face in {f for v in verts for f in v.link_faces}:
            face.material_index = index

    def box(self, size, loc, material, rot=(0, 0, 0)):
        result = bmesh.ops.create_cube(self.bm, size=1.0, matrix=trs(loc, rot, size))
        self._paint(result["verts"], material)

    def box_m(self, matrix, material):
        result = bmesh.ops.create_cube(self.bm, size=1.0, matrix=matrix)
        self._paint(result["verts"], material)

    def cyl(self, r, h, loc, material, seg=8, rot=(0, 0, 0), r2=None, matrix=None):
        m = matrix if matrix is not None else trs(loc, rot)
        result = bmesh.ops.create_cone(
            self.bm,
            cap_ends=True,
            cap_tris=False,
            segments=seg,
            radius1=r,
            radius2=r if r2 is None else r2,
            depth=h,
            matrix=m,
        )
        self._paint(result["verts"], material)

    def ico(self, r, loc, material, sub=1, scale=(1, 1, 1), rot=(0, 0, 0)):
        result = bmesh.ops.create_icosphere(self.bm, subdivisions=sub, radius=r, matrix=trs(loc, rot, scale))
        self._paint(result["verts"], material)
        return result["verts"]

    def sphere(self, r, loc, material, seg=8, rings=6, scale=(1, 1, 1)):
        result = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=r, matrix=trs(loc, (0, 0, 0), scale))
        self._paint(result["verts"], material)

    def prism(self, front, back, material):
        """Closed solid between two matching polygons."""
        vf = [self.bm.verts.new(p) for p in front]
        vb = [self.bm.verts.new(p) for p in back]
        n = len(vf)
        self.bm.faces.new(vf)
        self.bm.faces.new(list(reversed(vb)))
        for i in range(n):
            j = (i + 1) % n
            self.bm.faces.new((vf[i], vb[i], vb[j], vf[j]))
        self._paint(vf + vb, material)

    def extrude_y(self, profile_xz, y0, y1, material):
        """Profile in the XZ plane, extruded along Y."""
        self.prism([(x, y0, z) for x, z in profile_xz], [(x, y1, z) for x, z in profile_xz], material)

    def extrude_x(self, profile_yz, x0, x1, material):
        self.prism([(x0, y, z) for y, z in profile_yz], [(x1, y, z) for y, z in profile_yz], material)

    def tube(self, points, r, material, sides=6, closed=False):
        rings = []
        count = len(points)
        for i, p in enumerate(points):
            if closed:
                a, b = points[i - 1], points[(i + 1) % count]
            else:
                a, b = points[max(i - 1, 0)], points[min(i + 1, count - 1)]
            tangent = (Vector(b) - Vector(a)).normalized()
            ref = Vector((0, 0, 1)) if abs(tangent.z) < 0.9 else Vector((1, 0, 0))
            normal = tangent.cross(ref).normalized()
            binormal = tangent.cross(normal)
            ring = []
            for s in range(sides):
                angle = 2 * math.pi * s / sides
                ring.append(self.bm.verts.new(Vector(p) + r * (math.cos(angle) * normal + math.sin(angle) * binormal)))
            rings.append(ring)
        segments = count if closed else count - 1
        for i in range(segments):
            ra, rb = rings[i], rings[(i + 1) % count]
            for s in range(sides):
                t = (s + 1) % sides
                self.bm.faces.new((ra[s], ra[t], rb[t], rb[s]))
        if not closed:
            self.bm.faces.new(rings[0])
            self.bm.faces.new(list(reversed(rings[-1])))
        self._paint([v for ring in rings for v in ring], material)

    def build(self):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        if self.pivot is not None:
            bmesh.ops.translate(self.bm, vec=-self.pivot, verts=self.bm.verts)
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for material in self.mats:
            mesh.materials.append(material)
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        if self.anim is not None:
            obj.location = self.pivot
            for key, value in self.anim.items():
                obj[key] = value
        else:
            obj["module"] = self.kind
        if self.height is not None:
            obj["height"] = self.height
        if self.footprint is not None:
            obj["footprint"] = list(self.footprint)
        for part in self.parts:
            part.build().parent = obj
        return obj


class Face:
    """One vertical wall face. u runs along the wall, out points away from the building."""

    def __init__(self, center, tangent, length):
        self.c = Vector((*center, 0))
        self.t = Vector((*tangent, 0))
        self.n = Vector((tangent[1], -tangent[0], 0))
        self.length = length
        # Proper rotation (det +1): local X = tangent, local Y = inward, local Z = up.
        self.rot = Matrix((self.t, -self.n, Vector((0, 0, 1)))).transposed().to_4x4()

    def at(self, u, z, out=0.0):
        return self.c + self.t * u + self.n * out + Vector((0, 0, z))

    def box(self, mod, u, z, su, sz, depth, material, out=0.0):
        mod.box_m(Matrix.Translation(self.at(u, z, out)) @ self.rot @ Matrix.Diagonal((su, depth, sz, 1)), material)

    def disc(self, mod, u, z, r, depth, material, out=0.0, seg=12):
        m = Matrix.Translation(self.at(u, z, out)) @ self.rot @ Euler((math.pi / 2, 0, 0)).to_matrix().to_4x4()
        mod.cyl(r, depth, None, material, seg=seg, matrix=m)

    def shape(self, mod, profile_uz, u, z, depth, material, out=0.0):
        """Flat polygon (in wall coordinates) extruded out of the wall."""
        front = [self.at(u + pu, z + pz, out + depth / 2) for pu, pz in profile_uz]
        back = [self.at(u + pu, z + pz, out - depth / 2) for pu, pz in profile_uz]
        mod.prism(front, back, material)


def rect_faces(w, d, cx=0.0, cy=0.0):
    return {
        "front": Face((cx, cy - d / 2), (1, 0), w),
        "right": Face((cx + w / 2, cy), (0, 1), d),
        "back": Face((cx, cy + d / 2), (-1, 0), w),
        "left": Face((cx - w / 2, cy), (0, -1), d),
    }


def ngon(radius, count, start=math.pi / 2, inner=None):
    points = []
    steps = count * 2 if inner else count
    for i in range(steps):
        angle = start + 2 * math.pi * i / steps
        r = inner if inner and i % 2 else radius
        points.append((r * math.cos(angle), r * math.sin(angle)))
    return points


def arched_window(mod, face, u, z0, width, height, frame, glass, sill=None):
    """Window with a round top: bottom edge at z0, total height includes the arch."""
    rect_h = height - width / 2
    face.box(mod, u, z0 + rect_h / 2, width + 0.1, rect_h + 0.06, 0.06, frame)
    face.disc(mod, u, z0 + rect_h, width / 2 + 0.05, 0.06, frame, seg=10)
    face.box(mod, u, z0 + rect_h / 2, width, rect_h, 0.04, glass, out=0.012)
    face.disc(mod, u, z0 + rect_h, width / 2, 0.04, glass, out=0.012, seg=10)
    if sill:
        face.box(mod, u, z0 - 0.03, width + 0.18, 0.05, 0.12, sill, out=0.03)


def square_window(mod, face, u, zc, width, height, frame, glass, mullion=True):
    face.box(mod, u, zc, width + 0.1, height + 0.1, 0.06, frame)
    face.box(mod, u, zc, width, height, 0.04, glass, out=0.012)
    if mullion:
        face.box(mod, u, zc, 0.035, height, 0.05, frame, out=0.014)
        face.box(mod, u, zc, width, 0.035, 0.05, frame, out=0.014)


def corners(w, d):
    return [(sx * w / 2, sy * d / 2) for sx in (-1, 1) for sy in (-1, 1)]


# ---------------------------------------------------------------------------
# MATH: a classical academy in Prussian blue and cream, crowned by a
# 3D surface plot turning on a pedestal, surrounded by geometric solids.


def build_math():
    W, D = 2.4, 2.4
    BLUE = mat("#2d5e9f", 0.8)
    BLUE_D = mat("#203f6b", 0.8)
    CREAM = mat("#efe6d2", 0.85)
    STONE = mat("#d3c7ab", 0.9)
    GOLD = mat("#e8b84a", 0.35, 0.6)
    GLASS = mat("#9fd3ff", 0.2, 0.0, emission=0.55)
    DOOR = mat("#6a3f2a", 0.8)
    ROOF = mat("#263550", 0.7)
    RED = mat("#ff5f6d", 0.6)
    AMBER = mat("#ffb347", 0.6)
    TEAL = mat("#4fd1d1", 0.6)

    def shell(mod, h, z0=0.0):
        mod.box((W, D, h), (0, 0, z0 + h / 2), BLUE)
        for x, y in corners(W, D):
            mod.box((0.2, 0.2, h), (x, y, z0 + h / 2), CREAM)

    # Base -------------------------------------------------------------------
    base = Module("math", "base", BASE_H, (W, D))
    base.box((W + 0.26, D + 0.26, 0.14), (0, 0, 0.07), STONE)
    shell(base, BASE_H - 0.14, 0.14)
    base.box((W + 0.18, D + 0.18, 0.1), (0, 0, BASE_H - 0.05), CREAM)
    base.box((W + 0.06, D + 0.06, 0.06), (0, 0, 0.17), CREAM)
    faces = rect_faces(W, D)

    # Portico: steps, columns, entablature, pediment with a golden pi
    base.box((1.7, 0.55, 0.14), (0, -D / 2 - 0.27, 0.07), STONE)
    base.box((1.3, 0.18, 0.07), (0, -D / 2 - 0.63, 0.035), STONE)
    for u in (-0.66, -0.22, 0.22, 0.66):
        y = -D / 2 - 0.4
        base.box((0.18, 0.18, 0.06), (u, y, 0.17), CREAM)
        base.cyl(0.065, 1.08, (u, y, 0.14 + 0.54 + 0.03), CREAM, seg=8)
        base.box((0.18, 0.18, 0.06), (u, y, 1.22), CREAM)
    base.box((1.8, 0.58, 0.12), (0, -D / 2 - 0.27, 1.31), CREAM)
    ped = [(-0.92, 1.37), (0.92, 1.37), (0, 1.59)]
    base.extrude_y(ped, -D / 2 - 0.58, -D / 2 + 0.02, CREAM)
    pi_y = -D / 2 - 0.6
    base.box((0.28, 0.03, 0.045), (0, pi_y, 1.505), GOLD)
    base.box((0.04, 0.03, 0.12), (-0.07, pi_y, 1.43), GOLD)
    base.box((0.04, 0.03, 0.12), (0.075, pi_y, 1.43), GOLD, rot=(0, -0.25, 0))

    front = faces["front"]
    arched_window(base, front, 0, 0.17, 0.5, 0.92, CREAM, DOOR)
    front.box(base, 0, 0.5, 0.02, 0.6, 0.06, mat("#4d2c1d"), out=0.02)
    front.disc(base, 0.12, 0.5, 0.035, 0.06, GOLD, out=0.03, seg=8)
    for u in (-0.95, 0.95):
        arched_window(base, front, u, 0.5, 0.2, 0.62, CREAM, GLASS)
    for name in ("right", "left", "back"):
        for u in (-0.55, 0.55):
            arched_window(base, faces[name], u, 0.36, 0.34, 0.86, CREAM, GLASS, sill=CREAM)
    base = base.build()

    # Middle -----------------------------------------------------------------
    mid = Module("math", "middle", MIDDLE_H)
    shell(mid, MIDDLE_H)
    mid.box((W + 0.18, D + 0.18, 0.1), (0, 0, MIDDLE_H - 0.05), CREAM)
    mid.box((W + 0.05, D + 0.05, 0.05), (0, 0, 0.27), CREAM)
    mid.box((W + 0.03, D + 0.03, 0.18), (0, 0, MIDDLE_H - 0.19), BLUE_D)
    shapes = ["triangle", "square", "circle"]
    for f_index, face in enumerate(faces.values()):
        for i, u in enumerate((-0.68, 0, 0.68)):
            arched_window(mid, face, u, 0.3, 0.34, 0.78, CREAM, GLASS)
            kind = shapes[(i + f_index) % 3]
            z = MIDDLE_H - 0.19
            if kind == "triangle":
                face.shape(mid, [(-0.08, -0.07), (0.08, -0.07), (0, 0.07)], u, z, 0.04, GOLD, out=0.02)
            elif kind == "square":
                face.box(mid, u, z, 0.13, 0.13, 0.04, GOLD, out=0.02)
            else:
                face.disc(mid, u, z, 0.075, 0.04, GOLD, out=0.02, seg=10)
        for u in (-0.34, 0.34):
            face.box(mid, u, 0.7, 0.08, 0.86, 0.05, BLUE_D, out=0.01)
    mid = mid.build()

    # Top --------------------------------------------------------------------
    top = Module("math", "top")
    top.box((W + 0.22, D + 0.22, 0.14), (0, 0, 0.07), ROOF)
    rail_z = 0.14
    inset = W / 2 + 0.02
    for i in range(9):
        t = -inset + i * (2 * inset / 8)
        for x, y in ((t, -inset), (t, inset), (-inset, t), (inset, t)):
            top.box((0.06, 0.06, 0.2), (x, y, rail_z + 0.1), CREAM)
    for x, y, sx, sy in ((0, -inset, 2 * inset + 0.08, 0.08), (0, inset, 2 * inset + 0.08, 0.08), (-inset, 0, 0.08, 2 * inset + 0.08), (inset, 0, 0.08, 2 * inset + 0.08)):
        top.box((sx, sy, 0.05), (x, y, rail_z + 0.22), CREAM)
    top.cyl(0.62, 0.26, (0, 0, 0.27), CREAM, seg=12)
    top.cyl(0.4, 0.22, (0, 0, 0.51), BLUE, seg=6)
    # 3D plot of the saddle z = x² - y², turning slowly on the pedestal
    plot = top.part("plot", (0, 0, 0.62), "spin", speed=0.3)
    plate_z = 0.67
    plot.box((1.24, 1.24, 0.05), (0, 0, plate_z - 0.025), BLUE_D)
    half, cells, z0, amp = 0.5, 6, 1.06, 0.3

    def saddle(x, y):
        return z0 + amp * (x * x - y * y) / (half * half)

    coords = [-half + 2 * half * i / cells for i in range(cells + 1)]
    grid = [[plot.bm.verts.new((x, y, saddle(x, y))) for y in coords] for x in coords]
    heat = [mat(c, 0.6) for c in ("#3b5bdb", "#22b8cf", "#51cf66", "#fcc419", "#ff6b6b")]
    for material in heat:
        if material not in plot.mats:
            plot.mats.append(material)
    for i in range(cells):
        for j in range(cells):
            face = plot.bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
            level = (face.calc_center_median().z - (z0 - amp)) / (2 * amp)
            face.material_index = plot.mats.index(heat[min(4, int(level * 5))])
    for c in coords:
        plot.tube([(c, y, saddle(c, y) + 0.012) for y in coords], 0.012, CREAM, sides=4)
        plot.tube([(x, c, saddle(x, c) + 0.012) for x in coords], 0.012, CREAM, sides=4)
    plot.sphere(0.06, (0, 0, z0 + 0.02), GOLD, seg=8, rings=5)
    # Axes from the back-left corner, arrow tips in x red, y green, z blue
    o = Vector((-0.6, -0.6, plate_z))
    for direction, length, color in (((1, 0, 0), 1.15, RED), ((0, 1, 0), 1.15, mat("#51cf66", 0.6)), ((0, 0, 1), 0.85, mat("#5aa0ff", 0.6))):
        d = Vector(direction)
        rot = d.to_track_quat("Z", "Y").to_euler()
        plot.cyl(0.02, length, o + d * (length / 2), CREAM, seg=6, rot=rot)
        plot.cyl(0.055, 0.14, o + d * (length + 0.07), color, seg=8, r2=0.0, rot=rot)
    # Solids at the corners
    top.box((0.26, 0.26, 0.26), (-0.75, -0.75, 0.27), RED, rot=(0, 0, 0.4))
    top.cyl(0.17, 0.4, (0.75, 0.75, 0.34), AMBER, seg=10, r2=0.0)
    top.cyl(0.2, 0.3, (-0.75, 0.75, 0.29), TEAL, seg=3, r2=0.0)
    top.ico(0.14, (0.78, -0.72, 0.28), mat("#8f6bff", 0.6), sub=1)
    top = top.build()
    return [base, mid, top]


# ---------------------------------------------------------------------------
# BIOLOGY: a timber cottage base, greenhouse storeys with plants and hanging
# vines, a DNA double helix climbing a notch in the front corner, and a tree on top.


def build_biology():
    W, D = 2.2, 2.8
    N = 0.8  # notch in the front-right corner (+X, -Y) that holds the helix
    WOOD = mat("#a8744a", 0.85)
    WOOD_D = mat("#7d5232", 0.85)
    MOSS = mat("#4f9a58", 0.9)
    GRASS = mat("#63a86a", 0.9)
    WHITE = mat("#f4f7f2", 0.6)
    GLASS = mat("#bff3e0", 0.15, 0.0, emission=0.25, alpha=0.38)
    GLASS_ROOF = mat("#bff3e0", 0.15, 0.0, emission=0.3)
    LEAF = mat("#4fd18b", 0.85)
    LEAF_D = mat("#2f9e63", 0.85)
    LEAF_M = mat("#3d7a4a", 0.85)
    DOOR = mat("#2f9e63", 0.7)
    GOLD = mat("#e8b84a", 0.35, 0.6)
    STRAND_A = mat("#ff8f4f", 0.5, 0.0, emission=0.15)
    STRAND_B = mat("#4f8cff", 0.5, 0.0, emission=0.15)
    RUNGS = [mat("#ffe36e", 0.6), mat("#ff5f6d", 0.6), mat("#4fd18b", 0.6), mat("#c58cff", 0.6)]
    FLOWERS = [mat("#ff5f6d", 0.7), mat("#ffb347", 0.7), mat("#c58cff", 0.7), mat("#ffffff", 0.7)]
    POT = mat("#c8693f", 0.85)

    # L-shaped footprint: a full-width back block and a narrower front block.
    back = (W, D - N, 0.0, N / 2)  # w, d, cx, cy
    front = (W - N, N, -N / 2, -D / 2 + N / 2)
    helix_c = (W / 2 - N / 2, -D / 2 + N / 2)

    def l_box(mod, h, z, material, grow=0.0):
        for w, d, cx, cy in (back, front):
            mod.box((w + grow, d + grow, h), (cx, cy, z + h / 2), material)

    # Faces of the L that the camera can see, plus the hidden ones.
    main_front = Face((front[2], -D / 2), (1, 0), W - N)
    main_right = Face((W / 2, N / 2), (0, 1), D - N)
    back_face = Face((0, D / 2), (-1, 0), W)
    left_face = Face((-W / 2, 0), (0, -1), D)
    notch_front = Face((W / 2 - N / 2, -D / 2 + N), (1, 0), N)
    notch_right = Face((W / 2 - N, -D / 2 + N / 2), (0, 1), N)
    wall_faces = [main_front, main_right, back_face, left_face, notch_front, notch_right]

    def helix(mod, h):
        """One full turn from z=0 to z=h, so stacked modules join up."""
        r = 0.24
        steps = 24
        for phase, material in ((0.0, STRAND_A), (math.pi, STRAND_B)):
            pts = []
            for i in range(steps + 1):
                a = phase + 2 * math.pi * i / steps
                pts.append((helix_c[0] + r * math.cos(a), helix_c[1] + r * math.sin(a), h * i / steps))
            mod.tube(pts, 0.045, material, sides=6)
        for i in range(6):
            a = 2 * math.pi * (i + 0.5) / 6
            z = h * (i + 0.5) / 6
            mid = (helix_c[0], helix_c[1], z)
            mod.box((r * 2, 0.05, 0.05), mid, RUNGS[i % 4], rot=(0, 0, a))

    def vine(mod, x, y, z_top, length, rnd):
        z = z_top
        while z > z_top - length:
            mod.ico(0.055, (x + rnd.uniform(-0.02, 0.02), y, z), rnd.choice([LEAF, LEAF_D]), sub=1)
            z -= 0.09

    rnd = random.Random(11)

    # Base -------------------------------------------------------------------
    base = Module("biology", "base", BASE_H, (W, D))
    l_box(base, 0.12, 0.0, MOSS, grow=0.14)
    l_box(base, BASE_H - 0.22, 0.12, WOOD)
    for z in (0.45, 0.8, 1.15):
        l_box(base, 0.035, z, WOOD_D, grow=0.025)
    l_box(base, 0.1, BASE_H - 0.1, MOSS, grow=0.16)
    for x, y in [(-W / 2, -D / 2), (-W / 2, D / 2), (W / 2, D / 2), (W / 2, -D / 2 + N), (W / 2 - N, -D / 2), (W / 2 - N, -D / 2 + N)]:
        base.box((0.12, 0.12, BASE_H - 0.22), (x, y, 0.12 + (BASE_H - 0.22) / 2), WOOD_D)
    # Round green door with a golden knob
    main_front.disc(base, 0, 0.56, 0.46, 0.06, WOOD_D, seg=14)
    main_front.disc(base, 0, 0.56, 0.38, 0.06, DOOR, out=0.015, seg=14)
    main_front.disc(base, 0, 0.56, 0.05, 0.06, GOLD, out=0.04, seg=8)
    for u in (-0.6, 0.6):
        x, y, _ = main_front.at(u, 0, 0.18)
        base.cyl(0.11, 0.18, (x, y, 0.21), POT, seg=8, r2=0.13)
        base.ico(0.17, (x, y, 0.42), LEAF_D, sub=1)
        base.ico(0.06, (x + 0.05, y - 0.08, 0.53), FLOWERS[0], sub=1)
    # Square windows with flower boxes
    for face, us in ((main_right, (-0.5, 0.5)), (back_face, (-0.5, 0.5)), (left_face, (-0.8, 0, 0.8))):
        for u in us:
            square_window(base, face, u, 0.85, 0.36, 0.36, WHITE, GLASS_ROOF)
            face.box(base, u, 0.6, 0.5, 0.12, 0.14, WOOD_D, out=0.07)
            for k in range(4):
                x, y, _ = face.at(u - 0.18 + k * 0.12, 0, 0.08)
                base.ico(0.055, (x, y, 0.7), FLOWERS[(k + int(u * 10)) % 4], sub=1)
    vine(base, -W / 2 + 0.25, -D / 2 - 0.02, BASE_H - 0.15, 0.9, rnd)
    # Helix foot pad
    base.cyl(0.38, 0.12, (*helix_c, 0.06), MOSS, seg=10)
    helix(base, BASE_H)
    base = base.build()

    # Middle: greenhouse storey ---------------------------------------------
    mid = Module("biology", "middle", MIDDLE_H)
    glass_h = MIDDLE_H - 0.1
    l_box(mid, 0.08, 0.0, WHITE, grow=0.02)
    l_box(mid, glass_h - 0.08, 0.08, GLASS, grow=-0.04)
    l_box(mid, 0.1, MIDDLE_H - 0.1, MOSS, grow=0.16)
    l_box(mid, 0.04, 0.78, WHITE, grow=0.0)
    for face in wall_faces:
        count = max(1, round(face.length / 0.4))
        for i in range(count + 1):
            u = -face.length / 2 + face.length * i / count
            face.box(mid, u, glass_h / 2, 0.05, glass_h, 0.05, WHITE)
    # Plants inside, seen through the glass
    for x, y, r, material in [(-0.55, 0.6, 0.32, LEAF), (0.45, 0.85, 0.28, LEAF_D), (-0.4, -0.75, 0.26, LEAF_M), (0.35, 0.1, 0.22, LEAF), (-0.6, -0.1, 0.2, LEAF_D)]:
        mid.cyl(0.1, 0.18, (x, y, 0.17), POT, seg=8, r2=0.12)
        mid.ico(r, (x, y, 0.26 + r * 0.9), material, sub=1, scale=(1, 1, 1.2))
    mid.box((1.0, 0.35, 0.06), (-0.1, D / 2 - 0.4, 0.55), WOOD)
    for i in range(4):
        mid.cyl(0.06, 0.14, (-0.5 + i * 0.27, D / 2 - 0.4, 0.65), FLOWERS[i], seg=6)
    # Hanging vines from the top slab
    for face, us in ((main_front, (-0.45, 0.2)), (main_right, (-0.6, 0.15, 0.7)), (left_face, (-0.9, 0.4))):
        for u in us:
            x, y, _ = face.at(u, 0, 0.12)
            vine(mid, x, y, MIDDLE_H - 0.15, rnd.uniform(0.35, 0.7), rnd)
    helix(mid, MIDDLE_H)
    mid = mid.build()

    # Top: greenhouse roof, roof garden and a tree above the helix -----------
    top = Module("biology", "top")
    l_box(top, 0.12, 0.0, GRASS, grow=0.14)
    bw, bd, bcx, bcy = back
    y0, y1 = bcy - bd / 2 + 0.1, bcy + bd / 2 - 0.1
    gable = [(-bw / 2 + 0.1, 0.12), (bw / 2 - 0.1, 0.12), (0, 0.85)]
    top.extrude_y(gable, y0, y1, GLASS_ROOF)
    for i in range(6):
        y = y0 + (y1 - y0) * i / 5
        frame = [(-bw / 2 + 0.06, 0.12), (bw / 2 - 0.06, 0.12), (0, 0.9)]
        top.extrude_y(frame, y - 0.03, y + 0.03, WHITE)
    top.box((0.08, y1 - y0 + 0.08, 0.08), (0, bcy, 0.88), WHITE)
    tx, ty = helix_c
    top.cyl(0.38, 0.14, (tx, ty, 0.07), MOSS, seg=10)
    tree = top.part("tree", (tx, ty, 0.14), "wobble", amplitude=0.05)
    tree.cyl(0.1, 0.8, (tx, ty, 0.54), WOOD_D, seg=6, r2=0.07)
    tree.ico(0.55, (tx, ty, 1.2), LEAF, sub=1, rot=(0.3, 0.1, 0.2))
    tree.ico(0.4, (tx + 0.3, ty - 0.18, 1.0), LEAF_D, sub=1)
    tree.ico(0.38, (tx - 0.28, ty + 0.15, 1.45), LEAF_M, sub=1)
    for i in range(5):
        x = -W / 2 + 0.25
        y = -D / 2 + 0.25 + i * 0.12
        top.ico(0.07, (x, y + N * 0.2, 0.18), FLOWERS[i % 4], sub=1)
    top.ico(0.16, (-W / 2 + 0.3, -D / 2 + 0.3, 0.22), LEAF_D, sub=1)
    top = top.build()
    return [base, mid, top]


# ---------------------------------------------------------------------------
# ROBOTICS: the building is a robot. Tracked chassis with a garage door,
# stackable torso segments, and a head with glowing eyes, raised arms and antenna.


def build_robotics():
    W, D = 2.8, 2.2
    ORANGE = mat("#ff8f4f", 0.55, 0.1)
    STEEL = mat("#55607a", 0.5, 0.4)
    STEEL_L = mat("#8a95a8", 0.45, 0.6)
    METAL = mat("#c9d4e6", 0.35, 0.7)
    DARK = mat("#1d2129", 0.7, 0.2)
    YELLOW = mat("#ffc23d", 0.6)
    EYE = mat("#4fd1d1", 0.3, 0.0, emission=1.6)
    RED = mat("#ff5f6d", 0.4, 0.0, emission=1.2)
    GREEN = mat("#4fd18b", 0.4, 0.0, emission=1.2)
    AMBER = mat("#ffb347", 0.4, 0.0, emission=1.2)
    GLASS = mat("#9fe8ff", 0.2, 0.0, emission=0.6)
    LAMP = mat("#fff2b0", 0.3, 0.0, emission=1.4)

    def porthole(mod, face, u, z, r):
        face.disc(mod, u, z, r + 0.07, 0.06, METAL, seg=12)
        face.disc(mod, u, z, r, 0.06, GLASS, out=0.012, seg=12)
        for k in range(6):
            a = 2 * math.pi * k / 6
            face.box(mod, u + (r + 0.035) * math.cos(a), z + (r + 0.035) * math.sin(a), 0.025, 0.025, 0.08, STEEL)

    def pipes(mod, z0, z1):
        face = rect_faces(W, D)["right"]
        for u in (0.62, 0.8):
            x, y, _ = face.at(u, 0, 0.09)
            mod.cyl(0.055, z1 - z0, (x, y, (z0 + z1) / 2), METAL, seg=8)
        for z in (z0 + 0.25, z1 - 0.25):
            face.box(mod, 0.71, z, 0.32, 0.06, 0.18, STEEL, out=0.05)

    # Base: tracked chassis ---------------------------------------------------
    base = Module("robotics", "base", BASE_H, (W, D))
    core_w = W - 0.92
    base.box((core_w, D, BASE_H - 0.1), (0, 0, (BASE_H - 0.1) / 2), ORANGE)
    tread_len = D + 0.2
    for side in (-1, 1):
        x = side * (W / 2 - 0.23)
        base.box((0.44, tread_len - 0.7, 0.7), (x, 0, 0.35), DARK)
        for y in (-(tread_len - 0.7) / 2, (tread_len - 0.7) / 2):
            base.cyl(0.35, 0.44, (x, y, 0.35), DARK, seg=12, rot=(0, math.pi / 2, 0))
        for y in (-0.62, 0, 0.62):
            base.cyl(0.24, 0.47, (x, y, 0.35), STEEL_L, seg=10, rot=(0, math.pi / 2, 0))
            base.cyl(0.09, 0.5, (x, y, 0.35), ORANGE, seg=6, rot=(0, math.pi / 2, 0))
        for k in range(10):
            y = -(tread_len - 0.7) / 2 + k * (tread_len - 0.7) / 9
            base.box((0.46, 0.06, 0.04), (x, y, 0.71), STEEL)
        base.box((0.5, D + 0.12, 0.08), (x, 0, 0.78), ORANGE)
        # Upper side pods with headlights
        base.box((0.46, D, BASE_H - 0.92), (x, 0, 0.82 + (BASE_H - 0.92) / 2), STEEL)
        lamp = Face((x, -D / 2), (1, 0), 0.46)
        lamp.disc(base, 0, 1.15, 0.13, 0.06, METAL, seg=10)
        lamp.disc(base, 0, 1.15, 0.095, 0.06, LAMP, out=0.015, seg=10)
        for k in range(3):
            Face((x, D / 2), (-1, 0), 0.46).box(base, 0, 0.95 + k * 0.12, 0.3, 0.04, 0.04, DARK)
    base.box((W + 0.06, D + 0.06, 0.1), (0, 0, BASE_H - 0.05), STEEL)
    front = Face((0, -D / 2), (1, 0), core_w)
    # Roll-up garage door with hazard stripes
    front.box(base, 0, 0.6, 1.2, 1.2, 0.05, DARK)
    for k in range(10):
        front.box(base, 0, 0.08 + k * 0.11, 1.1, 0.075, 0.05, STEEL_L, out=0.01)
    for k in range(9):
        front.box(base, -0.64 + k * 0.16, 1.3, 0.16, 0.12, 0.06, YELLOW if k % 2 == 0 else DARK, out=0.01)
    pipes(base, 0.82, BASE_H)
    base = base.build()

    # Middle: torso segment ---------------------------------------------------
    mid = Module("robotics", "middle", MIDDLE_H)
    mid.box((W - 0.12, D - 0.12, 0.12), (0, 0, 0.06), STEEL)
    mid.box((W - 0.06, D - 0.04, MIDDLE_H - 0.22), (0, 0, 0.12 + (MIDDLE_H - 0.22) / 2), ORANGE)
    mid.box((W + 0.06, D + 0.06, 0.1), (0, 0, MIDDLE_H - 0.05), STEEL)
    faces = rect_faces(W - 0.06, D - 0.04)
    fr = faces["front"]
    fr.box(mid, 0, 0.72, 1.0, 0.82, 0.05, DARK)
    fr.box(mid, 0, 0.94, 0.7, 0.22, 0.05, EYE, out=0.015)
    for row, mats in enumerate(((RED, GREEN, AMBER), (AMBER, EYE, RED))):
        for col, material in enumerate(mats):
            fr.disc(mid, -0.28 + col * 0.28, 0.6 - row * 0.2, 0.065, 0.07, material, out=0.03, seg=8)
    for u in (-0.98, 0.98):
        porthole(mid, fr, u, 0.72, 0.22)
    rt = faces["right"]
    for u in (-0.55, 0.05):
        porthole(mid, rt, u, 0.72, 0.2)
    for face in (faces["back"], faces["left"]):
        for u in (-0.7, 0, 0.7):
            porthole(mid, face, u, 0.72, 0.2)
    for face in faces.values():
        for u in (-face.length / 2 + 0.12, face.length / 2 - 0.12):
            for z in (0.24, MIDDLE_H - 0.24):
                face.box(mid, u, z, 0.04, 0.04, 0.04, STEEL, out=0.02)
    pipes(mid, 0.0, MIDDLE_H)
    mid = mid.build()

    # Top: shoulders, arms and head ------------------------------------------
    top = Module("robotics", "top")
    top.box((W + 0.1, D, 0.26), (0, 0, 0.13), STEEL)
    pipe_face = rect_faces(W, D)["right"]
    for u in (0.62, 0.8):
        x, y, _ = pipe_face.at(u, 0, 0.09)
        top.cyl(0.07, 0.12, (x, y, 0.06), STEEL_L, seg=8)
    for side in (-1, 1):
        top.sphere(0.27, (side * (W / 2 + 0.12), 0, 0.12), METAL, seg=10, rings=7)
    # Both arms raised, rocking forward and back from the shoulder
    for side, speed in ((-1, 1.1), (1, 1.4)):
        ax = side * (W / 2 + 0.2)
        arm = top.part("arm_left" if side < 0 else "arm_right", (side * (W / 2 + 0.12), -0.2, 0.12), "swing", axis=(1, 0, 0), amplitude=0.3, speed=speed)
        arm.box((0.3, 0.32, 0.7), (ax + side * 0.2, -0.2, 0.42), ORANGE, rot=(0, side * 0.6, 0))
        arm.sphere(0.19, (ax + side * 0.4, -0.2, 0.74), METAL, seg=8, rings=6)
        arm.box((0.28, 0.28, 0.66), (ax + side * 0.4, -0.2, 1.1), ORANGE, rot=(0, -side * 0.2, 0))
        arm.box((0.38, 0.26, 0.1), (ax + side * 0.47, -0.2, 1.45), METAL, rot=(0, -side * 0.2, 0))
        for dx in (-0.13, 0.13):
            arm.box((0.08, 0.2, 0.26), (ax + side * 0.5 + dx, -0.2, 1.6), METAL, rot=(0, -side * 0.2, 0))
    # Neck and head
    top.cyl(0.28, 0.18, (0, 0, 0.35), METAL, seg=10)
    hw, hd, hh, hz = 1.55, 1.25, 0.95, 0.44
    top.box((hw, hd, hh), (0, 0, hz + hh / 2), ORANGE)
    top.box((hw + 0.06, hd + 0.06, 0.07), (0, 0, hz + hh + 0.035), STEEL)
    head = rect_faces(hw, hd)
    face = head["front"]
    face.box(top, 0, hz + 0.5, 1.25, 0.66, 0.05, DARK)
    eyes = top.part("eyes", face.at(0, hz + 0.6, 0.04), "blink")
    for u in (-0.3, 0.3):
        face.disc(top, u, hz + 0.6, 0.18, 0.06, METAL, out=0.02, seg=12)
        face.disc(eyes, u, hz + 0.6, 0.13, 0.06, EYE, out=0.04, seg=12)
    for k in range(5):
        face.box(top, -0.32 + k * 0.16, hz + 0.3, 0.1, 0.07, 0.05, METAL, out=0.02)
    for side in (-1, 1):
        top.cyl(0.19, 0.14, (side * (hw / 2 + 0.07), 0, hz + 0.55), STEEL_L, seg=10, rot=(0, math.pi / 2, 0))
        top.sphere(0.06, (side * (hw / 2 + 0.16), 0, hz + 0.55), RED, seg=6, rings=4)
    top.cyl(0.03, 0.5, (0.3, 0.15, hz + hh + 0.3), METAL, seg=6)
    top.sphere(0.09, (0.3, 0.15, hz + hh + 0.58), RED, seg=8, rings=6)
    top.cyl(0.08, 0.06, (-0.35, 0.1, hz + hh + 0.1), STEEL_L, seg=8)
    top = top.build()
    return [base, mid, top]


# ---------------------------------------------------------------------------
# GEOGRAPHY: an explorer's lodge on a bed of rocks, storeys striped like rock
# strata, and a globe with a map pin on the roof.


def build_geography():
    W, D = 2.4, 2.4
    SAND = mat("#e8c891", 0.9)
    TERRA = mat("#c8693f", 0.9)
    OCHRE = mat("#d9a441", 0.9)
    CLAY = mat("#b8553a", 0.9)
    ROCK = mat("#8c8378", 0.95)
    ROCK_D = mat("#6d665e", 0.95)
    TIMBER = mat("#5a4a38", 0.85)
    SHUTTER = mat("#3fb5b0", 0.7)
    GLASS = mat("#9fd3ff", 0.2, 0.0, emission=0.5)
    BRASS = mat("#c9a15a", 0.35, 0.7)
    OCEAN = mat("#3a7bd5", 0.5, 0.0, emission=0.1)
    LAND = mat("#6cbf5a", 0.8)
    DESERT = mat("#e3c08a", 0.85)
    ICE = mat("#f2f6ff", 0.6)
    PIN = mat("#ff5f6d", 0.5, 0.0, emission=0.25)
    WHITE = mat("#ffffff", 0.6)
    CACTUS = mat("#4f9a58", 0.85)

    faces = rect_faces(W, D)

    def shuttered(mod, face, u, zc, w=0.32, h=0.46):
        face.box(mod, u, zc, w + 0.08, h + 0.08, 0.05, TIMBER)
        face.box(mod, u, zc, w, h, 0.04, GLASS, out=0.012)
        face.box(mod, u, zc, 0.03, h, 0.05, TIMBER, out=0.015)
        for side in (-1, 1):
            face.box(mod, u + side * (w / 2 + 0.1), zc, 0.15, h + 0.04, 0.04, SHUTTER, out=0.03)
        face.box(mod, u, zc - h / 2 - 0.07, w + 0.24, 0.05, 0.12, TIMBER, out=0.04)
        face.box(mod, u, zc + h / 2 + 0.07, w + 0.2, 0.07, 0.08, TIMBER, out=0.02)

    def quoins(mod, z0, h, material, phase=0):
        count = int(h / 0.18 + 0.01)
        for i in range(count):
            z = z0 + 0.09 + i * 0.18
            for x, y in corners(W, D):
                long_x = (i + phase) % 2 == 0
                sx, sy = (0.3, 0.16) if long_x else (0.16, 0.3)
                mod.box((sx, sy, 0.15), (x - math.copysign(sx / 2 - 0.1, x), y - math.copysign(sy / 2 - 0.1, y), z), material)

    rnd = random.Random(5)

    # Base: lodge on rocks ----------------------------------------------------
    base = Module("geography", "base", BASE_H, (W, D))
    base.box((W, D, BASE_H), (0, 0, BASE_H / 2), SAND)
    quoins(base, 0.0, BASE_H - 0.1, TERRA)
    base.box((W + 0.14, D + 0.14, 0.1), (0, 0, BASE_H - 0.05), ROCK_D)
    for face in faces.values():
        count = 7
        for i in range(count):
            u = -face.length / 2 + face.length * (i + 0.5) / count
            if face is faces["front"] and abs(u) < 0.45:
                continue
            x, y, _ = face.at(u + rnd.uniform(-0.08, 0.08), 0, rnd.uniform(0.0, 0.08))
            r = rnd.uniform(0.15, 0.24)
            base.ico(r, (x, y, r * 0.35), rnd.choice([ROCK, ROCK_D]), sub=1, scale=(1.2, 1.0, 0.8), rot=(rnd.random(), rnd.random(), rnd.random()))
    front = faces["front"]
    arched_window(base, front, 0, 0.0, 0.56, 1.04, TERRA, TIMBER)
    for k in range(3):
        front.box(base, -0.14 + k * 0.14, 0.4, 0.03, 0.75, 0.05, mat("#47392b"), out=0.02)
    front.disc(base, 0, 1.33, 0.2, 0.04, BRASS, seg=16)
    front.shape(base, ngon(0.24, 4, inner=0.06), 0, 1.33, 0.03, WHITE, out=0.03)
    front.shape(base, ngon(0.13, 4, start=math.pi / 4, inner=0.04), 0, 1.33, 0.03, TERRA, out=0.04)
    base.box((1.0, 0.36, 0.08), (0, -D / 2 - 0.18, 0.04), ROCK)
    for u in (-0.78, 0.78):
        shuttered(base, front, u, 0.85)
    for name in ("right", "left", "back"):
        for u in (-0.55, 0.55):
            shuttered(base, faces[name], u, 0.85)
    base = base.build()

    # Middle: strata -------------------------------------------------------
    mid = Module("geography", "middle", MIDDLE_H)
    bands = [(0.0, 0.48, TERRA, 0.04), (0.48, 0.5, OCHRE, 0.0), (0.98, 0.42, SAND, 0.03)]
    for z0, h, material, grow in bands:
        mid.box((W + grow, D + grow, h), (0, 0, z0 + h / 2), material)
    for z in (0.48, 0.98):
        mid.box((W + 0.08, D + 0.08, 0.04), (0, 0, z), CLAY)
    mid.box((W + 0.14, D + 0.14, 0.1), (0, 0, MIDDLE_H - 0.05), ROCK_D)
    quoins(mid, 0.0, MIDDLE_H - 0.1, ROCK, phase=1)
    for face in faces.values():
        for u in (-0.52, 0.52):
            shuttered(mid, face, u, 0.72, h=0.5)
    # A potted cactus on one sill: arid-climate hint
    x, y, _ = faces["right"].at(0.52, 0, 0.1)
    mid.cyl(0.06, 0.08, (x, y, 0.5), TERRA, seg=6)
    mid.cyl(0.04, 0.22, (x, y, 0.65), CACTUS, seg=6)
    mid.cyl(0.025, 0.1, (x, y + 0.06, 0.66), CACTUS, seg=6)
    mid = mid.build()

    # Top: globe and map pin -------------------------------------------------
    top = Module("geography", "top")
    top.box((W + 0.18, D + 0.18, 0.12), (0, 0, 0.06), TIMBER)
    for face in faces.values():
        face.box(top, 0, 0.21, face.length + 0.18, 0.18, 0.1, SAND, out=0.04)
    top.cyl(0.4, 0.12, (0, 0, 0.18), BRASS, seg=8)
    top.cyl(0.06, 0.32, (0, 0, 0.4), BRASS, seg=6)
    gz = 1.24
    gr = 0.72
    # Colour faces as continents: (lat, lon, radius in degrees)
    continents = [(48, -100, 26), (15, -90, 10), (-15, -60, 22), (5, 20, 26), (50, 15, 15), (48, 85, 34), (20, 78, 12), (-25, 134, 15), (72, -40, 10)]
    tilt = Euler((0, math.radians(23.4), math.radians(-65))).to_matrix()
    globe = top.part("globe", (0, 0, gz), "spin", axis=tilt @ Vector((0, 0, 1)), speed=0.25)
    globe_verts = globe.ico(gr, (0, 0, gz), OCEAN, sub=3)
    inv = tilt.inverted()
    globe_faces = {f for v in globe_verts for f in v.link_faces}
    for f in globe_faces:
        local = inv @ (f.calc_center_median() - Vector((0, 0, gz)))
        local.normalize()
        lat = math.degrees(math.asin(max(-1, min(1, local.z))))
        lon = math.degrees(math.atan2(local.y, local.x))
        material = OCEAN
        if abs(lat) > 68:
            material = ICE
        else:
            for clat, clon, rad in continents:
                c = Vector((math.cos(math.radians(clat)) * math.cos(math.radians(clon)), math.cos(math.radians(clat)) * math.sin(math.radians(clon)), math.sin(math.radians(clat))))
                if math.degrees(local.angle(c)) < rad:
                    material = DESERT if 12 < lat < 32 and -20 < lon < 60 else LAND
                    break
        if material not in globe.mats:
            globe.mats.append(material)
        f.material_index = globe.mats.index(material)
    # Meridian ring around the tilted axis
    ring = [(0.0, (gr + 0.1) * math.cos(a), (gr + 0.1) * math.sin(a)) for a in (2 * math.pi * i / 30 for i in range(30))]
    top.tube([Vector((0, 0, gz)) + tilt @ Vector(p) for p in ring], 0.03, BRASS, sides=5, closed=True)
    # Map pin
    px, py = -0.75, -0.75
    top.cyl(0.13, 0.4, (px, py, 0.32 + 0.2), PIN, seg=8, r2=0.0, rot=(math.pi, 0, 0))
    top.sphere(0.2, (px, py, 0.84), PIN, seg=10, rings=7)
    top.sphere(0.08, (px + 0.08, py - 0.12, 0.88), WHITE, seg=6, rings=4)
    top.cyl(0.18, 0.04, (px, py, 0.14), ROCK_D, seg=8)
    # Compass/telescope corner
    top.cyl(0.05, 0.5, (0.8, 0.75, 0.42), BRASS, seg=6, rot=(0.6, 0.4, 0))
    top.cyl(0.03, 0.3, (0.8, 0.75, 0.27), TIMBER, seg=5)
    top = top.build()
    return [base, mid, top]


KITS = {
    "math": build_math,
    "biology": build_biology,
    "robotics": build_robotics,
    "geography": build_geography,
}

built = {}
for name, builder in KITS.items():
    objects = builder()
    built[name] = objects
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
        for child in obj.children_recursive:
            child.select_set(True)
    path = f"{OUT_DIR}/{name}.glb"
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_extras=True,
        export_apply=True,
        export_texcoords=False,
    )
    print("exported", path)


# ---------------------------------------------------------------------------
# Preview: <prefix>_<kit>.png per kit at 1, 2 and 4 storeys, from the city camera angle.

if PREVIEW:
    scene = bpy.context.scene
    for obj in [o for objects in built.values() for o in objects]:
        obj.hide_render = True
        for child in obj.children_recursive:
            child.hide_render = True
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    bpy.context.object.data.materials.append(mat("#4f8f5a", 0.9))
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1500
    scene.render.resolution_y = 1000
    world = bpy.data.worlds.new("World")
    world.color = (0.55, 0.7, 0.9)
    scene.world = world
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(40), math.radians(15), math.radians(35)))
    bpy.context.object.data.energy = 3.5
    bpy.ops.object.camera_add(location=(30, -30, 30))
    cam = bpy.context.object
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 15
    cam.rotation_euler = (Vector((0, 0, 3)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    # Each kit at 1, 2 and 4 storeys, side by side across the view.
    for name, (base, mid, top) in built.items():
        copies = []
        for slot, storeys in enumerate((1, 2, 4)):
            offset = (slot - 1) * 3.6
            z = 0.0
            for obj in [base] + [mid] * (storeys - 1) + [top]:
                copy = bpy.data.objects.new(f"{obj.name}_p", obj.data)
                copy.location = (offset, offset, z)
                scene.collection.objects.link(copy)
                copies.append(copy)
                for child in obj.children:
                    part = bpy.data.objects.new(f"{child.name}_p", child.data)
                    part.parent = copy
                    part.location = child.location
                    scene.collection.objects.link(part)
                    copies.append(part)
                z += obj.get("height", 0)
        scene.render.filepath = f"{PREVIEW}_{name}.png"
        bpy.ops.render.render(write_still=True)
        for copy in copies:
            bpy.data.objects.remove(copy)
        print("preview", scene.render.filepath)
