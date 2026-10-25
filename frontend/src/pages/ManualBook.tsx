import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PageFlip } from 'page-flip'
import type { Briefed } from '../game/briefing'
import GlyphIcon from '../game/GlyphIcon'
import { seededRandom, type Random } from '../game/plan'

type Props = {
  seed: number
  /** "Zufällige Bombe" or "Üben: …", printed on the cover and checked against the bomb. */
  typeLabel: string
  plan: Briefed[]
}

function shuffled<T>(items: T[], random: Random): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** Height of the paper stack under the open pages, per leaf and at most. */
const STACK_PER_LEAF = 2.5
const STACK_MAX = 18

/** Pages of the spread, each the size of an A5-ish sheet (StPageFlip stretches them to the space). */
const PAGE_WIDTH = 520
const PAGE_HEIGHT = 730

/**
 * The expert's manual as an open book on a velvet table: a leather cover, one page per module (in
 * shuffled order), two pages side by side. Grab a page at its edge or corner and pull it across:
 * it bends and curls like real paper (StPageFlip). A click, the buttons or ← → turn it too.
 */
export default function ManualBook({ seed, typeLabel, plan }: Props) {
  const users = plan.flatMap((entry) =>
    entry.manual.user ? [{ user: entry.manual.user, prompt: entry.manual.prompt ?? '' }] : [],
  )
  const others = plan.filter((entry) => !entry.manual.user)
  // In reading order. Cover and back cover are hard (they turn stiff), the rest is paper.
  const faces: { node: ReactNode; kind: 'cover' | 'paper' }[] = [
    { node: <Cover seed={seed} typeLabel={typeLabel} modules={plan.length} />, kind: 'cover' },
    { node: <HowTo seed={seed} typeLabel={typeLabel} />, kind: 'paper' },
    // one page listing every terminal user with their question
    ...(users.length > 0 ? [{ node: <UsersPage users={users} page={2} />, kind: 'paper' as const }] : []),
    // shuffled (the same for a code), so the page order says nothing about the bomb
    ...shuffled(others, seededRandom(seed * 7 + 3)).map((entry, i) => ({
      node: <ModulePage entry={entry} page={i + 2 + (users.length > 0 ? 1 : 0)} seed={seed * 13 + i} />,
      kind: 'paper' as const,
    })),
  ]
  // the back cover must land on its own, as the last (even-numbered) page
  if (faces.length % 2 === 0) faces.push({ node: <article className="book-paper" />, kind: 'paper' })
  faces.push({ node: <BackCover />, kind: 'cover' })
  const count = faces.length

  // StPageFlip moves the page elements around itself, so they are made here once and React only
  // renders the page contents into them (portals).
  const [sheets] = useState(() =>
    faces.map(({ kind }) => {
      const sheet = document.createElement('div')
      sheet.className = `book-face is-${kind}`
      if (kind === 'cover') sheet.dataset.density = 'hard'
      return sheet
    }),
  )
  const host = useRef<HTMLDivElement>(null)
  const flip = useRef<PageFlip | null>(null)
  const [page, setPage] = useState(0)
  /** A page is being dragged or turning. */
  const [turning, setTurning] = useState(false)

  useEffect(() => {
    if (!host.current) return
    // StPageFlip removes its root element on destroy, so it gets a fresh one each time
    const root = document.createElement('div')
    root.className = 'book-host'
    host.current.appendChild(root)
    const book = new PageFlip(root, {
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      size: 'stretch',
      minWidth: 140,
      maxWidth: 1000,
      minHeight: 200,
      maxHeight: 1400,
      showCover: true,
      usePortrait: true,
      drawShadow: true,
      // a slower turn with a deeper shadow under the lifted page, like picking it up and laying it over
      maxShadowOpacity: 0.5,
      flippingTime: 1200,
      mobileScrollSupport: false,
      // corners only bend once a page is grabbed, not on hover
      showPageCorners: false,
      swipeDistance: 20,
    })
    book.loadFromHTML(sheets)
    book.on('flip', (e) => setPage(e.data))
    book.on('changeState', (e) => setTurning(e.data !== 'read'))
    flip.current = book
    return () => {
      flip.current = null
      book.destroy()
    }
  }, [sheets])

  /** Direction of the turn in progress (from the button, key or the half of the book grabbed). */
  const [heading, setHeading] = useState<1 | -1>(1)
  const turn = useCallback((dir: 1 | -1) => {
    setHeading(dir)
    if (dir === 1) flip.current?.flipNext()
    else flip.current?.flipPrev()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') turn(1)
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') turn(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [turn])

  const last = count - 1
  // paper stack under the open pages: thicker on the side where more pages lie
  // Leaves (sheets, two pages each) turned to the left; the visible page on each side lies on top,
  // only the leaves underneath show as a stack. At the first spread nothing lies under the left
  // page but the cover, at the last nothing under the right one.
  // While a page turns, the book already slides to where the spread it goes to lies (centred when
  // it closes), instead of jumping there once the page has landed.
  const shownPage = turning ? (page === 0 ? 1 : page >= last ? last - 1 : Math.max(0, Math.min(last, page + 2 * heading))) : page
  const leaves = count / 2
  const turned = Math.floor((page + 1) / 2)
  const open = page > 0 && page < last
  const stackFor = (under: number) => (under <= 0 ? 0 : Math.min(STACK_MAX, 3 + under * STACK_PER_LEAF))
  // hidden while a page is moving: the stack only fits the spread that is lying still
  const leftStack = open && !turning ? stackFor(turned - 1) : 0
  const rightStack = open && !turning ? stackFor(leaves - turned - 1) : 0
  const label =
    page === 0 ? 'Cover' : page >= last ? 'Rückseite' : page <= 2 ? 'Anleitung · Seite 2' : `Seite ${page} – ${page + 1}`

  return (
    <div className="book-screen">
      <EnchantRunes />
      <div className="book-stage">
        <div className="book-tilt">
          {/* the table the book lies on */}
          <div className="book-table" aria-hidden>
            <span className="book-table-gem is-tl" />
            <span className="book-table-gem is-tr" />
            <span className="book-table-gem is-bl" />
            <span className="book-table-gem is-br" />
          </div>
          {/* closed, the book sits in the middle: the cover is the right half of the spread */}
          <div
            className={`book-spread ${shownPage === 0 ? 'is-closed-front' : shownPage >= last ? 'is-closed-back' : ''}`}
            onPointerDownCapture={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              setHeading(e.clientX < rect.left + rect.width / 2 ? -1 : 1)
            }}
          >
            {/* edges of the pages lying underneath, peeking out below and at the outer sides */}
            {leftStack > 0 && <div className="book-stack is-left" style={{ ['--stack' as string]: `${leftStack}px` }} />}
            {rightStack > 0 && <div className="book-stack is-right" style={{ ['--stack' as string]: `${rightStack}px` }} />}
            <div ref={host} className="book-pages" />
          </div>
        </div>
      </div>
      {sheets.map((sheet, i) => createPortal(faces[i].node, sheet, `face-${i}`))}

      <nav className="book-nav">
        <button className="mg-button" onClick={() => turn(-1)} disabled={page === 0}>
          ◀ Zurück
        </button>
        <span>{label}</span>
        <button className="mg-button" onClick={() => turn(1)} disabled={page >= last}>
          Weiter ▶
        </button>
      </nav>
      <p className="book-help">Seite an Ecke oder Rand greifen und rüberziehen · klicken · ← →</p>
    </div>
  )
}

/** Enchanting-table runes (Standard Galactic Alphabet look) drifting towards the book. */
const RUNES = 'ᔑʖᓵ↸ᒷ⎓⊣⍑╎⋮ꖌꖎᒲリ𝙹ᑑ∷ᓭℸ⚍⍊∴'
function EnchantRunes() {
  const runes = Array.from({ length: 26 }, (_, i) => {
    // spread over the screen, fixed per rune so they do not jump around on re-render
    const x = (i * 37) % 100
    const y = 55 + ((i * 53) % 45)
    return { char: [...RUNES][i % [...RUNES].length], x, y, delay: (i * 0.73) % 6, duration: 5 + ((i * 1.7) % 4) }
  })
  return (
    <div className="enchant-runes" aria-hidden>
      {runes.map((r, i) => (
        <span
          key={i}
          style={{ left: `${r.x}%`, top: `${r.y}%`, animationDelay: `${r.delay}s`, animationDuration: `${r.duration}s` }}
        >
          {r.char}
        </span>
      ))}
    </div>
  )
}

function Cover({ seed, typeLabel, modules }: { seed: number; typeLabel: string; modules: number }) {
  return (
    <div className="book-cover">
      <div className="book-cover-frame">
        <span className="book-cover-stamp">STRENG GEHEIM</span>
        <h1>Handbuch zur Bomben&shy;entschärfung</h1>
        <dl className="book-cover-facts">
          <dt>Code</dt>
          <dd>{seed}</dd>
          <dt>Auswahl</dt>
          <dd>{typeLabel}</dd>
          <dt>Module</dt>
          <dd>{modules}</dd>
        </dl>
        <span className="book-cover-hint">Zum Öffnen umblättern ▶</span>
      </div>
    </div>
  )
}

function HowTo({ seed, typeLabel }: { seed: number; typeLabel: string }) {
  return (
    <article className="book-paper">
      <h2>So arbeitest du mit diesem Handbuch</h2>
      <ol>
        <li>
          Vergleicht zuerst: Auf der Bombe steht oben links <strong>Code {seed}</strong> und <strong>{typeLabel}</strong>.
          Stimmt etwas nicht, habt ihr verschiedene Bomben.
        </li>
        <li>
          Jede Seite beschreibt ein Modul der Bombe. Welches gemeint ist, müsst ihr selbst herausfinden: Lass dir
          beschreiben, wie das Modul aussieht und was darauf steht.
        </li>
        <li>
          Der Entschärfer sieht Symbole und Steuerelemente, du siehst, wofür sie stehen. Lass dir die Symbole
          beschreiben und sag, was zu tun ist.
        </li>
      </ol>
      <p className="book-folio">– 1 –</p>
    </article>
  )
}

function ModulePage({ entry, page, seed }: { entry: Briefed; page: number; seed: number }) {
  const { manual } = entry
  // listed in their own random order, not the bomb's, so you have to talk it through
  const random = seededRandom(seed)
  const statements = manual.statements && shuffled(manual.statements.map((text, i) => ({ text, n: i + 1 })), random)
  const glyphs = manual.glyphs && shuffled(manual.glyphs, random)
  return (
    <article className="book-paper">
      {manual.prompt && (
        <section>
          <h3>Die Frage</h3>
          <p className="book-question">{manual.prompt}</p>
        </section>
      )}

      {statements && (
        <section>
          <h3>Die Aussagen</h3>
          <ul className="book-statements">
            {statements.map(({ text, n }) => (
              <li key={n}>
                <strong>Aussage {n}:</strong> {text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {glyphs && (
        <section>
          <h3>Bedeutung der Symbole</h3>
          <ul className="book-glyphs">
            {glyphs.map(({ glyph, text }) => (
              <li key={glyph}>
                <GlyphIcon index={glyph} size={34} stroke={5} />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="book-folio">– {page} –</p>
    </article>
  )
}

/** All free-text terminals on one page: login name and the question asked there. */
function UsersPage({ users, page }: { users: { user: string; prompt: string }[]; page: number }) {
  const sorted = [...users].sort((a, b) => a.user.localeCompare(b.user))
  return (
    <article className="book-paper">
      <section>
        <h3>Terminal-Zugänge · Passwort vergessen?</h3>
        <dl className="book-users">
          {sorted.map(({ user, prompt }) => (
            <div key={user}>
              <dt>{user}</dt>
              <dd>{prompt}</dd>
            </div>
          ))}
        </dl>
      </section>
      <p className="book-folio">– {page} –</p>
    </article>
  )
}

function BackCover() {
  return (
    <div className="book-cover is-back">
      <div className="book-cover-frame">
        <p>Ende des Handbuchs.</p>
        <p>Viel Glück. Und redet miteinander.</p>
      </div>
    </div>
  )
}
