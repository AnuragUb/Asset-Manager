# High-Performance & Redundancy Architecture (NVMe + Hot Standby)

This setup ensures maximum performance using your new NVMe SSD and provides a "Failover" system so your software never goes offline.

## 1. The Infrastructure Map

### **Primary Server (Workstation Server)**
- **IP Address**: `192.168.6.118`
- **Port**: `8080`
- **Role**: Main production server for all staff.
- **Action**: Runs [replicate_db.ps1](./replicate_db.ps1) daily to push data to the backup machine.

### **Backup & Dev Machine (Current PC)**
- **IP Address**: `192.168.6.59`
- **Port**: `8080` (Standby Prod) / `9090` (Dev)
- **Role**: Redundant safety instance + Development environment.
- **Action**: Receives backups from `.118`. Runs [restore_replication.ps1](./restore_replication.ps1) if the primary server fails.

---

## 2. Dynamic Smart Links (QR Codes)
The system is now configured to generate QR codes dynamically based on the IP address used to access the app.
- If you access via `http://192.168.6.118:8080`, the QR codes will point to `.118`.
- If you access via `http://192.168.6.59:8080`, the QR codes will point to `.59`.
- **Note**: For printed labels, always generate them from the **Primary Server (.118)** so they remain valid for external users.

---

## 3. Synchronization (Mirroring Data)
To ensure `.59` and `.118` have the same data:
1. **From .118 to .59**: Run `./replicate_db.ps1` on the `.118` machine. (Set `$TARGET_IP = "192.168.6.59"`)
2. **From .59 to .118**: Run `./replicate_db.ps1` on the `.59` machine. (Set `$TARGET_IP = "192.168.6.118"`)
3. **Restore**: Run `./restore_replication.ps1` on the machine that needs the update.

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
