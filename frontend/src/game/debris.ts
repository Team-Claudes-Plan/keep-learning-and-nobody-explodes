import * as THREE from 'three'

// The bomb blowing apart: the hull breaks into its side plates, and every part (plates, modules,
// rails, flanges, bolts, the cradle) is flung away from the centre, tumbles, crashes onto the floor,
// bounces and skids to a stop. A small hand-rolled simulation: no physics engine needed for this.

export type Piece = {
  object: THREE.Object3D
  velocity: THREE.Vector3
  spin: THREE.Vector3
  /** The piece's thinnest direction (local): once it has slowed down it tips over onto that side. */
  flat: THREE.Vector3
  /** 'flying' → 'settling' (tipping over flat on the floor) → 'resting'. */
  state: 'flying' | 'settling' | 'resting'
}

/** Centre of the bomb, where the blast comes from. */
const CENTER = new THREE.Vector3(0, 1.55, 0)
const GRAVITY = -16
/** Hull: hexagonal prism along X, faces this far from the axis, this long. */
const HULL_APOTHEM = 0.996
const HULL_LENGTH = 2.3
const PLATE_THICKNESS = 0.05
const FLOOR_Y = 0

/** Outward normals of the six hull faces (in the YZ plane), the same as the module slots. */
const FACE_NORMALS = [
  [0, 0, 1],
  [0, 0.866, 0.5],
  [0, 0.866, -0.5],
  [0, 0, -1],
  [0, -0.866, -0.5],
  [0, -0.866, 0.5],
].map(([x, y, z]) => new THREE.Vector3(x, y, z))

function random(min: number, max: number) {
  return min + Math.random() * (max - min)
}

/** Darkens a mesh's material (own copy, the cached model's materials stay untouched): scorched by the blast. */
function scorch(object: THREE.Object3D, amount: number) {
  object.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material)) return
    const material = (mesh.material as THREE.MeshStandardMaterial).clone()
    material.color?.multiplyScalar(amount)
    mesh.material = material
  })
}

/** The hull as twelve loose plates (each face split in two along its length). */
function hullPlates(hull: THREE.Mesh) {
  const material = (hull.material as THREE.MeshStandardMaterial).clone()
  material.color.multiplyScalar(0.55)
  const side = 2 * HULL_APOTHEM * Math.tan(Math.PI / 6)
  const geometry = new THREE.BoxGeometry(HULL_LENGTH / 2, side, PLATE_THICKNESS)
  const plates: THREE.Mesh[] = []
  for (const normal of FACE_NORMALS) {
    for (const x of [-HULL_LENGTH / 4, HULL_LENGTH / 4]) {
      const plate = new THREE.Mesh(geometry, material)
      plate.position.copy(CENTER).addScaledVector(normal, HULL_APOTHEM - PLATE_THICKNESS / 2)
      plate.position.x = x
      // the plate's thin side (local Z) faces outwards
      plate.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
      plates.push(plate)
    }
  }
  return plates
}

/**
 * Breaks the bomb into pieces and gives each its kick. Everything ends up as a direct child of
 * `bomb` (the scene clone), so the pieces move in its space.
 */
