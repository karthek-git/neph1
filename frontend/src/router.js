import { useEffect, useState } from 'react'

// Tiny hash router: #/  ->  projects,  #/p/<id>[/<tab>[/<analysisId>]]  ->  project
const parse = () => {
  const h = window.location.hash.replace(/^#\/?/, '')
  return h ? h.split('/').filter(Boolean) : []
}

export function useRoute() {
  const [parts, setParts] = useState(parse())
  useEffect(() => {
    const on = () => setParts(parse())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return parts
}

export const go = (...parts) => {
  window.location.hash = '/' + parts.filter(Boolean).join('/')
}
