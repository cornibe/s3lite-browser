import { useEffect, useState } from 'react'
import { useBuckets } from '../lib/query'
import { useStore } from '../lib/store'
import { trace, warn } from '../lib/log'
import CreateBucketModal from './CreateBucketModal'

export default function SidebarBuckets() {
  const { bucket, profile, connected, selectBucket, connectionError, setConnectionError, setConnected, isSwitchingProfile, settings } = useStore() as any
  const { data, isLoading, isError, error, refetch } = useBuckets(connected, profile)
  const [showCreateBucket, setShowCreateBucket] = useState(false)
  const [bucketFilter, setBucketFilter] = useState('')

  // If listing buckets fails (for example missing region or invalid creds),
  // surface that as a connectionError and clear any selected bucket/prefix so
  // stale UI is not shown. Clear the connectionError when buckets load.
  useEffect(() => {
    if (isError) {
      const msg = (error as Error)?.message || 'Failed to load buckets.'
      setConnectionError(msg)
  warn('ui', 'buckets load failed', { error: msg })
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

  const handleCreateBucket = async (bucketName: string, region?: string) => {
    const result = await (window as any).api.s3.createBucket({ bucketName, region })
    if (!result.ok) {
      throw new Error(result.error)
    }
    // Refresh bucket list
    await refetch()
    // Select the newly created bucket
    selectBucket(bucketName)
  }

  const dark = Boolean(settings?.darkMode)
  return (
    <div className={`h-full overflow-y-auto bg-header text-app`}>
      <div className={`px-3 py-2 border-b border-default`}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase opacity-70 tracking-wide">Buckets</div>
          {connected && !isSwitchingProfile && (
            <button
              onClick={() => setShowCreateBucket(true)}
              className="text-xs px-2 py-1 bg-[#0e639c] text-white rounded hover:bg-[#1177bb] transition-colors"
              title="Create new bucket"
            >
              + New
            </button>
          )}
        </div>
        <input
          type="text"
          value={bucketFilter}
          onChange={(e) => setBucketFilter(e.target.value)}
          placeholder="Filter buckets…"
          className={`w-full h-8 px-2 rounded border text-sm input-theme placeholder:text-muted`}
        />
      </div>
      {!connected && (
        <div className="px-3 py-2 text-sm opacity-80">
          Not connected. Select a profile to connect.
        </div>
      )}
  {connected && isLoading && <div className="px-3 py-2 text-sm">Loading…</div>}
  {isSwitchingProfile && <div className="px-3 py-2 text-sm opacity-70">Switching profile…</div>}
  {/* Connection errors are displayed in the main panel to avoid clutter. */}
    {(!isSwitchingProfile && connected && !isError) && (
        (data && data.length > 0) ? (
      <ul className={`text-sm bg-header`}>
            {data
              .filter(name => name.toLowerCase().includes(bucketFilter.trim().toLowerCase()))
              .map(name => {
              const isActive = bucket === name
        const hover = !isActive ? 'row-hover' : 'row-hover'
              return (
                <li key={name}>
                  <button
                    onClick={() => { trace('ui', 'select bucket', { bucket: name }); selectBucket(name) }}
          className={`w-full text-left px-3 py-2 ${hover} ${isActive ? 'selected-row font-medium' : ''}`}
                  >
                    {name}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="px-3 py-2 text-sm opacity-70">No buckets found.</div>
        )
      )}
      
      <CreateBucketModal
        isOpen={showCreateBucket}
        onClose={() => setShowCreateBucket(false)}
        onCreateBucket={handleCreateBucket}
      />
    </div>
  )
}
