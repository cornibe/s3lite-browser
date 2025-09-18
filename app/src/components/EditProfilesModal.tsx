import React, { useEffect, useMemo, useRef, useState } from 'react'

type Props = { isOpen: boolean; onClose: () => void; onSaved?: () => void }
type SectionMap = Record<string, Record<string, string>>

type ProfileType = 'standard' | 'temp' | 'assume-role'
const ALLOWED_CRED_KEYS: Array<'aws_access_key_id'|'aws_secret_access_key'|'aws_session_token'> = ['aws_access_key_id','aws_secret_access_key','aws_session_token']
const ALLOWED_CONFIG_KEYS: Array<'region'|'role_arn'|'source_profile'|'credential_source'> = ['region','role_arn','source_profile','credential_source']

function parseIni(text: string): SectionMap {
  const sections: SectionMap = {}
  let current: string | null = null
  const cleaned = (text || '').replace(/^\uFEFF/, '')
  for (const raw of cleaned.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const m = line.match(/^\[(.+?)\]$/)
    if (m) { current = m[1].trim(); if (!sections[current]) sections[current] = {}; continue }
    if (!current) continue
    const idx = line.indexOf('=')
    if (idx > 0) { const k = line.slice(0, idx).trim(); const v = line.slice(idx+1).trim(); sections[current][k] = v }
  }
  return sections
}

function stringifyIni(sections: SectionMap): string {
  const lines: string[] = []
  for (const name of Object.keys(sections)) {
    lines.push(`[${name}]`)
    const body = sections[name] || {}
    for (const k of Object.keys(body)) lines.push(`${k} = ${body[k]}`)
    lines.push('')
  }
  return lines.join('\n')
}

function mergeCredsConfig(credentialsText: string, configText: string): SectionMap {
  const creds = parseIni(credentialsText)
  const cfg = parseIni(configText)
  const combined: SectionMap = {}
  for (const name of Object.keys(creds)) {
    const norm = name
    combined[norm] = { ...creds[name] }
    const cfgName = `profile ${name.startsWith('profile ') ? name.replace(/^profile\s+/, '') : name}`
    if (cfg[cfgName]) Object.assign(combined[norm], cfg[cfgName])
  }
  for (const name of Object.keys(cfg)) {
    if (name.startsWith('profile ')) {
      const short = name.slice('profile '.length)
      if (!combined[short]) combined[short] = { ...cfg[name] }
    } else if (name.startsWith('sso-session ')) {
      combined[name] = { ...cfg[name] }
    }
  }
  return combined
}