export function shatterBomb(bomb: THREE.Object3D): Piece[] {
  bomb.updateMatrixWorld(true)
  const root = bomb.getObjectByName('Bomb_Root') ?? bomb
  const parts = [...root.children]
  const pieces: Piece[] = []

  const add = (object: THREE.Object3D, speed: number, flat = thinnestAxis(object)) => {
    bomb.attach(object)
    const from = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3())
    const away = from.sub(CENTER)
    if (away.lengthSq() < 1e-4) away.set(random(-1, 1), 1, random(-1, 1))
    const velocity = away
      .normalize()
      .multiplyScalar(speed * random(0.7, 1.3))
      .add(new THREE.Vector3(random(-1.5, 1.5), random(3, 7), random(-1.5, 1.5)))
    const spin = new THREE.Vector3(random(-1, 1), random(-1, 1), random(-1, 1)).multiplyScalar(random(6, 16))
    pieces.push({ object, velocity, spin, flat, state: 'flying' })
  }

  for (const part of parts) {
    const mesh = part as THREE.Mesh
    if (part.name === 'Hull' && mesh.isMesh) {
      part.visible = false
      for (const plate of hullPlates(mesh)) {
        bomb.add(plate)
        add(plate, 7)
      }
      continue
    }
    if (part.name.startsWith('Slot_')) {
      // modules (or empty bays) fly off along their face
      scorch(part, 0.6)
      add(part, 8, new THREE.Vector3(0, 0, 1)) // a module is a flat plate facing local Z
      continue
    }
    scorch(part, 0.45)
    // the heavy cradle only gets shoved and tipped, the small parts fly furthest
    add(part, part.name.startsWith('Cradle') ? 2.5 : part.name.startsWith('FlangeBolt') ? 9 : 6)
  }
  return pieces
}

/** Local axis along which a mesh is thinnest (from its geometry's bounding box and scale). */
function thinnestAxis(object: THREE.Object3D) {
  const mesh = object as THREE.Mesh
  if (!mesh.isMesh) return new THREE.Vector3(0, 1, 0)
  mesh.geometry.computeBoundingBox()
  const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3()).multiply(mesh.scale)
  if (size.x <= size.y && size.x <= size.z) return new THREE.Vector3(1, 0, 0)
  if (size.y <= size.z) return new THREE.Vector3(0, 1, 0)
  return new THREE.Vector3(0, 0, 1)
}

const box = new THREE.Box3()
const up = new THREE.Vector3(0, 1, 0)
const down = new THREE.Vector3(0, -1, 0)
const axis = new THREE.Vector3()
const tip = new THREE.Quaternion()

/** Keeps a piece on top of the floor; returns how deep it had sunk in. */
function liftOutOfFloor(object: THREE.Object3D) {
  object.updateMatrixWorld(true)
  box.setFromObject(object)
  const depth = FLOOR_Y - box.min.y
  if (depth > 0) object.position.y += depth
  return depth
}

/**
 * Moves the pieces one step: gravity, tumbling, and crashing onto the floor (bounce, friction,
 * then rest). `onImpact` gets the impact speed of every hard landing, for the clatter.
 */
export function stepDebris(pieces: Piece[], dt: number, onImpact: (speed: number) => void) {
  for (const piece of pieces) {
    const { object, velocity, spin } = piece
    if (piece.state === 'resting') continue

    if (piece.state === 'settling') {
      // tip over onto its flat side and slide out
      axis.copy(piece.flat).applyQuaternion(object.quaternion)
      tip.setFromUnitVectors(axis, axis.y >= 0 ? up : down)
      const k = 1 - Math.exp(-dt * 9)
      object.quaternion.premultiply(new THREE.Quaternion().slerp(tip, k))
      object.position.x += velocity.x * dt
      object.position.z += velocity.z * dt
      velocity.multiplyScalar(Math.exp(-dt * 6))
      object.position.y -= 0.6 * dt // drops down as it tips; the floor stops it
      liftOutOfFloor(object)
      if (Math.abs(axis.y) > 0.999) piece.state = 'resting'
      continue
    }

    velocity.y += GRAVITY * dt
    object.position.addScaledVector(velocity, dt)
    object.rotation.x += spin.x * dt
    object.rotation.y += spin.y * dt
    object.rotation.z += spin.z * dt

    // floor contact: lift the piece out of the floor and bounce it off
    if (liftOutOfFloor(object) <= 0) continue
    if (velocity.y < 0) {
      if (velocity.y < -2.5) onImpact(-velocity.y)
      velocity.y *= -0.32
      velocity.x *= 0.6
      velocity.z *= 0.6
      spin.multiplyScalar(0.55)
    }
    // slowed down on the floor: stops tumbling and falls flat
    if (Math.abs(velocity.y) < 1.2) {
      velocity.y = 0
      piece.state = 'settling'
    }
  }
}
