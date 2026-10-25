// Minimal types for StPageFlip (the package ships none). Only what ManualBook uses.
declare module 'page-flip' {
  export type FlipSettings = {
    width: number
    height: number
    size?: 'fixed' | 'stretch'
    minWidth?: number
    maxWidth?: number
    minHeight?: number
    maxHeight?: number
    drawShadow?: boolean
    flippingTime?: number
    usePortrait?: boolean
    startZIndex?: number
    autoSize?: boolean
    maxShadowOpacity?: number
    showCover?: boolean
    mobileScrollSupport?: boolean
    swipeDistance?: number
    clickEventForward?: boolean
    useMouseEvents?: boolean
    showPageCorners?: boolean
    disableFlipByClick?: boolean
    startPage?: number
  }

  export class PageFlip {
    constructor(element: HTMLElement, settings: FlipSettings)
    loadFromHTML(items: HTMLElement[] | NodeListOf<HTMLElement>): void
    flipNext(corner?: 'top' | 'bottom'): void
    flipPrev(corner?: 'top' | 'bottom'): void
    turnToPage(page: number): void
    getCurrentPageIndex(): number
    getPageCount(): number
    on(event: 'flip', callback: (e: { data: number }) => void): PageFlip
    on(event: 'changeOrientation', callback: (e: { data: 'portrait' | 'landscape' }) => void): PageFlip
    on(event: 'changeState', callback: (e: { data: 'user_fold' | 'fold_corner' | 'flipping' | 'read' }) => void): PageFlip
    destroy(): void
  }
}
