param(
  [Parameter(Mandatory = $true)]
  [string]$Backup,

  [Parameter(Mandatory = $true)]
  [string]$Destination
)

$ErrorActionPreference = "Stop"
$backupPath = [System.IO.Path]::GetFullPath($Backup)
$destinationPath = [System.IO.Path]::GetFullPath($Destination)

if (-not [System.IO.File]::Exists($backupPath)) {
  throw "Encrypted backup is missing."
}
if ([System.IO.File]::Exists($destinationPath)) {
  throw "Destination already exists; refusing to overwrite an identity."
}

$entropy = [System.Text.Encoding]::UTF8.GetBytes("Alex FLOP Evidence Agent identity backup v1")
$protected = [System.IO.File]::ReadAllBytes($backupPath)
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
  $protected,
  $entropy,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
$identity = [System.Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
if ($identity.did -ne "did:key:z6MknSwuvSMT6NdYJeBj9XjPEvtT4C9VFodQ541x5ZEeZqvH") {
  throw "Restore verification failed: unexpected DID."
}

$destinationDirectory = [System.IO.Path]::GetDirectoryName($destinationPath)
[System.IO.Directory]::CreateDirectory($destinationDirectory) | Out-Null
[System.IO.File]::WriteAllBytes($destinationPath, $plain)

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

[PSCustomObject]@{
  restored = $destinationPath
  did = $identity.did
  verified = $true
}
