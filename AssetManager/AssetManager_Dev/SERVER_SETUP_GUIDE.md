# Windows 11 Pro for Workstations - Server Setup Guide

This guide explains how to host your Asset Manager software as a professional server on your Windows 11 machine.

## 1. Prerequisites
- **Docker Desktop**: [Download and Install](https://www.docker.com/products/docker-desktop/)
- **WSL 2 Backend**: Ensure this is enabled in Docker Desktop settings.
- **Static IP**: Assign a static IP to your Windows machine (e.g., `192.168.1.100`) via your router.

## 2. Launching in Production
1. Move the `AssetManager_Dev` folder to your high-performance drive (e.g., your new **NVMe SSD** at `E:\AssetManager_Prod`).
2. Open PowerShell as Administrator in that folder.
3. Run the following command:
   ```powershell
   docker compose -f docker-compose.prod.yml up -d --build
   ```
4. Verify by visiting `http://localhost` in your browser.

## 3. High-Availability & Redundancy
Since you are running two systems (Primary and Backup), see the [REDUNDANCY_SETUP.md](./REDUNDANCY_SETUP.md) for instructions on:
- Syncing data between workstations.
- Automating backups to the NVMe SSD.
- Handling a failover if the primary server goes offline.

## 4. Making it Public (For QR Codes)
To allow clients to scan QR codes and see the public portal over the internet:
1. **Cloudflare Tunnel (Free)**:
   - Create a Cloudflare account.
   - Go to "Zero Trust" -> "Networks" -> "Tunnels".
   - Create a new tunnel and install the `cloudflared` service on Windows.
   - Map your domain (e.g., `assets.yourcompany.com`) to `http://localhost:80`.
2. **QR Update**: Once your domain is live, update the `STATIC_IP` or `DOMAIN` in your `.env` file so QR codes use the public link.

## 4. Automatic Backups
Create a simple PowerShell script (`backup.ps1`) to run daily via Windows Task Scheduler:
```powershell
$date = Get-Date -Format "yyyyMMdd_HHmm"
docker exec asset-manager-db-prod pg_dump -U postgres asset_manager > "C:\Backups\db_backup_$date.sql"
```

## 5. Maintenance
- **Update Software**: Pull latest code and run `docker compose -f docker-compose.prod.yml up -d --build`.
- **Logs**: View logs with `docker compose -f docker-compose.prod.yml logs -f app-prod`.