export default function EditProfilesModal({ isOpen, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [credsRaw, setCredsRaw] = useState('')
  const [configRaw, setConfigRaw] = useState('')
  const [paths, setPaths] = useState<{ creds?: string; cfg?: string }>({})
  const [selected, setSelected] = useState<string | undefined>()
  const [editing, setEditing] = useState<{ name: string } | null>(null)
  const rightRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setLoading(true); setError(undefined)
    ;(async () => {
      try {
        const files = await (window as any).api.s3.getAwsFiles()
        setCredsRaw(files.credentialsText || '')
        setConfigRaw(files.configText || '')
        setPaths({ creds: files.credentialsPath, cfg: files.configPath })
      } catch (e) {
        setError((e as Error)?.message || 'Failed to load AWS files')
      } finally { setLoading(false) }
    })()
  }, [isOpen])

  const combined = useMemo(() => mergeCredsConfig(credsRaw, configRaw), [credsRaw, configRaw])
  const profiles = useMemo(() => Object.keys(combined).filter(n => !n.startsWith('sso-session ')), [combined])
  const [query, setQuery] = useState('')
  const filteredProfiles = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return profiles
    return profiles.filter(name => {
      const vals = Object.values(combined[name] || {})
      const hay = (name + ' ' + vals.join(' ')).toLowerCase()
      return hay.includes(q)
    })
  }, [profiles, combined, query])

  const findSectionBounds = React.useCallback((text: string, sectionName: string) => {
    if (!sectionName) return null
    const header = `[${sectionName}]`
    let start = -1
    // Prefer match at line start: "\n[section]" or beginning of file "[section]"
    const afterNl = text.indexOf('\n' + header)
    if (afterNl !== -1) start = afterNl + 1
    else if (text.startsWith(header)) start = 0
    else {
      const idx = text.indexOf(header)
      if (idx > 0 && (text[idx - 1] === '\n')) start = idx
    }
    if (start === -1) return null
    const next = text.indexOf('\n[', start + header.length)
    const end = next === -1 ? text.length : next + 1 // position of '[' of next header
    return { start, end }
  }, [])

  useEffect(() => {
    if (!selected || !rightRef.current) return
    // Don't steal focus from the editor modal
    if (editing) return
    const text = rightRef.current.value
    const bounds = findSectionBounds(text, selected)
    if (bounds) {
      let start = bounds.start
      let end = bounds.end
  // Do not highlight trailing empty/whitespace-only lines
  const seg = text.slice(start, end)
  const trailing = seg.match(/\s+$/)
  if (trailing) end = end - trailing[0].length
  rightRef.current.selectionStart = start
  rightRef.current.selectionEnd = end
      rightRef.current.focus()
    }
  }, [selected, editing])


  function openEdit() { if (selected) setEditing({ name: selected }) }
  function openEditFor(name: string) { setSelected(name); setEditing({ name }) }

  // Using native selection highlight; no overlay parts needed

  function applyEdit(name: string, values: Record<string, string | undefined>) {
    const creds = parseIni(credsRaw)
    const cfg = parseIni(configRaw)
    const short = name.startsWith('profile ') ? name.slice('profile '.length) : name
    const cfgName = `profile ${short}`
    // apply credential keys (allowed only)
    const nextCred: Record<string,string> = {}
    for (const k of ALLOWED_CRED_KEYS) {
      const v = values[k]
      if (v && v.trim()) nextCred[k] = v.trim()
    }
    if (Object.keys(nextCred).length > 0) creds[short] = nextCred
    else delete creds[short]
    // apply config keys (allowed only)
    const nextCfg: Record<string,string> = {}
    for (const k of ALLOWED_CONFIG_KEYS) {
      const v = values[k]
      if (v && v.trim()) nextCfg[k] = v.trim()
    }
    if (Object.keys(nextCfg).length > 0) cfg[cfgName] = nextCfg
    else delete cfg[cfgName]
    setCredsRaw(stringifyIni(creds))
    setConfigRaw(stringifyIni(cfg))
  }

  async function saveEntryToDisk() {
    try {
      const res = await (window as any).api.s3.writeAwsFiles({ credentialsText: credsRaw, configText: configRaw })
      if (!res?.ok) throw new Error(res?.error || 'Failed to save')
      // Refresh the AWS files after saving to show the updated content
      const files = await (window as any).api.s3.getAwsFiles()
      setCredsRaw(files.credentialsText || '')
      setConfigRaw(files.configText || '')
      if (onSaved) onSaved()
    } catch (e) {
      setError((e as Error)?.message || 'Failed to save')
    }
  }

  if (!isOpen) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={(e) => {
        if (e.key === 'Escape') { onClose(); return }
        // Don't handle navigation if we're in an input field or if editing modal is open
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editing) return
        if (filteredProfiles.length === 0) return
        const idx = Math.max(0, filteredProfiles.indexOf(selected || ''))
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          const next = selected ? (idx + 1) % filteredProfiles.length : 0
          setSelected(filteredProfiles[next])
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          const next = selected ? (idx - 1 + filteredProfiles.length) % filteredProfiles.length : filteredProfiles.length - 1
          setSelected(filteredProfiles[next])
        } else if (e.key === 'Enter') {
          if (selected) openEdit()
        }
      }}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative menu-bg border border-default rounded shadow-xl w-[900px] h-[600px] max-w-[96vw] max-h-[96vh] p-4 flex flex-col">
        <div className="flex items-center gap-3 mb-2">
          <div className="text-lg font-semibold">AWS Profiles</div>
          <div className="ml-auto text-xs opacity-70">
            <div>credentials: <span className="opacity-80">{paths.creds}</span></div>
            <div>config: <span className="opacity-80">{paths.cfg}</span></div>
          </div>
        </div>
        {error && <div className="mb-2 text-sm text-red-600">{error}</div>}
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm opacity-70">Loading…</div>
        ) : (
          <div className="flex-1 grid grid-cols-3 gap-3 min-h-0">
            <div className="col-span-1 border border-default rounded p-2 overflow-auto">
              <div className="text-xs uppercase opacity-70 mb-2">Profiles</div>
              <input
                className="w-full px-2 py-1 rounded border text-sm input-theme mb-2"
                placeholder="Search profiles (name, access key, ...)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <ul className="text-sm">
                {filteredProfiles.map(name => (
                  <li key={name}>
                    <button
                      className={`w-full text-left px-2 py-1 rounded ${selected === name ? 'selected-row' : 'row-hover'}`}
                      onClick={() => setSelected(name)}
                      onDoubleClick={() => openEditFor(name)}
                      title="Double-click to edit"
                    >
                      <span className="truncate inline-block max-w-full">{name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="col-span-2 flex flex-col min-h-0">
              <div className="flex items-center gap-2 mb-2">
                <button className="text-xs px-2 py-1 bg-[#0e639c] text-white rounded hover:bg-[#1177bb] disabled:opacity-50" disabled={!selected} onClick={openEdit}>Edit entry…</button>
              </div>
              <div className="relative flex-1 min-h-0">
                <textarea
                  ref={rightRef}
                  className="absolute inset-0 w-full h-full rounded border input-theme font-mono text-sm p-2 resize-none bg-transparent"
                  value={credsRaw}
                  readOnly
                  spellCheck={false}
                  wrap="off"
                  onScroll={() => {}}
                />
              </div>
              <div className="mt-2 text-xs opacity-70">Read-only view of the credentials file. Select a profile on the left to jump; click Edit entry… to modify with a form.</div>
            </div>
          </div>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>

      {editing && (
        <EditProfileEntryModal
          name={editing.name}
          initial={combined[editing.name] || {}}
          sourceOptions={profiles.filter(p => p !== editing.name)}
          onCancel={() => setEditing(null)}
          onSave={async (vals) => { applyEdit(editing.name, vals); await saveEntryToDisk(); setEditing(null) }}
        />
      )}
    </div>
  )
}

// Move Field component outside to prevent recreation on each render
function Field({ k, label, placeholder, type: inputType = 'text', vals, setVals }: { 
  k: string; 
  label: string; 
  placeholder?: string; 
  type?: string;
  vals: Record<string, string>;
  setVals: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input
        className="w-full px-2 py-1 rounded border text-sm input-theme"
        value={vals[k] || ''}
        placeholder={placeholder}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={e => setVals(s => ({ ...s, [k]: e.target.value }))}
        type={inputType}
      />
    </div>
  )
}

function EditProfileEntryModal({ name, initial, sourceOptions = [], onCancel, onSave }: { name: string; initial: Record<string, string>; sourceOptions?: string[]; onCancel: () => void; onSave: (vals: Record<string, string>) => void | Promise<void> }) {
  const inferType = (v: Record<string, string>): ProfileType => {
    if (v.role_arn) return 'assume-role'
    if (v.aws_session_token) return 'temp'
    return 'standard'
  }
  const [type, setType] = useState<ProfileType>(() => inferType(initial))
  const [vals, setVals] = useState<Record<string, string>>(() => ({
    region: initial.region || '',
    aws_access_key_id: initial.aws_access_key_id || '',
    aws_secret_access_key: initial.aws_secret_access_key || '',
    aws_session_token: initial.aws_session_token || '',
    role_arn: initial.role_arn || '',
    source_profile: initial.source_profile || '',
    credential_source: initial.credential_source || ''
  }))
  const [busy, setBusy] = useState(false)

  const saveSanitized = async () => {
    // Only keep keys relevant to selected type + region
    const out: Record<string, string> = {}
    if (vals.region) out.region = vals.region
    if (type === 'standard') {
      if (vals.aws_access_key_id) out.aws_access_key_id = vals.aws_access_key_id
      if (vals.aws_secret_access_key) out.aws_secret_access_key = vals.aws_secret_access_key
    } else if (type === 'temp') {
      if (vals.aws_access_key_id) out.aws_access_key_id = vals.aws_access_key_id
      if (vals.aws_secret_access_key) out.aws_secret_access_key = vals.aws_secret_access_key
      if (vals.aws_session_token) out.aws_session_token = vals.aws_session_token
    } else if (type === 'assume-role') {
      if (vals.role_arn) out.role_arn = vals.role_arn
      if (vals.credential_source) out.credential_source = vals.credential_source
      if (vals.source_profile) out.source_profile = vals.source_profile
    }
    await onSave(out)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onKeyDown={(e) => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/40" onClick={() => !busy && onCancel()} />
      <div className="relative menu-bg border border-default rounded shadow-xl w-[720px] max-w-[95vw] p-4">
        <div className="text-lg font-semibold mb-3">Edit “{name}”</div>
        <div className="mb-3 flex gap-4 items-center text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="ptype" checked={type==='standard'} onChange={() => setType('standard')} /> Standard</label>
          <label className="flex items-center gap-2"><input type="radio" name="ptype" checked={type==='temp'} onChange={() => setType('temp')} /> Temp credentials</label>
          <label className="flex items-center gap-2"><input type="radio" name="ptype" checked={type==='assume-role'} onChange={() => setType('assume-role')} /> Assume role</label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field k="region" label="region" placeholder="e.g. us-east-1" vals={vals} setVals={setVals} />
          {type !== 'assume-role' && (
            <>
              <Field k="aws_access_key_id" label="aws_access_key_id" vals={vals} setVals={setVals} />
              <Field k="aws_secret_access_key" label="aws_secret_access_key" vals={vals} setVals={setVals} />
            </>
          )}
          {type === 'temp' && (
            <Field k="aws_session_token" label="aws_session_token" vals={vals} setVals={setVals} />
          )}
          {type === 'assume-role' && (
            <>
              <Field k="role_arn" label="role_arn" placeholder="arn:aws:iam::123456789012:role/RoleName" vals={vals} setVals={setVals} />
              <Field k="credential_source" label="credential_source" placeholder="Env or Ec2InstanceMetadata" vals={vals} setVals={setVals} />
              <div>
                <label className="block text-sm font-medium mb-1">source_profile</label>
                <select className="w-full px-2 py-1 rounded border text-sm input-theme"
                  onKeyDown={(e) => e.stopPropagation()}
                  value={vals.source_profile || ''}
                  onChange={e => setVals(s => ({ ...s, source_profile: e.target.value }))}
                >
                  <option value="">(none)</option>
                  {sourceOptions.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { await saveSanitized() } finally { setBusy(false) } }}>Save</button>
        </div>
      </div>
    </div>
  )
}
