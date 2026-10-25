import { useCallback, useEffect, useState, type PointerEvent, type ReactNode, type TransitionEvent } from 'react'
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

/**
 * One physical sheet. `front` faces right before it is turned, `back` faces left after. The two
 * covers are their own stiff, one-sided board: `back`/`front` is null where there is nothing
 * printed (the pastedown inside the cover).
 */
type Leaf = { front: ReactNode; back: ReactNode | null; hard?: boolean }

/** A turn in progress: grabbed and dragged, or sent all the way by a click, a button or ← →. */
type Flip = {
  index: number
  dir: 1 | -1
  /** Current hinge rotation in degrees: 0 at rest, ∓180 once fully turned. */
  angle: number
  /** Still following the pointer; no transition, so it tracks the finger exactly. */
  dragging: boolean
  /** Decided once released (or immediately for a button/key turn): finish the turn, or spring back. */
  committed: boolean
  /** Where the grab started and how wide a leaf is, to turn the drag into a fraction turned. */
  startX: number
  width: number
}

const targetAngle = (f: Flip) => (f.committed ? (f.dir === 1 ? -180 : 180) : 0)

/** Below this, a press counts as a click (flips fully) rather than a drag that can be let go of. */
const CLICK_SLOP = 6

/**
 * The expert's manual as a book lying open on a velvet table, built from flat divs and CSS 3D
 * transforms (no page-flip library, which can only curl from its two top/bottom corners): grab a
 * leaf anywhere along its edge and it turns from exactly that hinge, following the pointer like a
 * real sheet of paper would; let go past the middle to finish the turn, short of it to drop it back.
 * A plain click, the buttons or ← → send a leaf all the way over without having to drag it.
 */
