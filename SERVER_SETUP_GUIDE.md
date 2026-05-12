# Windows 11 Pro for Workstations - Server Setup Guide

This guide explains how to host your Asset Manager software as a professional server on your Windows 11 machine.

## 1. System Requirements (The "Golden Image")
To ensure the app runs perfectly on both `.59` and `.118`, both machines should have:
- **Docker Desktop**: [Download](https://www.docker.com/products/docker-desktop/) (Required).
- **WSL 2 Backend**: Enabled in Docker Desktop settings (Required for performance).
- **Git for Windows**: [Download](https://git-scm.com/downloads) (Required to pull the latest code).
- **PowerShell 5.1+**: Pre-installed on Windows 10/11 (Required for sync scripts).
- **Static IP**: 
  - Server A: `192.168.6.59`
  - Server B: `192.168.6.118`

---

## 2. Clean Reinstall Procedure
If you are having issues on `.118`, follow these steps to wipe the slate clean and start fresh:

1. **Stop & Wipe existing Docker data**:
   ```powershell
   # Go to the project folder
   cd C:\Users\Admin\AssetManager\AssetManager_Dev
   
   # Stop containers and DELETE volumes (this wipes the DB, make sure you have a backup!)
   docker compose -f docker-compose.prod.yml down --volumes --remove-orphans
   ```

2. **Refresh the Code**:
   ```powershell
   git reset --hard HEAD
   git pull origin main
   ```

3. **Check for Port Conflicts**:
   Before starting, ensure no other service is using port **8080** or **5432**:
   ```powershell
   ./diagnose_docker.ps1
   ```

4. **Launch from Scratch**:
   ```powershell
   docker compose -f docker-compose.prod.yml up -d --build
   ```

---

## 3. Launching in Production (Standard)
1. Move the `AssetManager_Dev` folder to your high-performance drive (e.g., your new **NVMe SSD** at `E:\AssetManager_Prod`).
2. Open PowerShell as Administrator in that folder.
3. Run the following command:
   ```powershell
   docker compose -f docker-compose.prod.yml up -d --build
   ```
4. **Troubleshooting**: If the container won't start on your `.118` server, run the diagnostic script:
   ```powershell
   ./diagnose_docker.ps1
   ```
5. Verify by visiting `http://localhost:8080` in your browser.

---

## 4. High-Availability & Redundancy
Since you are running two systems (Primary and Backup), see the [REDUNDANCY_SETUP.md](./REDUNDANCY_SETUP.md) for instructions on:
- Syncing data between workstations.
- Automating backups to the NVMe SSD.
- Handling a failover if the primary server goes offline.

---

## 5. Making it Public (For QR Codes)
To allow clients to scan QR codes and see the public portal over the internet:
1. **Cloudflare Tunnel (Free)**:
   - Create a Cloudflare account.
   - Go to "Zero Trust" -> "Networks" -> "Tunnels".
   - Create a new tunnel and install the `cloudflared` service on Windows.
   - Map your domain (e.g., `assets.yourcompany.com`) to `http://localhost:8080`.
2. **QR Update**: Once your domain is live, update the `STATIC_IP` or `DOMAIN` in your `.env` file so QR codes use the public link.

---

## 6. Automatic Backups
Create a simple PowerShell script (`backup.ps1`) to run daily via Windows Task Scheduler:
```powershell
$date = Get-Date -Format "yyyyMMdd_HHmm"
docker exec asset-manager-db-prod pg_dump -U postgres asset_manager > "C:\Backups\db_backup_$date.sql"
```

---

## 7. Maintenance
- **Update Software**: Pull latest code and run `docker compose -f docker-compose.prod.yml up -d --build`.
- **Logs**: View logs with `docker compose -f docker-compose.prod.yml logs -f app-prod`.
