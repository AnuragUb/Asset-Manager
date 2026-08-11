# --- NVMe PC Health Monitor (The Heartbeat) ---
# This script should be run on your NVMe PC (Your desk machine).
# It checks if the Primary Server is alive. If not, it alerts you.

# CONFIGURATION
$PRIMARY_SERVER_IP = "192.168.1.XXX" # Replace with your other workstation's IP
$ALERT_THRESHOLD = 3                # Alerts after 3 consecutive failures
$CHECK_INTERVAL_SEC = 60            # Checks every 1 minute

# SCRIPT
$failures = 0

Write-Host "[MONITOR] Starting Heartbeat check for Primary Server: $PRIMARY_SERVER_IP" -ForegroundColor Cyan

while ($true) {
    $alive = Test-Connection -ComputerName $PRIMARY_SERVER_IP -Count 1 -Quiet
    
    if ($alive) {
        if ($failures -gt 0) {
            Write-Host "[RECOVERY] Primary Server is back online!" -ForegroundColor Green
        }
        $failures = 0
        Write-Host "$(Get-Date -Format 'HH:mm:ss'): Primary Server is Healthy." -ForegroundColor Gray
    } else {
        $failures++
        Write-Host "$(Get-Date -Format 'HH:mm:ss'): [WARNING] Primary Server Unreachable ($failures/$ALERT_THRESHOLD)" -ForegroundColor Yellow
        
        if ($failures -eq $ALERT_THRESHOLD) {
            Write-Host "------------------------------------------------------------" -ForegroundColor Red
            Write-Host "CRITICAL ALERT: PRIMARY SERVER IS OFFLINE!" -ForegroundColor Red
            Write-Host "Action Required: Run 'ops/replication/restore_failover.ps1' on this machine." -ForegroundColor Cyan
            Write-Host "------------------------------------------------------------" -ForegroundColor Red
            
            # This triggers a Windows System Sound alert
            [console]::beep(1000,500)
            [console]::beep(1000,500)
            
            # Optional: You can add code here to send a push notification to your phone
        }
    }
    
    Start-Sleep -Seconds $CHECK_INTERVAL_SEC
}
