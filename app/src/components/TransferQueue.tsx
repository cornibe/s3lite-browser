import { useStore } from '../lib/store'

export default function TransferQueue() {
  const { bucket, prefix, selectedKey } = useStore()
  return (
    <div className="p-2 border-t text-sm bg-neutral-50 dark:bg-neutral-900">
      <div className="flex gap-6">
        <div><span className="opacity-70">Bucket:</span> {bucket ?? '-'}</div>
        <div><span className="opacity-70">Prefix:</span> <span className="font-mono">{prefix}</span></div>
        <div><span className="opacity-70">Selected:</span> <span className="font-mono">{selectedKey ?? '-'}</span></div>
      </div>
    </div>
  )
}
