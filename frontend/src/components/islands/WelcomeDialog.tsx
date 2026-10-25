import BannerDialog from './BannerDialog'
import { SignIn } from './IslandActions'

/** Sign-in dialog shown before the user has picked a name. */
export default function WelcomeDialog() {
  return (
    <BannerDialog
      title="Welcome!"
      subtitle="Keep learning and nobody explodes"
      lead="Who is learning? Pick a name to get your first island."
    >
      <SignIn />
    </BannerDialog>
  )
}
