type DoorProps = {
  width: number
  height: number
  color: string
  frameColor: string
  glow: number
}

export default function Door({ width, height, color, frameColor, glow }: DoorProps) {
  const knobY = -height / 2 + height * 0.5
  const knobX = width / 2 - 0.08

  return (
    <group>
      <mesh position={[0, 0, 0.004]}>
        <boxGeometry args={[width + 0.06, height + 0.06, 0.012]} />
        <meshStandardMaterial color={frameColor} roughness={0.6} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0, 0.014]}>
        <boxGeometry args={[width, height, 0.02]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.05 + glow * 0.25}
          roughness={0.45}
          metalness={0.15}
        />
      </mesh>
      <mesh position={[knobX, knobY, 0.03]}>
        <sphereGeometry args={[0.028, 12, 12]} />
        <meshStandardMaterial color={frameColor} emissive={frameColor} emissiveIntensity={0.2 + glow * 0.4} metalness={0.6} roughness={0.3} />
      </mesh>
    </group>
  )
}
