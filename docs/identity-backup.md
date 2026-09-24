# Identity backup

The agent identity is backed up with Windows DPAPI in `CurrentUser` scope. The encrypted file can be decrypted only by the same Windows user profile on this computer. It is not a substitute for a separately encrypted offline backup that survives loss of the Windows account or machine.

Create a backup outside the repository:

```powershell
.\scripts\backup-identity.ps1 -Destination "C:\Users\reven\Documents\FLOP Identity Backup\identity-YYYY-MM-DD.dpapi"
```

Restore into an empty destination:

```powershell
.\scripts\restore-identity.ps1 -Backup "C:\Users\reven\Documents\FLOP Identity Backup\identity-YYYY-MM-DD.dpapi" -Destination "C:\FLOP\secrets\identity-restored.json"
```

The restore script refuses to overwrite an existing identity. Never commit the encrypted backup, the restored JSON, or the original secret to Git. Never upload an unencrypted identity file.

## Portable offline backup

The DPAPI file above cannot be restored after losing this Windows profile or PC. For that scenario, use `portable-identity.ps1` in PowerShell 7 or newer with a removable drive. Replace `E:` with the drive letter you actually see in Windows:

```powershell
.\scripts\portable-identity.ps1 -Action Backup -Path "E:\FLOP\identity-portable-2026-09-24.json"
.\scripts\portable-identity.ps1 -Action Verify -Path "E:\FLOP\identity-portable-2026-09-24.json"
```

The script prompts for a passphrase **locally** without showing it. Choose a long, unique passphrase (at least 20 characters), record it offline **separately from the drive**, and never send it in chat or put it in a command line. The file uses AES-256-GCM with a random nonce and PBKDF2-SHA256 key derivation; it is not tied to the original Windows account. `Backup` verifies that the encrypted file can be decrypted before reporting success, and `Verify` checks it again without writing plaintext. The source identity and encrypted backup are never uploaded by the script.

To restore on a replacement PC, set up a private `secrets` directory, then run:

```powershell
.\scripts\portable-identity.ps1 -Action Restore -Path "E:\FLOP\identity-portable-2026-09-24.json" -Destination "C:\FLOP\secrets\identity-restored.json"
```

The restore refuses to overwrite an existing file and restricts the new file to the current Windows user. Check that the restored DID is `did:key:z6MknSwuvSMT6NdYJeBj9XjPEvtT4C9VFodQ541x5ZEeZqvH` before replacing any active identity. Losing both the backup and its passphrase means the agent identity cannot be recovered.
