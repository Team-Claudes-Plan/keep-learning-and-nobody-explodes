import { Grid } from '@react-three/drei'

export default function Ground({ y = 0 }: { y?: number }) {
  return (
    <Grid
      position={[0, y, 0]}
      args={[40, 40]}
      cellSize={1}
      cellThickness={1}
      cellColor="#c3d4e4"
      sectionSize={5}
      sectionThickness={1.2}
      sectionColor="#9dbcdf"
      fadeDistance={45}
      fadeStrength={1.5}
      infiniteGrid
      followCamera={false}
    />
  )
}
