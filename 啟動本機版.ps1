$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$patentNode = Get-Command node -ErrorAction SilentlyContinue
if ($patentNode) { & $patentNode.Source server.mjs }
else {
  $patentBundledNode = 'C:\Users\zhewe\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
  if (Test-Path -LiteralPath $patentBundledNode) { & $patentBundledNode server.mjs }
  else { Write-Error '請先安裝 Node.js 22 或更新版本。' }
}
