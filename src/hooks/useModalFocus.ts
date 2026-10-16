import { useEffect } from 'react'

const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/** Apply focus containment to lazy-loaded and nested dialogs as they mount. */
export const useModalFocus = () => {
  useEffect(() => {
    let active: HTMLElement | undefined
    const previousFocus = new WeakMap<HTMLElement, HTMLElement>()
    const focusable = () => active ? Array.from(active.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0) : []
    const focusFirst = () => {
      if (!active) return
      const first = focusable()[0]
      if (first) first.focus()
      else { active.tabIndex = -1; active.focus() }
    }
    const synchronize = () => {
      const next = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).at(-1)
      if (active === next) return
      const previous = active
      active = next
      if (previous && !previous.isConnected) {
        const origin = previousFocus.get(previous)
        previousFocus.delete(previous)
        if (origin?.isConnected) origin.focus()
      }
      if (next) {
        if (!previousFocus.has(next) && document.activeElement instanceof HTMLElement) previousFocus.set(next, document.activeElement)
        if (!next.contains(document.activeElement)) focusFirst()
      }
    }
    const onFocus = (event: FocusEvent) => {
      if (active && !active.contains(event.target as Node)) focusFirst()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !active) return
      const elements = focusable()
      const first = elements[0]
      const last = elements.at(-1)
      if (!first || !active.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault()
        if (event.shiftKey && last) last.focus()
        else focusFirst()
      }
    }
    const observer = new MutationObserver(synchronize)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal'] })
    document.addEventListener('focusin', onFocus)
    document.addEventListener('keydown', onKey, true)
    synchronize()
    return () => {
      observer.disconnect()
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [])
}