export default function ManualBook({ seed, typeLabel, plan }: Props) {
  const users = plan.flatMap((entry) =>
    entry.manual.user ? [{ user: entry.manual.user, prompt: entry.manual.prompt ?? '' }] : [],
  )
  const others = plan.filter((entry) => !entry.manual.user)

  // In reading order. Shuffled (the same for a code), so the page order says nothing about the bomb.
  const interior: ReactNode[] = [
    <HowTo key="howto" seed={seed} typeLabel={typeLabel} page={1} />,
    ...(users.length > 0 ? [<UsersPage key="users" users={users} page={2} />] : []),
    ...shuffled(others, seededRandom(seed * 7 + 3)).map((entry, i) => (
      <ModulePage key={i} entry={entry} page={i + 2 + (users.length > 0 ? 1 : 0)} seed={seed * 13 + i} />
    )),
  ]
  // leaves pair two interior pages front-to-back, so there must be an even number of them
  if (interior.length % 2 === 1) interior.push(<BlankPage key="filler" />)

  const leaves: Leaf[] = [
    { front: <Cover seed={seed} typeLabel={typeLabel} modules={plan.length} />, back: null, hard: true },
    ...Array.from({ length: interior.length / 2 }, (_, i) => ({ front: interior[2 * i], back: interior[2 * i + 1] })),
    { front: null, back: <BackCover />, hard: true },
  ]
  const total = leaves.length

  /** How many leaves have been turned from the right stack onto the left one. */
  const [turned, setTurned] = useState(0)
  const [flip, setFlip] = useState<Flip | null>(null)

  // once a flip is sitting at an angle other than where it should end up, move it there a frame
  // later (so the browser actually animates the change instead of starting there outright); a drag
  // release re-enters this the same way, just starting from wherever the pointer left it
  useEffect(() => {
    if (!flip || flip.dragging || flip.angle === targetAngle(flip)) return
    const id = requestAnimationFrame(() => setFlip((f) => f && { ...f, angle: targetAngle(f) }))
    return () => cancelAnimationFrame(id)
  }, [flip])

  const turn = useCallback(
    (dir: 1 | -1) => {
      if (flip) return
      if (dir === 1 ? turned >= total : turned <= 0) return
      setFlip({ index: dir === 1 ? turned : turned - 1, dir, angle: 0, dragging: false, committed: true, startX: 0, width: 0 })
    },
    [flip, turned, total],
  )

  const grab = (dir: 1 | -1) => (e: PointerEvent<HTMLDivElement>) => {
    if (flip) return
    if (dir === 1 ? turned >= total : turned <= 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setFlip({
      index: dir === 1 ? turned : turned - 1,
      dir,
      angle: 0,
      dragging: true,
      committed: false,
      startX: e.clientX,
      width: e.currentTarget.getBoundingClientRect().width,
    })
  }

  const drag = (e: PointerEvent<HTMLDivElement>) => {
    if (!flip?.dragging) return
    const dx = e.clientX - flip.startX
    const progress = Math.max(0, Math.min(1, (flip.dir === 1 ? -dx : dx) / flip.width))
    setFlip((f) => f && { ...f, angle: (f.dir === 1 ? -180 : 180) * progress })
  }

  const release = (e: PointerEvent<HTMLDivElement>) => {
    if (!flip?.dragging) return
    const moved = Math.abs(e.clientX - flip.startX) > CLICK_SLOP
    const progress = Math.abs(flip.angle) / 180
    const committed = !moved || progress >= 0.5
    const final = committed ? (flip.dir === 1 ? -180 : 180) : 0
    // already sitting exactly at the resting angle (dragged all the way before letting go): nothing
    // left to animate, so settle right away instead of waiting for a transition that never fires
    if (flip.angle === final) {
      if (committed) setTurned((t) => t + flip.dir)
      setFlip(null)
    } else {
      setFlip((f) => f && { ...f, dragging: false, committed })
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') turn(1)
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') turn(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [turn])

  const settle = (e: TransitionEvent) => {
    if (e.propertyName !== 'transform' || !flip) return
    if (flip.committed) setTurned((t) => t + flip.dir)
    setFlip(null)
  }

  // the static spread underneath the turning leaf: unaffected side keeps showing what it already
  // had, the other side reveals the leaf now on top of its stack
  const rightLeaf = flip?.dir === 1 ? leaves[flip.index + 1] : leaves[turned]
  const leftLeaf = flip?.dir === -1 ? leaves[flip.index - 1] : leaves[turned - 1]

  const last = total

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
          <div className="book-spread">
            <div className="book-slot is-left" onPointerDown={grab(-1)} onPointerMove={drag} onPointerUp={release} onPointerCancel={release}>
              {leftLeaf === undefined ? null : leftLeaf.back ?? <BlankPage />}
            </div>
            <div className="book-slot is-right" onPointerDown={grab(1)} onPointerMove={drag} onPointerUp={release} onPointerCancel={release}>
              {rightLeaf === undefined ? null : rightLeaf.front ?? <BlankPage />}
            </div>
            {flip && <TurningLeaf leaf={leaves[flip.index]} dir={flip.dir} angle={flip.angle} dragging={flip.dragging} hard={leaves[flip.index].hard} onSettled={settle} />}
          </div>
        </div>
      </div>

      <nav className="book-nav">
        <button className="mg-button" onClick={() => turn(-1)} disabled={turned === 0 || flip !== null}>
          ◀ Zurück
        </button>
        <button className="mg-button" onClick={() => turn(1)} disabled={turned === last || flip !== null}>
          Weiter ▶
        </button>
      </nav>
      <p className="book-help">Seite am Rand greifen und rüberziehen · klicken · ← →</p>
    </div>
  )
}

/** The leaf mid-turn: a hinge at the spine, front facing one way, back the other. */
function TurningLeaf({
  leaf,
  dir,
  angle,
  dragging,
  hard,
  onSettled,
}: {
  leaf: Leaf
  dir: 1 | -1
  angle: number
  dragging: boolean
  hard?: boolean
  onSettled: (e: TransitionEvent) => void
}) {
  return (
    <div
      className={`book-leaf-turn is-${dir === 1 ? 'right' : 'left'} ${hard ? 'is-hard' : ''} ${dragging ? 'is-dragging' : ''}`}
      style={{ transform: `rotateY(${angle}deg)` }}
      onTransitionEnd={onSettled}
    >
      <div className="book-leaf-face is-front">{leaf.front ?? <BlankPage />}</div>
      <div className="book-leaf-face is-back">{leaf.back ?? <BlankPage />}</div>
    </div>
  )
}

function BlankPage() {
  return <article className="book-paper" aria-hidden />
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

function HowTo({ seed, typeLabel, page }: { seed: number; typeLabel: string; page: number }) {
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
      <p className="book-folio">– {page} –</p>
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
