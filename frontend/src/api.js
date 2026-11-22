// Thin fetch wrapper. Errors carry the server's message so the UI can show it.
async function req(path, opts = {}) {
  const r = await fetch('/api' + path, opts)
  if (!r.ok) {
    let msg = r.statusText, detail = null
    try {
      const j = await r.json()
      detail = j.detail ?? j
      msg = typeof detail === 'string' ? detail : (detail?.message || JSON.stringify(detail))
    } catch { /* not json */ }
    const err = new Error(msg || `Error ${r.status}`)
    err.status = r.status
    err.detail = detail
    throw err
  }
  if (r.status === 204) return null
  return (r.headers.get('content-type') || '').includes('json') ? r.json() : r.blob()
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  status: () => req('/status'),
  samples: () => req('/projects/samples/list'),
  plan: (pid) => req(`/projects/${pid}/plan`),
  presets: () => req('/whatif/presets'),
  projects: {
    list: () => req('/projects'),
    create: (name, description) => req('/projects', json('POST', { name, description })),
    get: (id) => req(`/projects/${id}`),
    patch: (id, body) => req(`/projects/${id}`, json('PATCH', body)),
    remove: (id) => req(`/projects/${id}`, { method: 'DELETE' }),
  },
  files: {
    list: (pid) => req(`/projects/${pid}/files`),
    upload: (pid, fileList) => {
      const fd = new FormData()
      for (const f of fileList) fd.append('files', f)
      return req(`/projects/${pid}/files`, { method: 'POST', body: fd })
    },
    addSamples: (pid, names) => req(`/projects/${pid}/files/samples`, json('POST', { names })),
    remove: (pid, fid) => req(`/projects/${pid}/files/${fid}`, { method: 'DELETE' }),
    items: (pid, fid) => req(`/projects/${pid}/files/${fid}/items`),
    putItems: (pid, fid, items) => req(`/projects/${pid}/files/${fid}/items`, json('PUT', { items })),
    confirm: (pid, fid) => req(`/projects/${pid}/files/${fid}/confirm`, { method: 'POST' }),
    reparse: (pid, fid) => req(`/projects/${pid}/files/${fid}/reparse`, { method: 'POST' }),
    extract: (pid, fid) => req(`/projects/${pid}/files/${fid}/extract`, { method: 'POST' }),
    source: (pid, fid) => req(`/projects/${pid}/files/${fid}/source`),
  },
  analyses: {
    list: (pid) => req(`/projects/${pid}/analyses`),
    run: (pid, body) => req(`/projects/${pid}/analyses`, json('POST', body)),
    get: (pid, aid) => req(`/projects/${pid}/analyses/${aid}`),
    remove: (pid, aid) => req(`/projects/${pid}/analyses/${aid}`, { method: 'DELETE' }),
  },
  bid: {
    get: (pid, fid) => req(`/projects/${pid}/files/${fid}/bidsheet`),
    put: (pid, fid, body) => req(`/projects/${pid}/files/${fid}/bidsheet`, json('PUT', body)),
    context: (pid, fid) => req(`/projects/${pid}/files/${fid}/offer-context`),
    x84: (pid, fid, includeMarkup = true) => req(`/projects/${pid}/files/${fid}/bid.x84?include_markup=${includeMarkup}`),
    offer: (pid, fid, body) => req(`/projects/${pid}/files/${fid}/offer.docx`, json('POST', body)),
  },
  catalog: {
    list: () => req('/catalog'),
    add: (b) => req('/catalog', json('POST', b)),
    edit: (id, b) => req(`/catalog/${id}`, json('PUT', b)),
    remove: (id) => req(`/catalog/${id}`, { method: 'DELETE' }),
    import: (file) => { const fd = new FormData(); fd.append('file', file); return req('/catalog/import', { method: 'POST', body: fd }) },
    settings: (b) => req('/catalog/settings', b ? json('PUT', b) : undefined),
    suggestions: () => req('/catalog/suggestions'),
    accept: (items) => req('/catalog/suggestions/accept', json('POST', { items })),
    reject: (keys) => req('/catalog/suggestions/reject', json('POST', { keys })),
    log: () => req('/catalog/log'),
  },
  history: {
    get: (pid) => req(`/projects/${pid}/history`),
    put: (pid, body) => req(`/projects/${pid}/history`, json('PUT', body)),
  },
  versions: (pid) => req(`/projects/${pid}/versions`),
  fileNote: (pid, fid, note) => req(`/projects/${pid}/files/${fid}/note`, json('PUT', { note })),
  triage: {
    get: (pid) => req(`/projects/${pid}/triage`),
    put: (pid, fid, status, note = '') => req(`/projects/${pid}/triage/${fid}`, json('PUT', { status, note })),
  },
  qstate: {
    get: (pid) => req(`/projects/${pid}/qstate`),
    put: (pid, key, body) => req(`/projects/${pid}/qstate/${key}`, json('PUT', body)),
  },
  changes: (pid, aid, base = '') => req(`/projects/${pid}/analyses/${aid}/changes${base ? `?base=${base}` : ''}`),
  letter: (pid, aid, keys, deadline = '') => req(`/projects/${pid}/analyses/${aid}/letter.docx`, json('POST', { keys, deadline })),
  whatif: (pid, body) => req(`/projects/${pid}/whatif`, json('POST', body)),
  compare: (pid, body) => req(`/projects/${pid}/compare`, json('POST', body)),
  exportReport: (report) => req('/export.xlsx', json('POST', report)),
  exportBid: (sheet) => req('/bidsheet.xlsx', json('POST', sheet)),
}

export function download(blobOrText, filename, type = 'text/plain;charset=utf-8') {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
