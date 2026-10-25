import { Outlet } from 'react-router'
import InviteInbox from './session/InviteInbox'

/** Around every page: game invites can arrive anywhere. */
export default function AppShell() {
  return (
    <>
      <Outlet />
      <InviteInbox />
    </>
  )
}
