import * as THREE from 'three'

const BAY_SIZE = 1.02
const BAY_RIM = 0.035
const BAY_DEPTH = 0.06

/**
 * Unused slot: no module screwed in, just the open bay. A rim around a dark pit, the four empty
 * mounting posts and the bare connector a module would plug into.
 */
export function makeEmptyBay() {
  const bay = new THREE.Group()
  bay.userData.planIndex = null
  const rim = new THREE.MeshStandardMaterial({ color: '#3a3f47', metalness: 0.7, roughness: 0.45 })
  const pit = new THREE.MeshStandardMaterial({ color: '#08090b', roughness: 0.95 })
  const wall = new THREE.MeshStandardMaterial({ color: '#16181c', metalness: 0.3, roughness: 0.8 })
  const brass = new THREE.MeshStandardMaterial({ color: '#b08d57', metalness: 0.9, roughness: 0.3 })
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    bay.add(mesh)
    return mesh
  }

  // floor of the pit, just above the hull's recess plate
  add(new THREE.BoxGeometry(BAY_SIZE - BAY_RIM, BAY_SIZE - BAY_RIM, 0.004), pit, 0, 0, 0.007)
  // rim on all four sides; its dark inner face reads as the pit wall
  const half = BAY_SIZE / 2 - BAY_RIM / 2
  for (const [w, h, x, y] of [
    [BAY_SIZE, BAY_RIM, 0, half],
    [BAY_SIZE, BAY_RIM, 0, -half],
    [BAY_RIM, BAY_SIZE - BAY_RIM * 2, half, 0],
    [BAY_RIM, BAY_SIZE - BAY_RIM * 2, -half, 0],
  ]) {
    add(new THREE.BoxGeometry(w, h, BAY_DEPTH), rim, x, y, BAY_DEPTH / 2 + 0.005)
    const inset = (BAY_RIM / 2 + 0.004) * (x === 0 ? Math.sign(y) : Math.sign(x))
    add(
      new THREE.BoxGeometry(x === 0 ? w - BAY_RIM * 2 : 0.006, x === 0 ? 0.006 : h, BAY_DEPTH - 0.008),
      wall,
      x === 0 ? 0 : x - inset,
      x === 0 ? y - inset : 0,
      BAY_DEPTH / 2 + 0.006,
    )
  }
  // empty threaded posts where the module screws would go
  const post = new THREE.CylinderGeometry(0.03, 0.034, 0.04, 20).rotateX(Math.PI / 2)
  const hole = new THREE.CylinderGeometry(0.012, 0.012, 0.002, 16).rotateX(Math.PI / 2)
  for (const x of [-0.44, 0.44]) {
    for (const y of [-0.44, 0.44]) {
      add(post, rim, x, y, 0.029)
      add(hole, pit, x, y, 0.05)
    }
  }
  // bare connector at the bottom of the pit
  add(new THREE.BoxGeometry(0.34, 0.07, 0.03), wall, 0, -0.3, 0.024)
  const pin = new THREE.BoxGeometry(0.012, 0.012, 0.024)
  for (let k = 0; k < 10; k++) add(pin, brass, -0.135 + k * 0.03, -0.3, 0.045)
  return bay
}
