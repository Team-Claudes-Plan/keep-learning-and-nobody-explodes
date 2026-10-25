import { useState, type FormEvent, type ReactNode } from 'react'
import {
  USES_BACKEND,
  addIslandMember,
  createIsland,
  createUser,
  forkIsland,
  setCurrentUserId,
} from '../../api/client'
import { reloadIslands } from '../../api/useIslands'
import type { Island, UserSummary } from '../../api/types'

type Action = {
  pending: boolean
  error: string | null
  /** Runs `task`, keeps its error for display and resolves to `undefined` if it failed. */
  run: <T>(task: () => Promise<T>) => Promise<T | undefined>
}

function useAction(): Action {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async <T,>(task: () => Promise<T>): Promise<T | undefined> => {
    setPending(true)
    setError(null)
    try {
      return await task()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      return undefined
    } finally {
      setPending(false)
    }
  }
  return { pending, error, run }
}

type FormProps = {
  action: Action
  submit: string
  onSubmit: () => void
  disabled?: boolean
  className?: string
  children: ReactNode
}

function Form({ action, submit, onSubmit, disabled = false, className = 'hud-form', children }: FormProps) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!action.pending && !disabled) onSubmit()
  }
  return (
    <form className={className} onSubmit={handleSubmit}>
      {children}
      <button type="submit" className="is-primary" disabled={action.pending || disabled}>
        {action.pending ? '…' : submit}
      </button>
      {action.error && <div className="hud-error">⚠️ {action.error}</div>}
    </form>
  )
}

/** Partners are added by their user id until the backend can look people up. */
const PARTNER_HINT = 'Their user id (they find it under "You")'

/** Asks who is playing and creates the user; the backend trusts the id from then on. */
export function SignIn() {
  const action = useAction()
  const [name, setName] = useState('')
  const [existing, setExisting] = useState('')

  const signIn = async (userId: string) => {
    setCurrentUserId(userId)
    await reloadIslands().catch(() => undefined)
  }

  return (
    <>
      <Form
        action={action}
        submit="Start"
        className="welcome-form"
        disabled={!name.trim()}
        onSubmit={() =>
          void action.run(async () => {
            const id = await createUser(name.trim())
            await signIn(id)
          })
        }
      >
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
      </Form>
      <details className="welcome-details">
        <summary>I already have a user id</summary>
        <Form
          action={action}
          submit="Continue"
          className="welcome-form"
          disabled={!existing.trim()}
          onSubmit={() => void action.run(() => signIn(existing.trim()))}
        >
          <input value={existing} onChange={(event) => setExisting(event.target.value)} placeholder="User id" />
        </Form>
      </details>
    </>
  )
}

/** Shows the current user's id, which others need to add them to an island. */
export function You({ me, className = 'hud-details' }: { me: UserSummary; className?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(me.id).then(() => setCopied(true))
  }
  return (
    <details className={className}>
      <summary>You: {me.name}</summary>
      <div className="hud-note">Share your user id so others can learn with you:</div>
      <code className="hud-id">{me.id}</code>
      <div className="hud-buttons">
        <button type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy id'}
        </button>
        {USES_BACKEND && (
          <button
            type="button"
            onClick={() => {
              setCurrentUserId(null)
              void reloadIslands().catch(() => undefined)
            }}
          >
            Sign out
          </button>
        )}
      </div>
    </details>
  )
}

/**
 * Creates an island, alone or with a partner, and opens it.
 * `inline` shows just the name field, without the collapsible HUD wrapper, for the no-islands dialog.
 */
export function NewIsland({ onCreated, inline = false }: { onCreated: (islandId: string) => void; inline?: boolean }) {
  const action = useAction()
  const [name, setName] = useState('')
  const [partner, setPartner] = useState('')

  const form = (
    <Form
      action={action}
      submit="Create island"
      className={inline ? 'welcome-form' : undefined}
      disabled={!name.trim()}
      onSubmit={() =>
        void action.run(async () => {
          const id = await createIsland(name.trim(), partner.trim() || undefined)
          await reloadIslands()
          setName('')
          setPartner('')
          onCreated(id)
        })
      }
    >
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Semester 1" />
      {!inline && (
        <input
          value={partner}
          onChange={(event) => setPartner(event.target.value)}
          placeholder={`Partner (optional): ${PARTNER_HINT}`}
        />
      )}
    </Form>
  )
  if (inline) return form
  return (
    <details className="hud-details">
      <summary>New island</summary>
      {form}
    </details>
  )
}

/**
 * Who learns on this island. A partner can join an island of one; a full island is forked to
 * learn with someone else, and the fork starts with the houses both already know.
 * `inline` drops the collapsible HUD wrapper, for the invite friends dialog.
 */
export function IslandPartner({
  island,
  onForked,
  inline = false,
}: {
  island: Island
  onForked: (islandId: string) => void
  inline?: boolean
}) {
  const action = useAction()
  const [partner, setPartner] = useState('')
  const [name, setName] = useState('')
  const [added, setAdded] = useState(false)
  const full = island.group.members.length > 1
  const formClass = inline ? 'welcome-form' : undefined
  // The dialog explains where the id comes from, so the field can stay short.
  const hint = inline ? 'Their user id' : PARTNER_HINT

  const wrap = (summary: string, body: ReactNode) =>
    inline ? (
      body
    ) : (
      <details className="hud-details">
        <summary>{summary}</summary>
        {body}
      </details>
    )

  if (!full || added) {
    return wrap(
      'Add a partner',
      <>
        <div className="hud-note">An island has room for one partner to learn with you.</div>
        {added ? (
          <div className="upload-message is-good">Partner added. You can learn together now.</div>
        ) : (
        <Form
          action={action}
          submit="Add partner"
          className={formClass}
          disabled={!partner.trim()}
          onSubmit={() =>
            void action.run(async () => {
              await addIslandMember(island.id, partner.trim())
              setPartner('')
              setAdded(inline)
              await reloadIslands()
            })
          }
        >
          <input value={partner} onChange={(event) => setPartner(event.target.value)} placeholder={hint} />
        </Form>
        )}
      </>,
    )
  }

  return wrap(
    'Learn this with someone else',
    <>
      <div className="hud-note">
        Creates a copy of this island for you and a new partner. It shares the houses; each is built as far as you
        both already know its topic.
      </div>
      <Form
        action={action}
        submit="Create shared copy"
        className={formClass}
        disabled={!partner.trim()}
        onSubmit={() =>
          void action.run(async () => {
            const id = await forkIsland(island.id, partner.trim(), name.trim() || undefined)
            setPartner('')
            setName('')
            await reloadIslands()
            onForked(id)
          })
        }
      >
        <input value={partner} onChange={(event) => setPartner(event.target.value)} placeholder={hint} />
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={`Name (optional, default "${island.name}")`}
        />
      </Form>
    </>,
  )
}
