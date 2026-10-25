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
  children: ReactNode
}

function Form({ action, submit, onSubmit, disabled = false, children }: FormProps) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!action.pending && !disabled) onSubmit()
  }
  return (
    <form className="hud-form" onSubmit={handleSubmit}>
      {children}
      <button type="submit" disabled={action.pending || disabled}>
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
      <div>Who is learning? Pick a name to get your first island.</div>
      <Form
        action={action}
        submit="Start"
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
      <details className="hud-details">
        <summary>I already have a user id</summary>
        <Form
          action={action}
          submit="Continue"
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
export function You({ me }: { me: UserSummary }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(me.id).then(() => setCopied(true))
  }
  return (
    <details className="hud-details">
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

/** Creates an island, alone or with a partner, and opens it. */
export function NewIsland({ onCreated, open = false }: { onCreated: (islandId: string) => void; open?: boolean }) {
  const action = useAction()
  const [name, setName] = useState('')
  const [partner, setPartner] = useState('')

  return (
    <details className="hud-details" open={open}>
      <summary>New island</summary>
      <Form
        action={action}
        submit="Create island"
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
        <input
          value={partner}
          onChange={(event) => setPartner(event.target.value)}
          placeholder={`Partner (optional): ${PARTNER_HINT}`}
        />
      </Form>
    </details>
  )
}

/**
 * Who learns on this island. A partner can join an island of one; a full island is forked to
 * learn with someone else, and the fork starts with the houses both already know.
 */
export function IslandPartner({ island, onForked }: { island: Island; onForked: (islandId: string) => void }) {
  const action = useAction()
  const [partner, setPartner] = useState('')
  const [name, setName] = useState('')
  const full = island.group.members.length > 1

  if (!full) {
    return (
      <details className="hud-details">
        <summary>Add a partner</summary>
        <div className="hud-note">An island has room for one partner to learn with you.</div>
        <Form
          action={action}
          submit="Add partner"
          disabled={!partner.trim()}
          onSubmit={() =>
            void action.run(async () => {
              await addIslandMember(island.id, partner.trim())
              setPartner('')
              await reloadIslands()
            })
          }
        >
          <input value={partner} onChange={(event) => setPartner(event.target.value)} placeholder={PARTNER_HINT} />
        </Form>
      </details>
    )
  }

  return (
    <details className="hud-details">
      <summary>Learn this with someone else</summary>
      <div className="hud-note">
        Creates a copy of this island for you and a new partner. It shares the houses; each is built as far as you
        both already know its topic.
      </div>
      <Form
        action={action}
        submit="Create shared copy"
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
        <input value={partner} onChange={(event) => setPartner(event.target.value)} placeholder={PARTNER_HINT} />
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={`Name (optional, default "${island.name}")`}
        />
      </Form>
    </details>
  )
}
