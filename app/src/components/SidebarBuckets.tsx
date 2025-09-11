import { useEffect } from 'react'
import { useBuckets } from '../lib/query'
import { useStore } from '../lib/store'

export default function SidebarBuckets() {
  const { bucket, profile, connected, selectBucket, connectionError, setConnectionError, setConnected, isSwitchingProfile } = useStore() as any
  const { data, isLoading, isError, error, refetch } = useBuckets(connected, profile)

  // If listing buckets fails (for example missing region or invalid creds),
  // surface that as a connectionError and clear any selected bucket/prefix so
  // stale UI is not shown. Clear the connectionError when buckets load.
  useEffect(() => {
    if (isError) {
      const msg = (error as Error)?.message || 'Failed to load buckets.'
      setConnectionError(msg)
      // clear selected bucket/prefix when failure happens
      selectBucket(undefined)
    } else if (data && data.length > 0) {
      // successful load: clear any previous connection error
      if (connectionError) setConnectionError(undefined)
    }
  }, [isError, error, data, selectBucket, setConnectionError, connectionError])

  useEffect(() => {
    if (!connected) return
    if (!bucket && data && data.length > 0) selectBucket(data[0])
  }, [connected, bucket, data, selectBucket])

  return (
    <div className="w-64 border-r overflow-auto">
      <div className="px-3 py-2 text-xs uppercase opacity-70 tracking-wide">Buckets</div>
      {!connected && (
        <div className="px-3 py-2 text-sm opacity-80">
          Not connected. Select a profile to connect.
        </div>
      )}
  {connected && isLoading && <div className="px-3 py-2 text-sm">Loading…</div>}
  {isSwitchingProfile && <div className="px-3 py-2 text-sm opacity-70">Switching profile…</div>}
      {connectionError && (
        <div className="px-3 py-2 text-sm text-red-600 flex items-center gap-3">
          <span>{connectionError}</span>
          <button onClick={async () => {
            // try re-initializing the profile
            try {
              setConnectionError(undefined)
              await window.api.s3.init({ profile })
              setConnected(true)
              void refetch()
            } catch (e) {
              setConnectionError((e as Error).message || 'Failed to connect')
            }
          }} className="underline">Retry</button>
        </div>
      )}
      {(!isSwitchingProfile && connected && !isError) && (
        (data && data.length > 0) ? (
          <ul className="text-sm">
            {data.map(name => (
              <li key={name}>
                <button onClick={() => selectBucket(name)} className={`w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-neutral-800 ${bucket === name ? 'bg-blue-100 dark:bg-neutral-800 font-medium' : ''}`}>
                  {name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-3 py-2 text-sm opacity-70">No buckets found.</div>
        )
      )}
    </div>
  )
}
