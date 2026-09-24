param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Backup", "Verify", "Restore")]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$Path,

  [string]$Source,
  [string]$Destination,
  [securestring]$Passphrase
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -lt 7) {
  throw "Portable identity backup requires PowerShell 7 or newer."
}
$expectedDid = "did:key:z6MknSwuvSMT6NdYJeBj9XjPEvtT4C9VFodQ541x5ZEeZqvH"
$format = "flop-identity-portable-v1"
$iterations = 600000
$defaultSource = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\secrets\identity.json"))

function Get-PasswordBytes([securestring]$Value) {
  $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($Value)
  try {
    $bytes = [byte[]]::new($Value.Length * 2)
    [System.Runtime.InteropServices.Marshal]::Copy($pointer, $bytes, 0, $bytes.Length)
    return ,$bytes
  } finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($pointer)
  }
}

function Get-PortablePlain([string]$File, [byte[]]$PasswordBytes) {
  if (-not [System.IO.File]::Exists($File)) { throw "Portable backup is missing." }
  if (([System.IO.FileInfo]$File).Length -gt 2MB) { throw "Portable backup is unexpectedly large." }
  $doc = [System.IO.File]::ReadAllText($File, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  if ($doc.format -ne $format -or $doc.version -ne 1 -or $doc.did -ne $expectedDid -or
      $doc.kdf -ne "PBKDF2-SHA256" -or $doc.password_encoding -ne "UTF-16LE" -or
      $doc.iterations -ne $iterations) {
    throw "Unsupported or unexpected portable backup metadata."
  }
  $salt = [Convert]::FromBase64String($doc.salt)
  $nonce = [Convert]::FromBase64String($doc.nonce)
  $tag = [Convert]::FromBase64String($doc.tag)
  $cipher = [Convert]::FromBase64String($doc.ciphertext)
  if ($salt.Length -ne 32 -or $nonce.Length -ne 12 -or $tag.Length -ne 16 -or
      $cipher.Length -eq 0 -or $cipher.Length -gt 1MB) {
    throw "Invalid portable backup sizes."
  }
  $key = [System.Security.Cryptography.Rfc2898DeriveBytes]::Pbkdf2(
    $PasswordBytes, $salt, $iterations,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256, 32
  )
  try {
    $plain = [byte[]]::new($cipher.Length)
    $aad = [System.Text.Encoding]::UTF8.GetBytes("$format|$expectedDid|$iterations")
    $aes = [System.Security.Cryptography.AesGcm]::new($key, 16)
    try { $aes.Decrypt($nonce, $cipher, $tag, $plain, $aad) }
    finally { $aes.Dispose() }
    $identity = [System.Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
    if ($identity.did -ne $expectedDid) { throw "Portable backup contains the wrong DID." }
    return ,$plain
  } finally {
    [Array]::Clear($key, 0, $key.Length)
  }
}

if (-not $Passphrase) {
  $Passphrase = Read-Host "Portable backup passphrase (not shown)" -AsSecureString
  if ($Action -eq "Backup") {
    $confirmation = Read-Host "Repeat the passphrase" -AsSecureString
    $first = Get-PasswordBytes $Passphrase
    $second = Get-PasswordBytes $confirmation
    try {
      if ($first.Length -ne $second.Length) { throw "Passphrases do not match." }
      for ($i = 0; $i -lt $first.Length; $i++) {
        if ($first[$i] -ne $second[$i]) { throw "Passphrases do not match." }
      }
    } finally {
      [Array]::Clear($first, 0, $first.Length)
      [Array]::Clear($second, 0, $second.Length)
    }
  }
}

if ($Action -eq "Backup" -and $Passphrase.Length -lt 20) {
  throw "Use a passphrase of at least 20 characters; keep it offline, separate from the backup."
}

$passwordBytes = Get-PasswordBytes $Passphrase
try {
  $backupPath = [System.IO.Path]::GetFullPath($Path)
  if ($Action -eq "Backup") {
    $sourcePath = if ($Source) { [System.IO.Path]::GetFullPath($Source) } else { $defaultSource }
    if (-not [System.IO.File]::Exists($sourcePath)) { throw "Identity source is missing." }
    if ([System.IO.File]::Exists($backupPath)) { throw "Backup already exists; refusing to overwrite it." }
    $plain = [System.IO.File]::ReadAllBytes($sourcePath)
    if ($plain.Length -eq 0 -or $plain.Length -gt 1MB) { throw "Invalid identity source size." }
    $identity = [System.Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
    if ($identity.did -ne $expectedDid) { throw "Identity source has the wrong DID." }

    $salt = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    $nonce = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(12)
    $key = [System.Security.Cryptography.Rfc2898DeriveBytes]::Pbkdf2(
      $passwordBytes, $salt, $iterations,
      [System.Security.Cryptography.HashAlgorithmName]::SHA256, 32
    )
    try {
      $cipher = [byte[]]::new($plain.Length)
      $tag = [byte[]]::new(16)
      $aad = [System.Text.Encoding]::UTF8.GetBytes("$format|$expectedDid|$iterations")
      $aes = [System.Security.Cryptography.AesGcm]::new($key, 16)
      try { $aes.Encrypt($nonce, $plain, $cipher, $tag, $aad) }
      finally { $aes.Dispose() }
    } finally {
      [Array]::Clear($key, 0, $key.Length)
    }

    $doc = [ordered]@{
      format = $format
      version = 1
      did = $expectedDid
      kdf = "PBKDF2-SHA256"
      password_encoding = "UTF-16LE"
      iterations = $iterations
      salt = [Convert]::ToBase64String($salt)
      nonce = [Convert]::ToBase64String($nonce)
      tag = [Convert]::ToBase64String($tag)
      ciphertext = [Convert]::ToBase64String($cipher)
    }
    $parent = [System.IO.Path]::GetDirectoryName($backupPath)
    [System.IO.Directory]::CreateDirectory($parent) | Out-Null
    $temporary = "$backupPath.tmp-$([Guid]::NewGuid().ToString('N'))"
    try {
      [System.IO.File]::WriteAllText($temporary, ($doc | ConvertTo-Json -Depth 4), [System.Text.Encoding]::UTF8)
      $verified = Get-PortablePlain $temporary $passwordBytes
      if (-not [System.Security.Cryptography.CryptographicOperations]::FixedTimeEquals(
        [System.Security.Cryptography.SHA256]::HashData($plain),
        [System.Security.Cryptography.SHA256]::HashData($verified)
      )) { throw "Backup round-trip verification failed." }
      [System.IO.File]::Move($temporary, $backupPath)
    } finally {
      if ([System.IO.File]::Exists($temporary)) { [System.IO.File]::Delete($temporary) }
    }
    [pscustomobject]@{
      backup = $backupPath
      encryption = "AES-256-GCM with PBKDF2-SHA256"
      did = $expectedDid
      sha256 = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant()
      verified = $true
    }
  } else {
    $plain = Get-PortablePlain $backupPath $passwordBytes
    if ($Action -eq "Verify") {
      [pscustomobject]@{ backup = $backupPath; did = $expectedDid; verified = $true }
    } else {
      if (-not $Destination) { throw "Restore requires -Destination." }
      $destinationPath = [System.IO.Path]::GetFullPath($Destination)
      if ([System.IO.File]::Exists($destinationPath)) { throw "Destination exists; refusing to overwrite an identity." }
      if ([System.IO.Path]::GetFileName([System.IO.Path]::GetDirectoryName($destinationPath)) -ne "secrets") {
        throw "Restore destination must be inside a secrets directory."
      }
      [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($destinationPath)) | Out-Null
      $temporary = "$destinationPath.tmp-$([Guid]::NewGuid().ToString('N'))"
      try {
        [System.IO.File]::WriteAllBytes($temporary, $plain)
        $acl = New-Object System.Security.AccessControl.FileSecurity
        $acl.SetAccessRuleProtection($true, $false)
        $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
          $currentUser,
          [System.Security.AccessControl.FileSystemRights]::FullControl,
          [System.Security.AccessControl.AccessControlType]::Allow
        )
        $acl.AddAccessRule($rule)
        Set-Acl -LiteralPath $temporary -AclObject $acl
        [System.IO.File]::Move($temporary, $destinationPath)
      } finally {
        if ([System.IO.File]::Exists($temporary)) { [System.IO.File]::Delete($temporary) }
      }
      [pscustomobject]@{ restored = $destinationPath; did = $expectedDid; verified = $true }
    }
  }
} finally {
  [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
}
