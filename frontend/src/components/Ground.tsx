import { Grid } from '@react-three/drei'

export default function Ground() {
  return (
    <Grid
      position={[0, 0, 0]}
      args={[40, 40]}
      cellSize={1}
      cellThickness={1}
      cellColor="#2a3550"
      sectionSize={5}
      sectionThickness={1.4}
      sectionColor="#4f8cff"
      fadeDistance={45}
      fadeStrength={1.5}
      infiniteGrid
      followCamera={false}
    />
  )
}
