import { useEffect, useState } from 'react'

// Tiny change bus: pages call emitChange() after they create/delete/upload something,
// and the sidebar reloads its project list.
export const emitChange = () => window.dispatchEvent(new Event('calex-change'))

export function useChangeKey() {
  const [k, setK] = useState(0)
  useEffect(() => {
    const on = () => setK((x) => x + 1)
    window.addEventListener('calex-change', on)
    return () => window.removeEventListener('calex-change', on)
  }, [])
  return k
}
