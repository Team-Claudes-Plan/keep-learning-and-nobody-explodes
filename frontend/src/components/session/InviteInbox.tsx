import { useNavigate } from 'react-router'
import { answerInvite, useUserChannel, type Invite } from '../../api/invites'
import { useIslandHouse } from '../../data/useIslandHouse'
import { gamePath } from '../../game/useInviteFlow'

/** Game invites to me, on every page. Accepting takes me to the game as the expert. */
export default function InviteInbox() {
  const { incoming } = useUserChannel()
  const invite = incoming[0]
  if (!invite) return null
  return <InviteCard key={invite.id} invite={invite} more={incoming.length - 1} />
}

function InviteCard({ invite, more }: { invite: Invite; more: number }) {
  const navigate = useNavigate()
  const house = useIslandHouse(invite.islandId, invite.topicId)
  const placed = house.status === 'ready' ? house.placed : null
  const storey = placed?.house.storeys.find((entry) => entry.id === invite.storeyId)
  const where = [placed?.name, storey?.label].filter(Boolean).join(' · ')

  function accept() {
    answerInvite(invite.id, true)
    navigate(gamePath(invite.gameId, 'expert', invite.islandId))
  }

  return (
    <aside className="invite-card" role="alertdialog" aria-labelledby={`invite-${invite.id}`}>
      <div className="session-alert-tape is-calm" aria-hidden />
      <div className="invite-card-body">
        <strong id={`invite-${invite.id}`}>📨 Einladung von {invite.from.name}</strong>
        <p>
          {invite.from.name} will mit dir eine Bombe entschärfen{where ? <> in <b>{where}</b></> : null}. Du fängst mit dem
          Handbuch an.
        </p>
        <div className="invite-card-buttons">
          <button className="session-chunky is-go" onClick={accept}>
            Annehmen
          </button>
          <button className="session-chunky is-grey" onClick={() => answerInvite(invite.id, false)}>
            Ablehnen
          </button>
        </div>
        {more > 0 && <small>+{more} weitere</small>}
      </div>
    </aside>
  )
}
