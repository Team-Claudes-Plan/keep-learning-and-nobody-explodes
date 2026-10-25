import { useId, type ReactNode } from 'react'

type BannerDialogProps = {
  title: string
  subtitle?: string
  lead?: ReactNode
  children: ReactNode
}

/**
 * Centered low-poly dialog with a faceted banner, for the screens shown before an island exists.
 * Shares the upload dialog's shell; it cannot be dismissed.
 */
export default function BannerDialog({ title, subtitle, lead, children }: BannerDialogProps) {
  const titleId = useId()
  return (
    <div className="upload-backdrop welcome-backdrop">
      <div className="upload-dialog welcome-dialog chamfer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="upload-dialog-face chamfer">
          <div className="welcome-banner chamfer">
            <div className="welcome-banner-face chamfer">
              <div id={titleId} className="welcome-banner-title">
                {title}
              </div>
              {subtitle && <div className="welcome-banner-subtitle">{subtitle}</div>}
            </div>
          </div>
          {lead && <div className="welcome-lead">{lead}</div>}
          {children}
        </div>
      </div>
    </div>
  )
}
