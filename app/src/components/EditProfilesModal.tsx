import React, { useEffect, useMemo, useRef, useState } from 'react'
import { debug as logDebug, info as logInfo, warn as logWarn, error as logError } from '../lib/log'

type Props = { isOpen: boolean; onClose: () => void; onSaved?: () => void }
type SectionMap = Record<string, Record<string, string>>

type ProfileType = 'standard' | 'temp' | 'assume-role'
const ALLOWED_CRED_KEYS: Array<'aws_access_key_id'|'aws_secret_access_key'|'aws_session_token'> = ['aws_access_key_id','aws_secret_access_key','aws_session_token']
const ALLOWED_CONFIG_KEYS: Array<'region'|'role_arn'|'source_profile'|'credential_source'|'role_session_name'|'external_id'|'duration_seconds'|'mfa_serial'> = [
  'region',
  'role_arn',
  'source_profile',
  'credential_source',
  'role_session_name',
  'external_id',
  'duration_seconds',
  'mfa_serial'
]

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
  const [error, setError] = useState(undefined as string | undefined)
  const [credsRaw, setCredsRaw] = useState('')
  const [configRaw, setConfigRaw] = useState('')
  const [paths, setPaths] = useState({} as { creds?: string; cfg?: string })
  const [selected, setSelected] = useState(undefined as string | undefined)
  const [editing, setEditing] = useState(null as { name: string } | null)
  const rightRef = useRef(null as HTMLTextAreaElement | null)
  const listContainerRef = useRef(null as HTMLUListElement | null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())

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
  
  // Create a combined display text showing both credentials and config files
  const combinedDisplayText = useMemo(() => {
    if (!credsRaw && !configRaw) return ''
    
    let result = ''
    
    if (credsRaw.trim()) {
      result += '# ============ CREDENTIALS FILE ============\n'
      result += '# ' + (paths.creds || 'credentials') + '\n\n'
      result += credsRaw
      if (!credsRaw.endsWith('\n')) result += '\n'
    }
    
    if (configRaw.trim()) {
      if (result) result += '\n'
      result += '# ============ CONFIG FILE ============\n'
      result += '# ' + (paths.cfg || 'config') + '\n\n'
      result += configRaw
      if (!configRaw.endsWith('\n')) result += '\n'
    }
    
    return result
  }, [credsRaw, configRaw, paths])
  
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState(null as { from: string } | null)
  const filteredProfiles = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return profiles
    return profiles.filter(name => {
      const vals = Object.values(combined[name] || {})
      const hay = (name + ' ' + vals.join(' ')).toLowerCase()
      return hay.includes(q)
    })
  }, [profiles, combined, query])

  // Ensure a valid selection exists within the filtered set
  useEffect(() => {
    if (filteredProfiles.length === 0) return
    if (!selected || !filteredProfiles.includes(selected)) {
      setSelected(filteredProfiles[0])
    }
  }, [filteredProfiles, selected])

  const findSectionBounds = React.useCallback((text: string, sectionName: string) => {
    if (!sectionName) return null
    
    // Look for the profile in both credentials and config sections
    const credHeader = `[${sectionName}]`
    const configHeader = `[profile ${sectionName}]`
    
    let bestMatch: string | null = null
    let bestStart = -1
    
    // Check for credentials section [profilename]
    const credAfterNl = text.indexOf('\n' + credHeader)
    if (credAfterNl !== -1) {
      bestStart = credAfterNl + 1
      bestMatch = credHeader
    } else if (text.startsWith(credHeader)) {
      bestStart = 0
      bestMatch = credHeader
    }
    
    // Check for config section [profile profilename]
    const configAfterNl = text.indexOf('\n' + configHeader)
    if (configAfterNl !== -1 && (bestStart === -1 || configAfterNl < bestStart)) {
      bestStart = configAfterNl + 1
      bestMatch = configHeader
    } else if (text.startsWith(configHeader) && bestStart === -1) {
      bestStart = 0
      bestMatch = configHeader
    }
    
    if (bestStart === -1 || !bestMatch) return null
    
    const next = text.indexOf('\n[', bestStart + bestMatch.length)
    const end = next === -1 ? text.length : next + 1
    return { start: bestStart, end }
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
  }, [selected, editing, combinedDisplayText, findSectionBounds])

  // Keep the selected item visible in the list
  useEffect(() => {
    if (!selected) return
    const el = itemRefs.current.get(selected)
    if (el) {
      try { el.scrollIntoView({ block: 'nearest' }) } catch {}
    }
  }, [selected, filteredProfiles])


  function openEdit() { if (selected) setEditing({ name: selected }) }
  function openEditFor(name: string) { setSelected(name); setEditing({ name }) }
  function openCreate() { setCreating(true) }
  function openRename() { if (selected) setRenaming({ from: selected }) }

  function renameProfile(from: string, to: string): { credentialsText: string; configText: string } {
    const creds = parseIni(credsRaw)
    const cfg = parseIni(configRaw)
    const fromShort = from.startsWith('profile ') ? from.slice('profile '.length) : from
    const toShort = to.startsWith('profile ') ? to.slice('profile '.length) : to
    const fromCfg = `profile ${fromShort}`
    const toCfg = `profile ${toShort}`

    if (fromShort !== toShort) {
      if (creds[fromShort]) {
        creds[toShort] = { ...creds[fromShort] }
        delete creds[fromShort]
      }
      if (cfg[fromCfg]) {
        cfg[toCfg] = { ...cfg[fromCfg] }
        delete cfg[fromCfg]
      }
    }
    const newCreds = stringifyIni(creds)
    const newCfg = stringifyIni(cfg)
    logInfo('profiles', 'rename applied', { from: fromShort, to: toShort, credsBytes: newCreds.length, cfgBytes: newCfg.length })
    setCredsRaw(newCreds)
    setConfigRaw(newCfg)
    return { credentialsText: newCreds, configText: newCfg }
  }

  // Using native selection highlight; no overlay parts needed

  // Apply changes and return new serialized contents so we can persist exact bytes (avoid async setState race)
  function applyEdit(name: string, values: Record<string, string | undefined>): { credentialsText: string; configText: string } {
    const creds = parseIni(credsRaw)
    const cfg = parseIni(configRaw)
    const short = name.startsWith('profile ') ? name.slice('profile '.length) : name
    const cfgName = `profile ${short}`
    
    // Start with existing credential data for this profile
    const nextCred: Record<string,string> = { ...(creds[short] || {}) }
    // Apply credential key updates (allowed only)
    for (const k of ALLOWED_CRED_KEYS) {
      if (values.hasOwnProperty(k)) {
        const v = values[k]
        if (v && v.trim()) {
          nextCred[k] = v.trim()
        } else {
          // If the value is empty, remove the key
          delete nextCred[k]
        }
      }
    }
    if (Object.keys(nextCred).length > 0) {
      creds[short] = nextCred
    } else {
      delete creds[short]
    }
    
    // Start with existing config data for this profile
    const nextCfg: Record<string,string> = { ...(cfg[cfgName] || {}) }
    // Apply config key updates (allowed only)
    for (const k of ALLOWED_CONFIG_KEYS) {
      if (values.hasOwnProperty(k)) {
        const v = values[k]
        if (v && v.trim()) {
          nextCfg[k] = v.trim()
        } else {
          // If the value is empty, remove the key
          delete nextCfg[k]
        }
      }
    }
    if (Object.keys(nextCfg).length > 0) {
      cfg[cfgName] = nextCfg
    } else {
      delete cfg[cfgName]
    }

  const newCreds = stringifyIni(creds)
  const newCfg = stringifyIni(cfg)
  logDebug('profiles', 'applyEdit result', { profile: short, credsBytes: newCreds.length, cfgBytes: newCfg.length })
    setCredsRaw(newCreds)
    setConfigRaw(newCfg)
    return { credentialsText: newCreds, configText: newCfg }
  }

  async function saveEntryToDisk(params?: { credentialsText: string; configText: string }) {
    try {
  const toWrite = params ?? { credentialsText: credsRaw, configText: configRaw }
  logInfo('profiles', 'writeAwsFiles request', { credsBytes: (toWrite.credentialsText||'').length, cfgBytes: (toWrite.configText||'').length })
      const res = await (window as any).api.s3.writeAwsFiles(toWrite)
      if (!res?.ok) throw new Error(res?.error || 'Failed to save')
      // Refresh the AWS files after saving to show the updated content
      const files = await (window as any).api.s3.getAwsFiles()
  logDebug('profiles', 'writeAwsFiles reload', { credsBytes: (files.credentialsText||'').length, cfgBytes: (files.configText||'').length })
      setCredsRaw(files.credentialsText || '')
      setConfigRaw(files.configText || '')
      if (onSaved) onSaved()
    } catch (e) {
  const msg = (e as Error)?.message || 'Failed to save'
  logError('profiles', 'writeAwsFiles failed', { error: msg })
      setError(msg)
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
  {error && <div className="alert alert-error mb-2 text-sm">{error}</div>}
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
              <ul
                ref={listContainerRef}
                className="text-sm outline-none"
                role="listbox"
                aria-label="AWS profiles"
                tabIndex={0}
                onKeyDown={(e) => {
                  // Avoid interfering with text input
                  const tag = (e.target as HTMLElement)?.tagName
                  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
                  if (filteredProfiles.length === 0) return
                  const idx = Math.max(0, filteredProfiles.indexOf(selected || ''))
                  if (e.key === 'ArrowDown') {
                    e.preventDefault(); e.stopPropagation()
                    const next = selected ? (idx + 1) % filteredProfiles.length : 0
                    setSelected(filteredProfiles[next])
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault(); e.stopPropagation()
                    const next = selected ? (idx - 1 + filteredProfiles.length) % filteredProfiles.length : filteredProfiles.length - 1
                    setSelected(filteredProfiles[next])
                  } else if (e.key === 'Home') {
                    e.preventDefault(); e.stopPropagation()
                    setSelected(filteredProfiles[0])
                  } else if (e.key === 'End') {
                    e.preventDefault(); e.stopPropagation()
                    setSelected(filteredProfiles[filteredProfiles.length - 1])
                  } else if (e.key === 'Enter') {
                    e.preventDefault(); e.stopPropagation()
                    if (selected) openEdit()
                  }
                }}
              >
                {filteredProfiles.map(name => (
                  <li key={name} role="option" aria-selected={selected === name}>
                    <button
                      ref={(el) => {
                        if (el) itemRefs.current.set(name, el); else itemRefs.current.delete(name)
                      }}
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
                <button className="text-xs px-2 py-1 bg-[#0e639c] text-white rounded hover:bg-[#1177bb]" onClick={openCreate}>New profile…</button>
                <button className="text-xs px-2 py-1 bg-[#0e639c] text-white rounded hover:bg-[#1177bb] disabled:opacity-50" disabled={!selected} onClick={openEdit}>Edit…</button>
                <button className="text-xs px-2 py-1 bg-[#0e639c] text-white rounded hover:bg-[#1177bb] disabled:opacity-50" disabled={!selected} onClick={openRename}>Rename…</button>
              </div>
              <div className="relative flex-1 min-h-0">
                <textarea
                  ref={rightRef}
                  className="absolute inset-0 w-full h-full rounded border input-theme font-mono text-sm p-2 resize-none bg-transparent"
                  value={combinedDisplayText}
                  readOnly
                  spellCheck={false}
                  wrap="off"
                  onScroll={() => {}}
                />
              </div>
              <div className="mt-2 text-xs opacity-70">Read-only view of both credentials and config files. Select a profile on the left to jump; click Edit entry… to modify with a form.</div>
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
          onSave={async (vals) => {
            const updated = applyEdit(editing.name, vals)
            await saveEntryToDisk(updated)
            setEditing(null)
          }}
        />
      )}

      {creating && (
        <CreateProfileModal
          existing={new Set(profiles)}
          sourceOptions={profiles}
          onCancel={() => setCreating(false)}
          onCreate={async ({ name, values }) => {
            if (!name) return
            if ((new Set(profiles)).has(name)) {
              setError(`Profile "${name}" already exists`)
              return
            }
            logInfo('profiles', 'create begin', { name })
            const updated = applyEdit(name, values)
            await saveEntryToDisk(updated)
            setCreating(false)
            setSelected(name)
          }}
        />
      )}

      {renaming && (
        <RenameProfileModal
          from={renaming.from}
          existing={new Set(profiles)}
          onCancel={() => setRenaming(null)}
          onRename={async (to) => {
            if (!to || to === renaming.from) { setRenaming(null); return }
            if ((new Set(profiles)).has(to)) { setError(`Profile "${to}" already exists`); return }
            try {
              const out = renameProfile(renaming.from, to)
              await saveEntryToDisk(out)
              setRenaming(null)
              setSelected(to)
            } catch (e) {
              const msg = (e as Error)?.message || 'Rename failed'
              setError(msg)
              logError('profiles', 'rename failed', { error: msg })
            }
          }}
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
  setVals: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
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
  const [type, setType] = useState(() => inferType(initial))
  const [vals, setVals] = useState(() => ({
    region: initial.region || '',
    aws_access_key_id: initial.aws_access_key_id || '',
    aws_secret_access_key: initial.aws_secret_access_key || '',
    aws_session_token: initial.aws_session_token || '',
    role_arn: initial.role_arn || '',
    source_profile: initial.source_profile || '',
  credential_source: initial.credential_source || '',
  role_session_name: (initial as any).role_session_name || '',
  external_id: (initial as any).external_id || '',
  duration_seconds: (initial as any).duration_seconds || '',
  mfa_serial: (initial as any).mfa_serial || ''
  }))
  const [busy, setBusy] = useState(false)

  const saveSanitized = async () => {
    // Only keep keys relevant to selected type + region
    const out: Record<string, string> = {}
    out.region = vals.region || ''
    if (type === 'standard') {
      out.aws_access_key_id = vals.aws_access_key_id || ''
      out.aws_secret_access_key = vals.aws_secret_access_key || ''
    } else if (type === 'temp') {
      out.aws_access_key_id = vals.aws_access_key_id || ''
      out.aws_secret_access_key = vals.aws_secret_access_key || ''
      out.aws_session_token = vals.aws_session_token || ''
    } else if (type === 'assume-role') {
      out.role_arn = vals.role_arn || ''
      out.credential_source = vals.credential_source || ''
      out.source_profile = vals.source_profile || ''
  if (vals.role_session_name) out.role_session_name = vals.role_session_name
  if (vals.external_id) out.external_id = vals.external_id
  if (vals.duration_seconds) out.duration_seconds = vals.duration_seconds
  if (vals.mfa_serial) out.mfa_serial = vals.mfa_serial
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
              <Field k="role_session_name" label="role_session_name" placeholder="Optional session name" vals={vals} setVals={setVals} />
              <Field k="external_id" label="external_id" placeholder="Optional external id" vals={vals} setVals={setVals} />
              <Field k="duration_seconds" label="duration_seconds" placeholder="3600" vals={vals} setVals={setVals} />
              <Field k="mfa_serial" label="mfa_serial" placeholder="arn:aws:iam::123456789012:mfa/User" vals={vals} setVals={setVals} />
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

function CreateProfileModal({ existing, sourceOptions = [], onCancel, onCreate }: { existing: Set<string>; sourceOptions?: string[]; onCancel: () => void; onCreate: (p: { name: string; values: Record<string, string> }) => void | Promise<void> }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('standard' as ProfileType)
  const [vals, setVals] = useState({
    region: '',
    aws_access_key_id: '',
    aws_secret_access_key: '',
    aws_session_token: '',
    role_arn: '',
    source_profile: '',
  credential_source: '',
  role_session_name: '',
  external_id: '',
  duration_seconds: '',
  mfa_serial: ''
  })
  const [err, setErr] = useState(undefined as string | undefined)
  const [busy, setBusy] = useState(false)

  function sanitizeName(raw: string): string {
    let n = (raw || '').trim()
    if (n.startsWith('profile ')) n = n.slice('profile '.length).trim()
    if (/^\[.*\]$/.test(n)) n = n.slice(1, -1).trim()
    return n
  }

  async function doCreate() {
    const n = sanitizeName(name)
    if (!n) { setErr('Name is required'); return }
    if (n.startsWith('sso-session ')) { setErr('Name cannot start with "sso-session "'); return }
    if (existing.has(n)) { setErr(`Profile "${n}" already exists`); return }
    // minimal validation: require at least one field
  const hasAny = Object.values(vals).some(v => ((v as string) || '').trim() !== '')
    if (!hasAny) { setErr('Please fill at least one field'); return }
    setErr(undefined)
    setBusy(true)
    try {
      await onCreate({ name: n, values: vals })
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onKeyDown={(e) => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/40" onClick={() => !busy && onCancel()} />
      <div className="relative menu-bg border border-default rounded shadow-xl w-[720px] max-w-[95vw] p-4">
        <div className="text-lg font-semibold mb-3">New profile</div>
        <div className="mb-3">
          <label className="block text-sm font-medium mb-1">Name</label>
          <input className="w-full px-2 py-1 rounded border text-sm input-theme" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. myprofile" />
        </div>
        <div className="mb-3 flex gap-4 items-center text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="ptype_new" checked={type==='standard'} onChange={() => setType('standard')} /> Standard</label>
          <label className="flex items-center gap-2"><input type="radio" name="ptype_new" checked={type==='temp'} onChange={() => setType('temp')} /> Temp credentials</label>
          <label className="flex items-center gap-2"><input type="radio" name="ptype_new" checked={type==='assume-role'} onChange={() => setType('assume-role')} /> Assume role</label>
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
              <Field k="role_session_name" label="role_session_name" placeholder="Optional session name" vals={vals} setVals={setVals} />
              <Field k="external_id" label="external_id" placeholder="Optional external id" vals={vals} setVals={setVals} />
              <Field k="duration_seconds" label="duration_seconds" placeholder="3600" vals={vals} setVals={setVals} />
              <Field k="mfa_serial" label="mfa_serial" placeholder="arn:aws:iam::123456789012:mfa/User" vals={vals} setVals={setVals} />
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
  {err && <div className="alert alert-error mt-2 text-sm">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={doCreate}>Create</button>
        </div>
      </div>
    </div>
  )
}

function RenameProfileModal({ from, existing, onCancel, onRename }: { from: string; existing: Set<string>; onCancel: () => void; onRename: (to: string) => void | Promise<void> }) {
  const [to, setTo] = useState(from)
  const [err, setErr] = useState(undefined as string | undefined)
  const [busy, setBusy] = useState(false)

  function sanitizeName(raw: string): string {
    let n = (raw || '').trim()
    if (n.startsWith('profile ')) n = n.slice('profile '.length).trim()
    if (/^\[.*\]$/.test(n)) n = n.slice(1, -1).trim()
    return n
  }

  async function doRename() {
    const n = sanitizeName(to)
    if (!n) { setErr('Name is required'); return }
    if (n.startsWith('sso-session ')) { setErr('Name cannot start with "sso-session "'); return }
    if (n !== from && existing.has(n)) { setErr(`Profile "${n}" already exists`); return }
    setErr(undefined)
    setBusy(true)
    try { await onRename(n) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onKeyDown={(e) => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/40" onClick={() => !busy && onCancel()} />
      <div className="relative menu-bg border border-default rounded shadow-xl w-[520px] max-w-[95vw] p-4">
        <div className="text-lg font-semibold mb-3">Rename profile</div>
        <div className="mb-3">
          <label className="block text-sm font-medium mb-1">New name for “{from}”</label>
          <input className="w-full px-2 py-1 rounded border text-sm input-theme" value={to} onChange={e => setTo(e.target.value)} />
        </div>
  {err && <div className="alert alert-error mt-2 text-sm">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={doRename}>Rename</button>
        </div>
      </div>
    </div>
  )
}

// (renameProfile is defined within the main component to access state)
