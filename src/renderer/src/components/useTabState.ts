import { useStore } from '../store'

// Per-tab UI state for the reader's left list (search box, applied query,
// page …). The list component is shared by every tab, so plain useState leaked
// one tab's search into all the others; this keys each value by the active tab
// (kept in the store, not persisted).
export function useTabState<T>(key: string, init: T): [T, (v: T | ((prev: T) => T)) => void] {
  const tabId = useStore((s) => s.activeTabId) ?? ''
  const v = useStore((s) => s.sideState[tabId]?.[key]) as T | undefined
  const set = (nv: T | ((prev: T) => T)): void => {
    const st = useStore.getState()
    const cur = (st.sideState[tabId]?.[key] as T | undefined) ?? init
    st.setSideState(tabId, key, typeof nv === 'function' ? (nv as (p: T) => T)(cur) : nv)
  }
  return [v === undefined ? init : v, set]
}
