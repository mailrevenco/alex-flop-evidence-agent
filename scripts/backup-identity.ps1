param(
  [Parameter(Mandatory = $true)]
  [string]$Destination
)

$ErrorActionPreference = "Stop"
$source = Join-Path $PSScriptRoot "..\secrets\identity.json"
$source = [System.IO.Path]::GetFullPath($source)
$destinationPath = [System.IO.Path]::GetFullPath($Destination)

if (-not [System.IO.File]::Exists($source)) {
  throw "Identity file is missing."
}
if ([System.IO.File]::Exists($destinationPath)) {
  throw "Backup destination already exists; choose a new path."
}

$destinationDirectory = [System.IO.Path]::GetDirectoryName($destinationPath)
[System.IO.Directory]::CreateDirectory($destinationDirectory) | Out-Null

$entropy = [System.Text.Encoding]::UTF8.GetBytes("Alex FLOP Evidence Agent identity backup v1")
$plain = [System.IO.File]::ReadAllBytes($source)
$protected = [System.Security.Cryptography.ProtectedData]::Protect(
  $plain,
  $entropy,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
[System.IO.File]::WriteAllBytes($destinationPath, $protected)

$roundTrip = [System.Security.Cryptography.ProtectedData]::Unprotect(
  $protected,
  $entropy,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
$identity = [System.Text.Encoding]::UTF8.GetString($roundTrip) | ConvertFrom-Json
if ($identity.did -ne "did:key:z6MknSwuvSMT6NdYJeBj9XjPEvtT4C9VFodQ541x5ZEeZqvH") {
  throw "Backup verification failed: unexpected DID."
}

$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true, $false)
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
  $currentUser,
  [System.Security.AccessControl.FileSystemRights]::FullControl,
  [System.Security.AccessControl.AccessControlType]::Allow
)
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $destinationPath -AclObject $acl

$hash = (Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256).Hash.ToLowerInvariant()
[PSCustomObject]@{
  backup = $destinationPath
  encryption = "Windows DPAPI CurrentUser"
  did = $identity.did
  sha256 = $hash
  verified = $true
}
