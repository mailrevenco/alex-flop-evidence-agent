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
