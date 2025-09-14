# PowerShell script to add cursor-pointer to all buttons in ObjectExplorer.tsx

$filePath = "c:\Users\corni\git\light_s3_browser\app\src\components\ObjectExplorer.tsx"

# Read the file content
$content = Get-Content $filePath -Raw

# Define replacements for cursor-pointer
$replacements = @{
    'className="hover:underline"' = 'className="hover:underline cursor-pointer"'
    'className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"' = 'className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors cursor-pointer"'
    'className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"' = 'className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors cursor-pointer"'
    'className="text-xs underline"' = 'className="text-xs underline cursor-pointer"'
    'className="underline"' = 'className="underline cursor-pointer"'
    'className="px-3 py-1 rounded bg-neutral-200 dark:bg-neutral-700"' = 'className="px-3 py-1 rounded bg-neutral-200 dark:bg-neutral-700 cursor-pointer"'
    'className="block w-full text-left px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700"' = 'className="block w-full text-left px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"'
    'className="block w-full text-left px-3 py-2 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400"' = 'className="block w-full text-left px-3 py-2 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 cursor-pointer"'
    'className="px-2 py-1 text-xs bg-neutral-200 dark:bg-neutral-800 rounded"' = 'className="px-2 py-1 text-xs bg-neutral-200 dark:bg-neutral-800 rounded cursor-pointer"'
}

# Add Download button to header
$downloadButtonAddition = '              <button
                onClick={() => setShowCreateFolder(true)}
                className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors cursor-pointer"
                title="Create new folder"
              >
                + Folder
              </button>
              <button
                onClick={async () => {
                  try {
                    const dest = await (window as any).api.ui.pickDirectory({ title: ''Select download folder'' })
                    if (!dest) return
                    await handleDownload()
                  } catch (e) {
                    console.error(''download failed'', e)
                  }
                }}
                className="text-xs px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors disabled:opacity-50 cursor-pointer"
                title="Download selected item"
                disabled={!selectedKey}
              >
                ↓ Download
              </button>'

$content = $content -replace '              <button\s+onClick=\{.*?setShowCreateFolder.*?\}\s+className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"\s+title="Create new folder"\s+>\s+\+ Folder\s+</button>', $downloadButtonAddition

# Add deselection functionality
$content = $content -replace '<div className="flex-1 overflow-auto">', '<div className="flex-1 overflow-auto" onClick={(e) => {
        // Only deselect if clicking directly on the container, not on any child elements
        if (e.target === e.currentTarget) {
          trace(''ui'', ''deselect on background click'')
          setSelected(undefined, undefined)
        }
      }}>'

$content = $content -replace '<tbody>', '<tbody onClick={(e) => {
              // Deselect when clicking on tbody but not on a row
              if (e.target === e.currentTarget) {
                trace(''ui'', ''deselect on table body click'')
                setSelected(undefined, undefined)
              }
            }}>'

# Apply cursor-pointer replacements
foreach ($find in $replacements.Keys) {
    $replace = $replacements[$find]
    $content = $content -replace [regex]::Escape($find), $replace
}

# Write the modified content back to the file
Set-Content $filePath $content -NoNewline

Write-Host "Updated ObjectExplorer.tsx with cursor-pointer styles and UI improvements"
