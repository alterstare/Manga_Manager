// Close animations for popups (dropdowns, category panels, context menus,
// autocomplete lists, export/download menus, modals).
//
// React removes a popup's DOM node the moment it closes, so there's nothing left
// to animate. Instead of threading an "exiting" state through every component,
// this watches the DOM: when a popup node is removed while its parent is still
// on the page, the same (now React-detached) node is put back in place as an
// inert ghost with `.pop-closing`, plays the CSS exit animation, then is removed.
// React never touches the ghost again — it already let go of the node.
const POPUP = [
  '.cat-panel',
  '.dropdown-panel',
  '.ctx-menu',
  '.ctx-submenu',
  '.export-menu',
  '.grp-pop',
  '.search-ac-list',
  '.dl-menu',
  '.activity-panel',
  '.modal-overlay'
].join(',')

const EXIT_MS = 120

export function startExitAnimations(): () => void {
  const obs = new MutationObserver((records) => {
    for (const rec of records) {
      const parent = rec.target as Element
      if (!parent.isConnected) continue
      for (const node of rec.removedNodes) {
        if (!(node instanceof HTMLElement) || !node.matches(POPUP)) continue
        if (node.classList.contains('pop-closing')) continue // our own ghost leaving
        // Swapped for a fresh popup of the same kind in the same spot (e.g. the
        // autocomplete switching lists) → no ghost, it would just flicker.
        const cls = node.classList[0]
        if ([...rec.addedNodes].some((n) => n instanceof HTMLElement && n.classList.contains(cls))) continue
        const next = rec.nextSibling && rec.nextSibling.parentNode === parent ? rec.nextSibling : null
        node.classList.add('pop-closing')
        node.setAttribute('aria-hidden', 'true')
        node.setAttribute('inert', '')
        parent.insertBefore(node, next)
        let done = false
        const remove = (): void => {
          if (done) return
          done = true
          node.remove()
        }
        node.addEventListener('animationend', remove, { once: true })
        window.setTimeout(remove, EXIT_MS + 80) // fallback if no animation ran
      }
    }
  })
  obs.observe(document.body, { childList: true, subtree: true })
  return () => obs.disconnect()
}
