#let paper = rgb("#e8dfca")
#let ink = rgb("#141414")
#let red = rgb("#d8321b")
#let yellow = rgb("#f2c230")
#let faded = rgb("#141414").transparentize(55%)

#let mono = ("Hack", "DejaVu Sans Mono")
#let display = ("Inter Display", "Inter")

#set page(paper: "presentation-16-9", margin: (x: 2cm, top: 2.5cm, bottom: 1.5cm), fill: paper)

#let hazard(height) = rect(
  width: 100%,
  height: height,
  fill: gradient
    .linear(
      (ink, 0%),
      (ink, 50%),
      (yellow, 50%),
      (yellow, 100%),
      angle: 45deg,
    )
    .repeat(60, mirror: false),
)

#set page(
  footer: [
    #set text(font: mono, size: 11pt, fill: faded)
    #grid(
      columns: (1.5fr, 1fr),
      align: (left, right),
      [
        KEEP LEARNING AND NOBODY EXPLODES · HACKATHON FULDA 2026
      ],
      [
        PITCH
      ],
    )
  ],
)

#set text(font: mono, size: 22pt, fill: ink, lang: "de")
#set par(leading: 0.7em)

#let headline(size: 92pt, body) = par(leading: 0.22em, text(
  font: display,
  weight: "black",
  size: size,
  tracking: -0.03em,
  fill: ink,
  body,
))

// Gestempeltes Etikett
#let stamp(body, color: red, angle: -6deg, size: 26pt) = rotate(
  angle,
  box(
    stroke: 4pt + color,
    inset: (x: 16pt, y: 8pt),
    radius: 4pt,
    text(font: mono, weight: "bold", size: size, fill: color, body),
  ),
)

// Schwärzung: Text mit schwarzem Balken
#let redact(body) = box(fill: ink, inset: (x: 4pt), text(fill: ink, body))

#let page-header(time, hits) = {
  set text(font: mono, size: 11pt, fill: ink)
  grid(
    columns: (1fr, auto),
    align: (left + horizon, right + horizon),
    [FORM KL-01 · ENTSCHÄRFUNGS-BRIEFING],
    {
      box(
        fill: ink,
        inset: (x: 12pt, y: 6pt),
        radius: 3pt,
        text(font: mono, size: 22pt, weight: "bold", fill: red, time),
      )
      h(10pt)
      for i in range(3) {
        text(size: 20pt, fill: if i < hits { red } else { faded }, sym.circle.filled)
        h(2pt)
      }
    },
  )
  v(-4pt)
  line(length: 100%, stroke: 1.5pt + ink)
}

#let slide(time, hits: 0, body) = page(header: page-header(time, hits), body)

// ---------- 1 · Titel ----------
#slide("05:00")[

  #grid(
    columns: (1fr, auto),
    align: (left + top, right + top),
    headline(size: 70pt)[KEEP \ LEARNING \ AND NOBODY \ EXPLODES], stamp[STRENG VERTRAULICH],
  )
  #v(-0.25cm)
  #text(size: 28pt)[Dein Skript ist die Anleitung.]
  #v(-0.75cm)
  #hazard(0.7cm)
]

// ---------- 2 · Keiner sieht alles ----------
#slide("04:30")[
  #align(center + horizon)[
    #image("assets/menu.png")
  ]
]

// ---------- 3 · Die Welt ----------
#slide("04:00", hits: 0)[
  #align(center + horizon)[#image("assets/island-barebones.png")]
]

// ---------- 4 · Die Pipeline ----------
#slide("03:30")[
  #v(0.4cm)
  #headline(size: 76pt)[PDF rein. \ Bombe raus.]
  #v(1cm)
  #grid(
    columns: (1fr, auto, 1fr, auto, 1fr),
    column-gutter: 0.6cm,
    align: horizon,
    box(stroke: 3pt + ink, inset: 16pt, width: 100%)[
      #align(center)[*Skript* \ #text(size: 15pt, fill: faded)[Folien, Foto, Notizen]]
    ],
    text(size: 36pt, weight: "bold")[→],
    box(stroke: 3pt + ink, inset: 16pt, width: 100%, fill: ink)[
      #align(center)[#text(fill: paper)[*KI* \ #text(size: 15pt, fill: yellow)[Frage · Prüfen · Sortieren]]]
    ],
    text(size: 36pt, weight: "bold")[→],
    box(stroke: 3pt + red, inset: 16pt, width: 100%)[
      #align(center)[#text(fill: red)[*Haus* \ #text(size: 15pt)[mit Stockwerken]]]
    ],
  )
]

// ---------- 5 · Technik in Zahlen ----------
#slide("03:00")[
  #align(center + horizon)[
    #image("assets/island-buildings.png")
  ]
]

#slide("02:30")[
  #align(center + horizon)[
    #image("assets/building.png")
  ]
]

#slide("02:00")[
  #align(center + horizon)[
    #image("assets/bomb.png")
  ]
]

#slide("01:30")[
  #align(center + horizon)[
    #image("assets/book.png")
  ]
]

#set page(
  footer: [
    #set text(font: mono, size: 11pt, fill: faded)
    #grid(
      columns: (1.5fr, 1fr),
      align: (left, right),
      [
        KEEP LEARNING AND NOBODY EXPLODES · HACKATHON FULDA 2026
      ],
      [
        KI-REFLEXION
      ],
    )
  ],
)

#slide("01:00")[
  #grid(
    columns: (auto, auto),
    align: (left + bottom),
    column-gutter: 2cm,
    [
      #headline(size: 150pt)[46.306]
    ],
    [
      #headline(size: 100pt)[LoC]
    ],
  )

  #v(0.5cm)

  #headline(size: 75pt)[Claude]
  #v(-0.25cm)
  #headline(size: 75pt)[DeepSeek]
  #v(-0.25cm)
  #headline(size: 75pt)[Gemini]
]

#slide("00:45")[
  #headline(size: 75pt)[Unsere]
  #headline(size: 75pt)[umfangreichste ]
  #headline(size: 75pt)[Lösung]
  #headline(size: 75pt)[beim Hackathon]
]

#slide("00:30")[
  #set align(center + horizon)
  #image("assets/blender-mcp.png")
]

#align(center + horizon)[
  #slide("00:15")[
    #headline(size: 50pt)[OK Claude ...]
    #headline(size: 50pt)[implementiere das Feature.]
  ]
]

#slide("00:00", hits: 0)[
  #v(1fr)
  #align(center)[
    #stamp(size: 36pt, color: ink, angle: -3deg)[ENTSCHÄRFT]
    #v(0.8cm)
    #headline(size: 80pt)[Fragen?]
    #headline(size: 80pt)[Oder Bombe?]
  ]
  #v(1fr)
  #hazard(0.7cm)
]
