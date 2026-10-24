export type InteriorMotif = 'tiles' | 'planks' | 'stripes' | 'dots' | 'grid' | 'checker'

export type InteriorDesign = {
  motif: InteriorMotif
  floor: string
  accent: string
}

export type StoreyConcept = {
  id: string
  label: string
  design: InteriorDesign
}
