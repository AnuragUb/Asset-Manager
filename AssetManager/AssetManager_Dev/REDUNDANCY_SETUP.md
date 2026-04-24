# High-Performance & Redundancy Architecture (NVMe + Hot Standby)

This setup ensures maximum performance using your new NVMe SSD and provides a "Failover" system so your software never goes offline.

## 1. The Infrastructure Map

### **Primary Server (Different Workstation)**
- **Role**: Handles all daily traffic.
- **Storage**: Standard or SSD.
- **Action**: Runs the "Primary" production container and sends database heartbeats (backups) to your NVMe machine.

### **Failover & Dev Machine (Your Current PC with NVMe)**
- **Role**: Hosts the Development environment + a "Hot Standby" Production clone.
- **Storage**: **NVMe SSD** (Mapped for maximum DB speed).
- **Action**: Receives the Primary Server's database copies every hour. If the Primary Server dies, you "activate" this one instantly.

---

## 2. Moving Code to the NVMe SSD
To shift your working codebase to the faster drive:
1. Copy the `AssetManager_Dev` folder to your new NVMe drive (e.g., `E:\AssetManager_Dev`).
2. Update your terminal/IDE to point to this new path.
3. In [docker-compose.prod.yml](file:///c%3A/Users/Admin/AssetManager/AssetManager_Dev/docker-compose.prod.yml), ensure the `volumes` section points to the NVMe path for the database files.

---

## 3. Automation Scripts (Zero-Data-Loss Logic)

### **A. sync_to_nvme.ps1 (Run on Primary Server)**
This is your **"Black Box"** script. It creates a local backup first, then retries the network sync every 5 minutes if your office WiFi is unstable.
- **Local Copy**: Always exists at `C:\AssetManager_Local_Backups`.
- **Remote Copy**: Pushed to your NVMe PC via network share.

### **B. health_check.ps1 (Run on NVMe PC)**
This is your **"Heartbeat"** monitor. Run this in a background PowerShell window on your desk machine.
- **Action**: Pings the Primary Server every minute.
- **Alert**: If the server goes offline, it will beep and flash a critical alert on your screen.

### **C. restore_failover.ps1 (Run on NVMe PC ONLY if Primary fails)**
This script takes the absolute latest backup received from the network and injects it into your local "Standby" container.

---

## 4. Failover Procedure (What to do when things break)
1. **Notice the Alert**: Your `health_check.ps1` window will turn RED.
2. **Verify**: Check if the Primary Server workstation has lost power or network.
3. **Run Restore**: Open PowerShell on your NVMe PC and run `./restore_failover.ps1`.
4. **Switch QR Traffic**: Update your Cloudflare Tunnel or Router to point to your NVMe PC's IP instead of the Primary Server.


## 4. Key Benefits of this Setup
1. **Speed**: The database on your NVMe will handle complex reports and searches up to 5x faster than a standard HDD.
2. **Security**: Your production data is always in two physical locations.
3. **Minification**: Both the Primary and Backup instances will serve the "Hidden/Minified" `dist` folder logic for port 8080.
