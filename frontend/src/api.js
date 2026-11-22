// Thin fetch wrapper. Errors carry the server's message so the UI can show it.
async function req(path, opts = {}) {
  const r = await fetch('/api' + path, opts)
  if (!r.ok) {
    let msg = r.statusText
    try {
      const j = await r.json()
      msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j)
    } catch { /* not json */ }
    throw new Error(msg || `Error ${r.status}`)
  }
  if (r.status === 204) return null
  return (r.headers.get('content-type') || '').includes('json') ? r.json() : r.blob()
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  status: () => req('/status'),
  samples: () => req('/projects/samples/list'),
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
  },
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
