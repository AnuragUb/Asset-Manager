# Asset Management Tool
# Allows users to update asset status and details
# Super users can view change history/audit log

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Security

if ([System.Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
    Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -STA -File `"$PSCommandPath`"" | Out-Null
    exit
}

# Configuration
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$assetsFile = Join-Path $scriptDir "assets.json"
$usersFile = Join-Path $scriptDir "users.json"
$auditLogFile = Join-Path $scriptDir "audit_log.json"

$script:QRCoderAvailable = $false
$qrLibPath = Join-Path $scriptDir "lib\QRCoder.dll"
if (Test-Path $qrLibPath) {
    try { Add-Type -Path $qrLibPath; $script:QRCoderAvailable = $true } catch { $script:QRCoderAvailable = $false }
}

# Initialize log function
function Write-AuditLog {
    param(
        [string]$Action,
        [string]$User,
        [string]$AssetId,
        [string]$Details,
        [string]$OldValue = "",
        [string]$NewValue = "",
        [string]$Severity = "INFO",
        [object]$Metadata = $null
    )
    $eventId = [System.Guid]::NewGuid().ToString()
    $logEntry = @{
        Timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
        User = $User
        Action = $Action
        AssetId = $AssetId
        Details = $Details
        OldValue = $OldValue
        NewValue = $NewValue
        Severity = $Severity
        EventId = $eventId
        Metadata = $Metadata
    }
    $logs = @()
    if (Test-Path $auditLogFile) {
        try {
            $logs = Get-Content $auditLogFile -Raw | ConvertFrom-Json
            if ($logs -isnot [array]) { $logs = @($logs) }
        }
        catch {
            $logs = @()
        }
    }
    $logs += $logEntry
    $logs | ConvertTo-Json -Depth 10 | Set-Content $auditLogFile
}

function Get-QRBitmap {
    param([string]$Text, [int]$Size = 200)
    if ($script:QRCoderAvailable) {
        try {
            $gen = New-Object QRCoder.QRCodeGenerator
            $data = $gen.CreateQrCode($Text, [QRCoder.QRCodeGenerator+ECCLevel]::Q)
            $qr = New-Object QRCoder.QRCode $data
            $baseBmp = $qr.GetGraphic(10)
            $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.Clear([System.Drawing.Color]::White)
            $g.DrawImage($baseBmp, 0, 0, $Size, $Size)
            $g.Dispose()
            return $bmp
        } catch {}
    }
    try { [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 } catch {}
    $url = "https://chart.googleapis.com/chart?cht=qr&chs=${Size}x${Size}&chl=" + [System.Uri]::EscapeDataString($Text) + "&chld=L|0"
    try {
        $wc = New-Object System.Net.WebClient
        $bytes = $wc.DownloadData($url)
        $ms = New-Object System.IO.MemoryStream($bytes)
        return [System.Drawing.Bitmap]::FromStream($ms)
    }
    catch {
        $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.Clear([System.Drawing.Color]::White)
        $f = New-Object System.Drawing.Font("Arial", 10)
        $b = [System.Drawing.Brushes]::Black
        $g.DrawString($Text, $f, $b, 5, ($Size/2 - 10))
        $g.Dispose()
        return $bmp
    }
}

function Print-QRForIds {
    param([string[]]$Ids)
    $bitmaps = @()
    foreach ($id in $Ids) { $bitmaps += (Get-QRBitmap -Text $id -Size 220) }
    $script:PrintBitmaps = $bitmaps
    $script:PrintIndex = 0
    $doc = New-Object System.Drawing.Printing.PrintDocument
    $doc.add_PrintPage({
        param($sender, $e)
        $cols = 3
        $rows = 3
        $margin = 30
        $tileW = [int](($e.PageBounds.Width - ($margin*2)) / $cols)
        $tileH = [int](($e.PageBounds.Height - ($margin*2)) / $rows)
        for ($r=0; $r -lt $rows; $r++) {
            for ($c=0; $c -lt $cols; $c++) {
                if ($script:PrintIndex -ge $script:PrintBitmaps.Count) { $e.HasMorePages = $false; return }
                $x = $margin + $c * $tileW
                $y = $margin + $r * $tileH
                $bmp = $script:PrintBitmaps[$script:PrintIndex]
                $idText = $Ids[$script:PrintIndex]
                $dest = New-Object System.Drawing.Rectangle($x, $y, [Math]::Min($tileW-10, $bmp.Width), [Math]::Min($tileH-30, $bmp.Height))
                $e.Graphics.DrawImage($bmp, $dest)
                $font = New-Object System.Drawing.Font("Arial", 10)
                $e.Graphics.DrawString($idText, $font, [System.Drawing.Brushes]::Black, $x, $y + $dest.Height + 5)
                $script:PrintIndex++
            }
        }
        $e.HasMorePages = ($script:PrintIndex -lt $script:PrintBitmaps.Count)
    })
    $pd = New-Object System.Windows.Forms.PrintDialog
    $pd.Document = $doc
    if ($pd.ShowDialog() -eq "OK") { $doc.Print() }
}

function Print-IDs {
    param([string[]]$Ids)
    $doc = New-Object System.Drawing.Printing.PrintDocument
    $script:PrintIdList = $Ids
    $script:PrintIdIndex = 0
    $doc.add_PrintPage({
        param($sender,$e)
        $margin = 40
        $lineH = 24
        $y = $margin
        $font = New-Object System.Drawing.Font("Arial", 12)
        while ($y + $lineH -lt $e.PageBounds.Height - $margin) {
            if ($script:PrintIdIndex -ge $script:PrintIdList.Count) { $e.HasMorePages = $false; return }
            $text = $script:PrintIdList[$script:PrintIdIndex]
            $e.Graphics.DrawString($text, $font, [System.Drawing.Brushes]::Black, $margin, $y)
            $script:PrintIdIndex++
            $y += $lineH
        }
        $e.HasMorePages = ($script:PrintIdIndex -lt $script:PrintIdList.Count)
    })
    $pd = New-Object System.Windows.Forms.PrintDialog
    $pd.Document = $doc
    if ($pd.ShowDialog() -eq "OK") { $doc.Print() }
}

function Save-QRForIds {
    param([string[]]$Ids)
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    if ($dlg.ShowDialog() -ne "OK") { return }
    foreach ($id in $Ids) {
        $bmp = Get-QRBitmap -Text $id -Size 300
        $path = Join-Path $dlg.SelectedPath ("QR_" + $id + ".png")
        $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    }
}

function Show-QRPreview {
    param([string]$Id)
    $bmp = Get-QRBitmap -Text $Id -Size 300
    $f = New-Object System.Windows.Forms.Form
    $f.Text = "QR Preview - " + $Id
    $f.Size = New-Object System.Drawing.Size(360, 380)
    $f.StartPosition = "CenterScreen"
    $pb = New-Object System.Windows.Forms.PictureBox
    $pb.Location = New-Object System.Drawing.Point(20, 20)
    $pb.Size = New-Object System.Drawing.Size(300, 300)
    $pb.SizeMode = "Zoom"
    $pb.Image = $bmp
    $f.Controls.Add($pb)
    $f.ShowDialog()
}

function Get-TypeCode { param([string]$t) $s = ($t.ToUpper()).Trim(); if ($s.Length -gt 0) { return $s.Substring(0,1) } return "X" }
function Get-LocationCode { param([string]$l) $m = @{ "MUMBAI"="MUM"; "DELHI"="DEL"; "BANGALORE"="BLR"; "HYDERABAD"="HYD"; "CHENNAI"="CHN"; "KOLKATA"="CCU"; "PUNE"="PUN"; "JAIPUR"="JAI" }; $s = ($l.ToUpper() -replace "[^A-Z]", "").Trim(); if ($m.ContainsKey($s)) { return $m[$s] } if ($s.Length -ge 3) { return $s.Substring(0,3) } return "LOC" }
function Get-PurposeCode { param([string]$p) $m = @{ "OFFICE"="OF"; "RENTAL"="RE"; "STUDIO"="ST"; "FIELD"="FD"; "MAINTENANCE"="MT"; "PRODUCTION"="PR" }; $s = ($p.ToUpper()).Trim(); if ($m.ContainsKey($s)) { return $m[$s] } if ($s.Length -ge 2) { return $s.Substring(0,2) } return "PU" }
function Generate-AssetId { param([string]$type,[datetime]$date,[string]$location,[string]$purpose,[array]$existing) $tc = Get-TypeCode $type; $yy = $date.ToString("yy"); $mm = $date.ToString("MM"); $dd = $date.ToString("dd"); $lc = Get-LocationCode $location; $pc = Get-PurposeCode $purpose; $base = "$tc$yy$mm$dd$lc$pc"; $id = $base; $i = 1; $ids = @(); foreach ($a in $existing) { $ids += $a.Id } while ($ids -contains $id) { $suffix = "-" + ($i.ToString("00")); $id = $base + $suffix; $i++ } return $id }
function Normalize-Header { param([string]$h) return (($h -replace "[^a-zA-Z0-9]", "").ToLower()) }
function Import-AssetsFromExcel { param([string]$Path,[string]$User)
    $assets = @(Load-Assets)
    $excel = $null
    try { $excel = New-Object -ComObject Excel.Application } catch { $excel = $null }
    if ($excel -eq $null) { throw "Excel COM not available" }
    $excel.Visible = $false
    $wb = $excel.Workbooks.Open($Path)
    $ws = $wb.Worksheets.Item(1)
    $used = $ws.UsedRange
    $rows = $used.Rows.Count
    $cols = $used.Columns.Count
    $map = @{}
    for ($c=1; $c -le $cols; $c++) { $h = [string]$used.Cells.Item(1,$c).Text; $n = Normalize-Header $h; switch ($n) { "id" { $map["Id"] = $c } "assetid" { $map["Id"] = $c } "name" { $map["Name"] = $c } "type" { $map["Type"] = $c } "status" { $map["Status"] = $c } "location" { $map["Location"] = $c } "assignedto" { $map["AssignedTo"] = $c } "assigned" { $map["AssignedTo"] = $c } "notes" { $map["Notes"] = $c } "lastupdated" { $map["LastUpdated"] = $c } "purpose" { $map["Purpose"] = $c } "purchasedate" { $map["PurchaseDate"] = $c } default { } } }
    for ($r=2; $r -le $rows; $r++) {
        $get = { param($key) if ($map.ContainsKey($key)) { return [string]$used.Cells.Item($r, $map[$key]).Text } return "" }
        $pdText = & $get "PurchaseDate"
        $pd = Get-Date
        try { if ($pdText -ne "") { $pd = [datetime]$pdText } } catch { $pd = Get-Date }
        $id = & $get "Id"
        if ([string]::IsNullOrWhiteSpace($id)) { $id = Generate-AssetId -type (& $get "Type") -date $pd -location (& $get "Location") -purpose (& $get "Purpose") -existing $assets }
        if (($assets | Where-Object { $_.Id -eq $id }).Count -gt 0) { $id = Generate-AssetId -type (& $get "Type") -date $pd -location (& $get "Location") -purpose (& $get "Purpose") -existing $assets }
        $luText = & $get "LastUpdated"
        if (-not [string]::IsNullOrWhiteSpace($luText)) { $lastUpdated = $luText } else { $lastUpdated = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") }
        $asset = @{
            Id = $id
            Name = & $get "Name"
            Type = & $get "Type"
            Status = & $get "Status"
            Location = & $get "Location"
            Purpose = & $get "Purpose"
            PurchaseDate = $pd.ToString("yyyy-MM-dd")
            AssignedTo = & $get "AssignedTo"
            Notes = & $get "Notes"
            LastUpdated = $lastUpdated
        }
        $assets += $asset
        Write-AuditLog -Action "IMPORT" -User $User -AssetId $id -Details ("Asset imported: {0}" -f $asset.Name) -NewValue ($asset | ConvertTo-Json)
    }
    Save-Assets -Assets $assets
    $wb.Close($false)
    $excel.Quit()
}
function Import-AssetsFromCsv { param([string]$Path,[string]$User)
    $rows = Import-Csv -Path $Path
    $assets = @(Load-Assets)
    foreach ($row in $rows) {
        $h = @{}
        foreach ($p in $row.PSObject.Properties) { $h[(Normalize-Header $p.Name)] = $p.Value }
        $pd = Get-Date
        if ($h.ContainsKey("purchasedate") -and $h["purchasedate"]) { try { $pd = [datetime]$h["purchasedate"] } catch { $pd = Get-Date } }
        $id = $null
        if ($h.ContainsKey("id")) { $id = [string]$h["id"] }
        if ([string]::IsNullOrWhiteSpace($id)) { $id = Generate-AssetId -type ($h["type"]) -date $pd -location ($h["location"]) -purpose ($h["purpose"]) -existing $assets }
        if (($assets | Where-Object { $_.Id -eq $id }).Count -gt 0) { $id = Generate-AssetId -type ($h["type"]) -date $pd -location ($h["location"]) -purpose ($h["purpose"]) -existing $assets }
        $luText = $null
        if ($h.ContainsKey("lastupdated")) { $luText = [string]$h["lastupdated"] }
        if (-not [string]::IsNullOrWhiteSpace($luText)) { $lastUpdated = $luText } else { $lastUpdated = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") }
        $asset = @{
            Id = $id
            Name = $h["name"]
            Type = $h["type"]
            Status = $h["status"]
            Location = $h["location"]
            Purpose = $h["purpose"]
            PurchaseDate = $pd.ToString("yyyy-MM-dd")
            AssignedTo = $h["assignedto"]
            Notes = $h["notes"]
            LastUpdated = $lastUpdated
        }
        $assets += $asset
        Write-AuditLog -Action "IMPORT" -User $User -AssetId $id -Details ("Asset imported: {0}" -f $asset.Name) -NewValue ($asset | ConvertTo-Json)
    }
    Save-Assets -Assets $assets
}

function Export-ObjectsToJson {
    param([array]$Objects, [string]$Path)
    $Objects | ConvertTo-Json -Depth 10 | Set-Content $Path
}

function Export-ObjectsToExcel {
    param([array]$Objects, [string]$Path)
    $excel = $null
    try { $excel = New-Object -ComObject Excel.Application } catch { $excel = $null }
    if ($excel -eq $null) { throw "Excel COM not available" }
    $excel.Visible = $false
    $wb = $excel.Workbooks.Add()
    $ws = $wb.Worksheets.Item(1)
    $props = @()
    if ($Objects.Count -gt 0) { $props = $Objects[0].PSObject.Properties.Name }
    $ci = 1
    foreach ($p in $props) { $ws.Cells.Item(1, $ci) = $p; $ci++ }
    $ri = 2
    foreach ($obj in $Objects) {
        $ci = 1
        foreach ($p in $props) { $ws.Cells.Item($ri, $ci) = [string]$obj.$p; $ci++ }
        $ri++
    }
    $wb.SaveAs($Path)
    $wb.Close($true)
    $excel.Quit()
}

function Convert-DataTableToObjects {
    param([System.Data.DataTable]$dt)
    $objs = @()
    foreach ($row in $dt.Rows) {
        $ht = @{}
        foreach ($col in $dt.Columns) { $ht[$col.ColumnName] = $row[$col.ColumnName] }
        $objs += [PSCustomObject]$ht
    }
    return $objs
}

function Convert-DataViewToObjects {
    param([System.Data.DataView]$dv)
    $dt = $dv.ToTable()
    return Convert-DataTableToObjects -dt $dt
}

$script:LocationServer = $null
$script:LocationTask = $null
$script:ServerBaseUrl = $null
function Get-LocalIP { $nics = [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | Where-Object { $_.OperationalStatus -eq 'Up' -and $_.NetworkInterfaceType -ne 'Loopback' }
    foreach ($nic in $nics) { $props = $nic.GetIPProperties().UnicastAddresses; foreach ($u in $props) { if ($u.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) { return $u.Address.ToString() } } }
    return '127.0.0.1' }
function Write-Response { param($ctx,[string]$content,[string]$ctype="text/html") $bytes = [System.Text.Encoding]::UTF8.GetBytes($content); $ctx.Response.ContentType = $ctype; $ctx.Response.ContentLength64 = $bytes.Length; $ctx.Response.OutputStream.Write($bytes,0,$bytes.Length); $ctx.Response.Close() }
function Start-LocationServer { param([int]$Port=8080) if ($script:LocationServer -ne $null) { return }
    $ip = Get-LocalIP
    $prefix = "http://$($ip):$($Port)/"
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add($prefix)
    $listener.Start()
    $script:LocationServer = $listener
    $script:ServerBaseUrl = $prefix
    $script:LocationTask = [System.Threading.Tasks.Task]::Run({
        while ($script:LocationServer -ne $null -and $script:LocationServer.IsListening) {
            try {
                $ctx = $script:LocationServer.GetContext()
                $path = $ctx.Request.Url.AbsolutePath
                if ($path -like '/asset/*') {
                    $id = ($path -split '/')[2]
                    $html = "<html><head><meta charset='utf-8'><title>Update Location</title></head><body><script>function send(lat,lon){fetch('/api/update?id=" + $id + "&lat='+lat+'&lon='+lon,{method:'POST'}).then(r=>r.text()).then(t=>document.body.innerText=t).catch(e=>document.body.innerText='Error');} if(navigator.geolocation){navigator.geolocation.getCurrentPosition(function(p){send(p.coords.latitude,p.coords.longitude)}, function(){document.body.innerText='Permission denied'})} else {document.body.innerText='Geolocation not supported'}</script></body></html>"
                    Write-Response -ctx $ctx -content $html -ctype 'text/html'
                }
                elseif ($path -eq '/api/update' -and $ctx.Request.HttpMethod -eq 'POST') {
                    $id = $ctx.Request.QueryString['id']
                    $lat = $ctx.Request.QueryString['lat']
                    $lon = $ctx.Request.QueryString['lon']
                    $assets = @(Load-Assets)
                    $asset = $assets | Where-Object { $_.Id -eq $id }
                    if ($asset) {
                        $asset.Location = "Geo: $lat,$lon"
                        $asset.LastUpdated = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
                        Save-Assets -Assets $assets
                        Write-AuditLog -Action 'LOCATION_UPDATE' -User 'qr' -AssetId $id -Details ("Location set to {0},{1}" -f $lat,$lon) -Severity 'INFO' -Metadata @{ Latitude = $lat; Longitude = $lon }
                        Write-Response -ctx $ctx -content 'Updated'
                    } else { Write-Response -ctx $ctx -content 'Asset not found' }
                }
                else { Write-Response -ctx $ctx -content 'OK' }
            }
            catch {}
        }
    })
}
function Stop-LocationServer { if ($script:LocationServer -ne $null) { try { $script:LocationServer.Stop(); $script:LocationServer.Close() } catch {} ; $script:LocationServer = $null; $script:ServerBaseUrl = $null } }

# Load/Save functions
function Load-Assets {
    if (Test-Path $assetsFile) {
        try {
            $data = Get-Content $assetsFile -Raw | ConvertFrom-Json
            if ($data -isnot [array]) { return @($data) }
            return $data
        }
        catch {
            return @()
        }
    }
    return @()
}

function Save-Assets {
    param([array]$Assets)
    $Assets | ConvertTo-Json -Depth 10 | Set-Content $assetsFile
}

function Load-Users {
    if (Test-Path $usersFile) {
        try {
            return Get-Content $usersFile -Raw | ConvertFrom-Json
        }
        catch {
            # Create default users
            $defaultUsers = @{
                users = @(
                    @{
                        username = "admin"
                        password = "admin123"
                        role = "superuser"
                        fullname = "System Administrator"
                    },
                    @{
                        username = "user"
                        password = "user123"
                        role = "user"
                        fullname = "Regular User"
                    }
                )
            }
            $defaultUsers | ConvertTo-Json -Depth 10 | Set-Content $usersFile
            return $defaultUsers
        }
    }
    else {
        # Create default users
        $defaultUsers = @{
            users = @(
                @{
                    username = "admin"
                    password = "admin123"
                    role = "superuser"
                    fullname = "System Administrator"
                },
                @{
                    username = "user"
                    password = "user123"
                    role = "user"
                    fullname = "Regular User"
                }
            )
        }
        $defaultUsers | ConvertTo-Json -Depth 10 | Set-Content $usersFile
        return $defaultUsers
    }
}

function Authenticate-User {
    param([string]$Username, [string]$Password, [object]$Users)
    
    foreach ($user in $Users.users) {
        if ($user.username -eq $Username -and $user.password -eq $Password) {
            return $user
        }
    }
    return $null
}

# Login Form
function Show-LoginForm {
    $loginForm = New-Object System.Windows.Forms.Form
    $loginForm.Text = "Asset Management - Login"
    $loginForm.Size = New-Object System.Drawing.Size(350, 200)
    $loginForm.StartPosition = "CenterScreen"
    $loginForm.FormBorderStyle = "FixedDialog"
    $loginForm.MaximizeBox = $false
    
    $lblUsername = New-Object System.Windows.Forms.Label
    $lblUsername.Location = New-Object System.Drawing.Point(20, 30)
    $lblUsername.Size = New-Object System.Drawing.Size(80, 23)
    $lblUsername.Text = "Username:"
    $loginForm.Controls.Add($lblUsername)
    
    $txtUsername = New-Object System.Windows.Forms.TextBox
    $txtUsername.Location = New-Object System.Drawing.Point(110, 30)
    $txtUsername.Size = New-Object System.Drawing.Size(200, 23)
    $loginForm.Controls.Add($txtUsername)
    
    $lblPassword = New-Object System.Windows.Forms.Label
    $lblPassword.Location = New-Object System.Drawing.Point(20, 70)
    $lblPassword.Size = New-Object System.Drawing.Size(80, 23)
    $lblPassword.Text = "Password:"
    $loginForm.Controls.Add($lblPassword)
    
    $txtPassword = New-Object System.Windows.Forms.TextBox
    $txtPassword.Location = New-Object System.Drawing.Point(110, 70)
    $txtPassword.Size = New-Object System.Drawing.Size(200, 23)
    $txtPassword.PasswordChar = '*'
    $loginForm.Controls.Add($txtPassword)
    
    $btnLogin = New-Object System.Windows.Forms.Button
    $btnLogin.Location = New-Object System.Drawing.Point(110, 110)
    $btnLogin.Size = New-Object System.Drawing.Size(100, 30)
    $btnLogin.Text = "Login"
    $btnLogin.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $loginForm.Controls.Add($btnLogin)
    $loginForm.AcceptButton = $btnLogin
    
    $lblInfo = New-Object System.Windows.Forms.Label
    $lblInfo.Location = New-Object System.Drawing.Point(20, 150)
    $lblInfo.Size = New-Object System.Drawing.Size(300, 30)
    $lblInfo.Text = "Default: admin/admin123 or user/user123"
    $lblInfo.ForeColor = [System.Drawing.Color]::Gray
    $loginForm.Controls.Add($lblInfo)
    
    $result = $loginForm.ShowDialog()
    
    if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
        return @{
            Username = $txtUsername.Text
            Password = $txtPassword.Text
        }
    }
    return $null
}

# Main Asset Manager Form
function Show-AssetManager {
    param([object]$CurrentUser)
    
    $users = Load-Users
    $assets = Load-Assets
    
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "Asset Management System - $($CurrentUser.fullname) ($($CurrentUser.role))"
    $form.Size = New-Object System.Drawing.Size(1000, 700)
    $form.StartPosition = "CenterScreen"
    
    $lblAssets = New-Object System.Windows.Forms.Label
    $lblAssets.Location = New-Object System.Drawing.Point(20, 20)
    $lblAssets.Size = New-Object System.Drawing.Size(200, 23)
    $lblAssets.Text = "Assets:"
    $form.Controls.Add($lblAssets)
    
    $dgvAssets = New-Object System.Windows.Forms.DataGridView
    $dgvAssets.Location = New-Object System.Drawing.Point(20, 50)
    $dgvAssets.Size = New-Object System.Drawing.Size(950, 400)
    $dgvAssets.AutoSizeColumnsMode = "Fill"
    $dgvAssets.SelectionMode = "FullRowSelect"
    $dgvAssets.ReadOnly = $false
    $dgvAssets.AllowUserToAddRows = $false
    $form.Controls.Add($dgvAssets)
    $cmAssets = New-Object System.Windows.Forms.ContextMenuStrip
    $miPreviewQR = New-Object System.Windows.Forms.ToolStripMenuItem
    $miPreviewQR.Text = "Preview QR"
    $cmAssets.Items.Add($miPreviewQR) | Out-Null
    $miSaveQR = New-Object System.Windows.Forms.ToolStripMenuItem
    $miSaveQR.Text = "Save QR..."
    $cmAssets.Items.Add($miSaveQR) | Out-Null
    $miPrintQR = New-Object System.Windows.Forms.ToolStripMenuItem
    $miPrintQR.Text = "Print QR"
    $cmAssets.Items.Add($miPrintQR) | Out-Null
    $miPrintIDs = New-Object System.Windows.Forms.ToolStripMenuItem
    $miPrintIDs.Text = "Print IDs"
    $cmAssets.Items.Add($miPrintIDs) | Out-Null
    $dgvAssets.ContextMenuStrip = $cmAssets
    $miPreviewQR.Add_Click({ if ($dgvAssets.SelectedRows.Count -eq 0) { return } $id = [string]$dgvAssets.SelectedRows[0].Cells["ID"].Value; Show-QRPreview -Id $id })
    $miSaveQR.Add_Click({ if ($dgvAssets.SelectedRows.Count -eq 0) { return } $ids = @(); foreach ($row in $dgvAssets.SelectedRows) { $ids += [string]$row.Cells["ID"].Value }; Save-QRForIds -Ids $ids })
    $miPrintQR.Add_Click({ if ($dgvAssets.SelectedRows.Count -eq 0) { return } $ids = @(); foreach ($row in $dgvAssets.SelectedRows) { $ids += [string]$row.Cells["ID"].Value }; Print-QRForIds -Ids $ids })
    $miPrintIDs.Add_Click({ if ($dgvAssets.SelectedRows.Count -eq 0) { return } $ids = @(); foreach ($row in $dgvAssets.SelectedRows) { $ids += [string]$row.Cells["ID"].Value }; Print-IDs -Ids $ids })
    
    function Refresh-AssetList {
        $prevFilter = $script:AssetView.RowFilter
        $prevSort = $script:AssetView.Sort
        $assets = @(Load-Assets)
        if ($assets.Count -eq 0) {
            $dgvAssets.DataSource = @()
            $script:AssetView = New-Object System.Data.DataView((New-Object System.Data.DataTable))
            return
        }
        $assetTable = New-Object System.Data.DataTable
        $assetTable.Columns.Add("ID") | Out-Null
        $assetTable.Columns.Add("Name") | Out-Null
        $assetTable.Columns.Add("Type") | Out-Null
        $assetTable.Columns.Add("Status") | Out-Null
        $assetTable.Columns.Add("Location") | Out-Null
        $assetTable.Columns.Add("Assigned To") | Out-Null
        $assetTable.Columns.Add("Notes") | Out-Null
        $assetTable.Columns.Add("Last Updated") | Out-Null
        foreach ($asset in $assets) {
            $row = $assetTable.NewRow()
            $row["ID"] = $asset.Id
            $row["Name"] = $asset.Name
            $row["Type"] = $asset.Type
            $row["Status"] = $asset.Status
            $row["Location"] = $asset.Location
            $row["Assigned To"] = $asset.AssignedTo
            $row["Notes"] = $asset.Notes
            $row["Last Updated"] = $asset.LastUpdated
            $assetTable.Rows.Add($row) | Out-Null
        }
        $script:AssetView = New-Object System.Data.DataView($assetTable)
        $script:AssetView.RowFilter = $prevFilter
        $script:AssetView.Sort = $prevSort
        $dgvAssets.DataSource = $script:AssetView
    }
    
    Refresh-AssetList
    $lblSearch = New-Object System.Windows.Forms.Label
    $lblSearch.Location = New-Object System.Drawing.Point(600, 20)
    $lblSearch.Size = New-Object System.Drawing.Size(70, 23)
    $lblSearch.Text = "Search:"
    $form.Controls.Add($lblSearch)
    $txtSearch = New-Object System.Windows.Forms.TextBox
    $txtSearch.Location = New-Object System.Drawing.Point(670, 20)
    $txtSearch.Size = New-Object System.Drawing.Size(300, 23)
    $form.Controls.Add($txtSearch)
    $lblSortBy = New-Object System.Windows.Forms.Label
    $lblSortBy.Location = New-Object System.Drawing.Point(600, 50)
    $lblSortBy.Size = New-Object System.Drawing.Size(70, 23)
    $lblSortBy.Text = "Sort By:"
    $form.Controls.Add($lblSortBy)
    $cmbSortBy = New-Object System.Windows.Forms.ComboBox
    $cmbSortBy.Location = New-Object System.Drawing.Point(670, 50)
    $cmbSortBy.Size = New-Object System.Drawing.Size(180, 23)
    $cmbSortBy.Items.AddRange(@("ID","Name","Type","Status","Location","Assigned To","Notes","Last Updated"))
    $cmbSortBy.DropDownStyle = "DropDownList"
    $cmbSortBy.SelectedIndex = 1
    $form.Controls.Add($cmbSortBy)
    $cmbSortDir = New-Object System.Windows.Forms.ComboBox
    $cmbSortDir.Location = New-Object System.Drawing.Point(860, 50)
    $cmbSortDir.Size = New-Object System.Drawing.Size(110, 23)
    $cmbSortDir.Items.AddRange(@("Ascending","Descending"))
    $cmbSortDir.DropDownStyle = "DropDownList"
    $cmbSortDir.SelectedIndex = 0
    $form.Controls.Add($cmbSortDir)
    function Apply-AssetSort {
        $col = $cmbSortBy.SelectedItem
        $dir = if ($cmbSortDir.SelectedItem -eq "Descending") { "DESC" } else { "ASC" }
        if ($col) { $script:AssetView.Sort = "[" + $col + "] " + $dir }
    }
    $cmbSortBy.Add_SelectedIndexChanged({ Apply-AssetSort })
    $cmbSortDir.Add_SelectedIndexChanged({ Apply-AssetSort })
    $txtSearch.Add_TextChanged({
        $q = $txtSearch.Text.Trim()
        if ($q -eq "") { $script:AssetView.RowFilter = ""; return }
        $qEsc = $q.Replace("'", "''")
        $cols = @("ID","Name","Type","Status","Location","Assigned To","Notes","Last Updated")
        $exprs = @()
        foreach ($c in $cols) { $exprs += "CONVERT([" + $c + "], 'System.String') LIKE '%" + $qEsc + "%'" }
        $script:AssetView.RowFilter = ($exprs -join " OR ")
    })
    
    # Buttons
    $btnAdd = New-Object System.Windows.Forms.Button
    $btnAdd.Location = New-Object System.Drawing.Point(20, 460)
    $btnAdd.Size = New-Object System.Drawing.Size(100, 30)
    $btnAdd.Text = "Add Asset"
    $form.Controls.Add($btnAdd)
    
    $btnUpdate = New-Object System.Windows.Forms.Button
    $btnUpdate.Location = New-Object System.Drawing.Point(130, 460)
    $btnUpdate.Size = New-Object System.Drawing.Size(100, 30)
    $btnUpdate.Text = "Update Selected"
    $form.Controls.Add($btnUpdate)
    
    $btnDelete = New-Object System.Windows.Forms.Button
    $btnDelete.Location = New-Object System.Drawing.Point(240, 460)
    $btnDelete.Size = New-Object System.Drawing.Size(100, 30)
    $btnDelete.Text = "Delete Selected"
    if ($CurrentUser.username -ne "admin") { $btnDelete.Enabled = $false }
    $form.Controls.Add($btnDelete)
    
    $btnRefresh = New-Object System.Windows.Forms.Button
    $btnRefresh.Location = New-Object System.Drawing.Point(350, 460)
    $btnRefresh.Size = New-Object System.Drawing.Size(100, 30)
    $btnRefresh.Text = "Refresh"
    $form.Controls.Add($btnRefresh)
    
    $btnAuditLog = New-Object System.Windows.Forms.Button
    $btnAuditLog.Location = New-Object System.Drawing.Point(460, 460)
    $btnAuditLog.Size = New-Object System.Drawing.Size(120, 30)
    $btnAuditLog.Text = "View Audit Log"
    if ($CurrentUser.role -ne "superuser") {
        $btnAuditLog.Enabled = $false
    }
    $form.Controls.Add($btnAuditLog)

    $btnExportAssetsJson = New-Object System.Windows.Forms.Button
    $btnExportAssetsJson.Location = New-Object System.Drawing.Point(590, 460)
    $btnExportAssetsJson.Size = New-Object System.Drawing.Size(120, 30)
    $btnExportAssetsJson.Text = "Export JSON"
    $form.Controls.Add($btnExportAssetsJson)
    $btnExportAssetsExcel = New-Object System.Windows.Forms.Button
    $btnExportAssetsExcel.Location = New-Object System.Drawing.Point(720, 460)
    $btnExportAssetsExcel.Size = New-Object System.Drawing.Size(120, 30)
    $btnExportAssetsExcel.Text = "Export Excel"
    $form.Controls.Add($btnExportAssetsExcel)
    $btnImportAssetsExcel = New-Object System.Windows.Forms.Button
    $btnImportAssetsExcel.Location = New-Object System.Drawing.Point(840, 460)
    $btnImportAssetsExcel.Size = New-Object System.Drawing.Size(120, 30)
    $btnImportAssetsExcel.Text = "Import Excel"
    $form.Controls.Add($btnImportAssetsExcel)
    $btnPrintQR = New-Object System.Windows.Forms.Button
    $btnPrintQR.Location = New-Object System.Drawing.Point(20, 530)
    $btnPrintQR.Size = New-Object System.Drawing.Size(120, 30)
    $btnPrintQR.Text = "Print QR"
    $form.Controls.Add($btnPrintQR)
    $btnPrintIDs = New-Object System.Windows.Forms.Button
    $btnPrintIDs.Location = New-Object System.Drawing.Point(150, 530)
    $btnPrintIDs.Size = New-Object System.Drawing.Size(120, 30)
    $btnPrintIDs.Text = "Print IDs"
    $form.Controls.Add($btnPrintIDs)
    $btnSaveQR = New-Object System.Windows.Forms.Button
    $btnSaveQR.Location = New-Object System.Drawing.Point(280, 530)
    $btnSaveQR.Size = New-Object System.Drawing.Size(120, 30)
    $btnSaveQR.Text = "Save QR"
    $form.Controls.Add($btnSaveQR)
    $btnPreviewQR = New-Object System.Windows.Forms.Button
    $btnPreviewQR.Location = New-Object System.Drawing.Point(410, 530)
    $btnPreviewQR.Size = New-Object System.Drawing.Size(120, 30)
    $btnPreviewQR.Text = "Preview QR"
    $form.Controls.Add($btnPreviewQR)
    $btnStartServer = New-Object System.Windows.Forms.Button
    $btnStartServer.Location = New-Object System.Drawing.Point(540, 530)
    $btnStartServer.Size = New-Object System.Drawing.Size(140, 30)
    $btnStartServer.Text = "Start Location Server"
    $form.Controls.Add($btnStartServer)
    $btnStopServer = New-Object System.Windows.Forms.Button
    $btnStopServer.Location = New-Object System.Drawing.Point(690, 530)
    $btnStopServer.Size = New-Object System.Drawing.Size(140, 30)
    $btnStopServer.Text = "Stop Server"
    $form.Controls.Add($btnStopServer)
    $btnGenerateQR = New-Object System.Windows.Forms.Button
    $btnGenerateQR.Location = New-Object System.Drawing.Point(840, 530)
    $btnGenerateQR.Size = New-Object System.Drawing.Size(140, 30)
    $btnGenerateQR.Text = "Generate QR"
    $form.Controls.Add($btnGenerateQR)
    
    $btnLogout = New-Object System.Windows.Forms.Button
    $btnLogout.Location = New-Object System.Drawing.Point(870, 460)
    $btnLogout.Size = New-Object System.Drawing.Size(100, 30)
    $btnLogout.Text = "Logout"
    $form.Controls.Add($btnLogout)
    
    # Status label
    $lblStatus = New-Object System.Windows.Forms.Label
    $lblStatus.Location = New-Object System.Drawing.Point(20, 500)
    $lblStatus.Size = New-Object System.Drawing.Size(950, 23)
    $lblStatus.Text = "Ready"
    $form.Controls.Add($lblStatus)
    
    # Add Asset
    $btnAdd.Add_Click({
        $addForm = New-Object System.Windows.Forms.Form
        $addForm.Text = "Add New Asset"
        $addForm.Size = New-Object System.Drawing.Size(400, 400)
        $addForm.StartPosition = "CenterScreen"
        
        $y = 20
        $fields = @("Name", "Type", "Status", "Location", "Purpose", "Purchase Date", "Assigned To", "Notes")
        $controls = @{}
        
        foreach ($field in $fields) {
            $lbl = New-Object System.Windows.Forms.Label
            $lbl.Location = New-Object System.Drawing.Point(20, $y)
            $lbl.Size = New-Object System.Drawing.Size(100, 23)
            $lbl.Text = "$field :"
            $addForm.Controls.Add($lbl)
            
            $txt = New-Object System.Windows.Forms.TextBox
            $txt.Location = New-Object System.Drawing.Point(130, $y)
            $txt.Size = New-Object System.Drawing.Size(230, 23)
            
            if ($field -eq "Type") {
                $cmb = New-Object System.Windows.Forms.ComboBox
                $cmb.Location = New-Object System.Drawing.Point(130, $y)
                $cmb.Size = New-Object System.Drawing.Size(230, 23)
                $cmb.Items.AddRange(@(
                    "Server", "Workstation", "Laptop", "Networking Gear", "Storage",
                    "Camera", "Audio Equipment", "Lighting", "Studio Equipment",
                    "Peripheral", "Component", "Software License", "Furniture", "Vehicle",
                    "Computer", "Printer", "Monitor", "Phone", "Tablet", "Other"
                ))
                $cmb.DropDownStyle = "DropDownList"
                $controls[$field] = $cmb
                $addForm.Controls.Add($cmb)
            }
            elseif ($field -eq "Status") {
                $cmb = New-Object System.Windows.Forms.ComboBox
                $cmb.Location = New-Object System.Drawing.Point(130, $y)
                $cmb.Size = New-Object System.Drawing.Size(230, 23)
                $cmb.Items.AddRange(@("Available", "In Use", "Repair", "Retired", "Lost"))
                $cmb.DropDownStyle = "DropDownList"
                $cmb.SelectedIndex = 0
                $controls[$field] = $cmb
                $addForm.Controls.Add($cmb)
            }
            elseif ($field -eq "Purpose") {
                $cmb = New-Object System.Windows.Forms.ComboBox
                $cmb.Location = New-Object System.Drawing.Point(130, $y)
                $cmb.Size = New-Object System.Drawing.Size(230, 23)
                $cmb.Items.AddRange(@("Office", "Rental", "Studio", "Field", "Maintenance", "Production"))
                $cmb.DropDownStyle = "DropDownList"
                $cmb.SelectedIndex = 0
                $controls[$field] = $cmb
                $addForm.Controls.Add($cmb)
            }
            elseif ($field -eq "Purchase Date") {
                $dtp = New-Object System.Windows.Forms.DateTimePicker
                $dtp.Location = New-Object System.Drawing.Point(130, $y)
                $dtp.Size = New-Object System.Drawing.Size(230, 23)
                $dtp.Format = [System.Windows.Forms.DateTimePickerFormat]::Short
                $controls[$field] = $dtp
                $addForm.Controls.Add($dtp)
            }
            elseif ($field -eq "Notes") {
                $txt.Multiline = $true
                $txt.Size = New-Object System.Drawing.Size(230, 80)
            }
            else {
                $controls[$field] = $txt
                $addForm.Controls.Add($txt)
            }
            
            $y += 40
        }
        
        $btnSave = New-Object System.Windows.Forms.Button
        $btnSave.Location = New-Object System.Drawing.Point(130, 320)
        $btnSave.Size = New-Object System.Drawing.Size(100, 30)
        $btnSave.Text = "Save"
        $addForm.Controls.Add($btnSave)
        
        $btnSave.Add_Click({
            $assets = @(Load-Assets)
            function Get-TypeCode { param([string]$t) $s = ($t.ToUpper()).Trim(); if ($s.Length -gt 0) { return $s.Substring(0,1) } return "X" }
            function Get-LocationCode { param([string]$l) $m = @{ "MUMBAI"="MUM"; "DELHI"="DEL"; "BANGALORE"="BLR"; "HYDERABAD"="HYD"; "CHENNAI"="CHN"; "KOLKATA"="CCU"; "PUNE"="PUN"; "JAIPUR"="JAI" }; $s = ($l.ToUpper() -replace "[^A-Z]", "").Trim(); if ($m.ContainsKey($s)) { return $m[$s] } if ($s.Length -ge 3) { return $s.Substring(0,3) } return "LOC" }
            function Get-PurposeCode { param([string]$p) $m = @{ "OFFICE"="OF"; "RENTAL"="RE"; "STUDIO"="ST"; "FIELD"="FD"; "MAINTENANCE"="MT"; "PRODUCTION"="PR" }; $s = ($p.ToUpper()).Trim(); if ($m.ContainsKey($s)) { return $m[$s] } if ($s.Length -ge 2) { return $s.Substring(0,2) } return "PU" }
            function Generate-AssetId { param([string]$type,[datetime]$date,[string]$location,[string]$purpose,[array]$existing) $tc = Get-TypeCode $type; $yy = $date.ToString("yy"); $mm = $date.ToString("MM"); $dd = $date.ToString("dd"); $lc = Get-LocationCode $location; $pc = Get-PurposeCode $purpose; $base = "$tc$yy$mm$dd$lc$pc"; $id = $base; $i = 1; $ids = @(); foreach ($a in $existing) { $ids += $a.Id } while ($ids -contains $id) { $suffix = "-" + ($i.ToString("00")); $id = $base + $suffix; $i++ } return $id }
            $pd = $controls["Purchase Date"].Value
            $newId = Generate-AssetId -type $controls["Type"].SelectedItem -date $pd -location $controls["Location"].Text -purpose $controls["Purpose"].SelectedItem -existing $assets
            $newAsset = @{
                Id = $newId
                Name = $controls["Name"].Text
                Type = $controls["Type"].SelectedItem
                Status = $controls["Status"].SelectedItem
                Location = $controls["Location"].Text
                Purpose = $controls["Purpose"].SelectedItem
                PurchaseDate = $pd.ToString("yyyy-MM-dd")
                AssignedTo = $controls["Assigned To"].Text
                Notes = $controls["Notes"].Text
                LastUpdated = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
            }
            $assets += $newAsset
            Save-Assets -Assets $assets
            Write-AuditLog -Action "CREATE" -User $CurrentUser.username -AssetId $newId -Details ("Asset created: {0}" -f $newAsset.Name) -NewValue ($newAsset | ConvertTo-Json) -Severity "INFO" -Metadata $newAsset
            $lblStatus.Text = "Asset added successfully: $newId"
            Refresh-AssetList
            $addForm.Close()
        })
        
        $addForm.ShowDialog()
    })
    
    # Update Asset
        $btnUpdate.Add_Click({
        if ($dgvAssets.SelectedRows.Count -eq 0) {
            [System.Windows.Forms.MessageBox]::Show("Please select an asset to update.", "No Selection", "OK", "Information")
            return
        }
        
        $selectedRow = $dgvAssets.SelectedRows[0]
        $assetId = $selectedRow.Cells["ID"].Value
        $assets = @(Load-Assets)
        $asset = $assets | Where-Object { $_.Id -eq $assetId }
        
        if (-not $asset) {
            [System.Windows.Forms.MessageBox]::Show("Asset not found.", "Error", "OK", "Error")
            return
        }
        
        # Store old values for audit
        $oldAsset = $asset | ConvertTo-Json
        
        # Update from grid
        $asset.Name = $selectedRow.Cells["Name"].Value
        $asset.Type = $selectedRow.Cells["Type"].Value
        $asset.Status = $selectedRow.Cells["Status"].Value
        $asset.Location = $selectedRow.Cells["Location"].Value
        $asset.AssignedTo = $selectedRow.Cells["Assigned To"].Value
        $asset.Notes = $selectedRow.Cells["Notes"].Value
        $asset.LastUpdated = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
        
        Save-Assets -Assets $assets
        
        Write-AuditLog -Action "UPDATE" -User $CurrentUser.username -AssetId $assetId `
            -Details "Asset updated: $($asset.Name)" -OldValue $oldAsset -NewValue ($asset | ConvertTo-Json)
        
        $lblStatus.Text = "Asset updated successfully: $assetId"
        Refresh-AssetList
    })
    
    # Delete Asset
    $btnDelete.Add_Click({
        if ($CurrentUser.username -ne "admin") {
            [System.Windows.Forms.MessageBox]::Show("Only admin can delete assets.", "Access Denied", "OK", "Warning")
            if ($dgvAssets.SelectedRows.Count -gt 0) {
                $aid = $dgvAssets.SelectedRows[0].Cells["ID"].Value
                Write-AuditLog -Action "DELETE_ATTEMPT" -User $CurrentUser.username -AssetId $aid -Details "Unauthorized delete attempt" -Severity "WARNING"
            }
            return
        }
        if ($dgvAssets.SelectedRows.Count -eq 0) {
            [System.Windows.Forms.MessageBox]::Show("Please select an asset to delete.", "No Selection", "OK", "Information")
            return
        }
        
        $result = [System.Windows.Forms.MessageBox]::Show(
            "Are you sure you want to delete this asset?",
            "Confirm Delete",
            "YesNo",
            "Question"
        )
        
        if ($result -eq "Yes") {
            $selectedRow = $dgvAssets.SelectedRows[0]
            $assetId = $selectedRow.Cells["ID"].Value
            $assetName = $selectedRow.Cells["Name"].Value
            
            $assets = @(Load-Assets)
            $assets = $assets | Where-Object { $_.Id -ne $assetId }
            Save-Assets -Assets $assets
            
            Write-AuditLog -Action "DELETE" -User $CurrentUser.username -AssetId $assetId -Details ("Asset deleted: {0}" -f $assetName) -Severity "INFO"
            
            $lblStatus.Text = "Asset deleted: $assetId"
            Refresh-AssetList
        }
    })
    
    # Refresh
    $btnRefresh.Add_Click({
        Refresh-AssetList
        $lblStatus.Text = "Asset list refreshed"
    })

    $btnExportAssetsJson.Add_Click({
        if ($null -eq $script:AssetView) { Refresh-AssetList }
        $objs = Convert-DataViewToObjects -dv $script:AssetView
        $dlg = New-Object System.Windows.Forms.SaveFileDialog
        $dlg.Filter = "JSON files (*.json)|*.json"
        $dlg.FileName = "assets_export.json"
        if ($dlg.ShowDialog() -eq "OK") {
            Export-ObjectsToJson -Objects $objs -Path $dlg.FileName
            $lblStatus.Text = "Exported assets to JSON"
        }
    })
    $btnExportAssetsExcel.Add_Click({
        if ($null -eq $script:AssetView) { Refresh-AssetList }
        $objs = Convert-DataViewToObjects -dv $script:AssetView
        $dlg = New-Object System.Windows.Forms.SaveFileDialog
        $dlg.Filter = "Excel Workbook (*.xlsx)|*.xlsx"
        $dlg.FileName = "assets_export.xlsx"
        if ($dlg.ShowDialog() -eq "OK") {
            try {
                Export-ObjectsToExcel -Objects $objs -Path $dlg.FileName
                $lblStatus.Text = "Exported assets to Excel"
            } catch {
                $dlgCsv = New-Object System.Windows.Forms.SaveFileDialog
                $dlgCsv.Filter = "CSV files (*.csv)|*.csv"
                $dlgCsv.FileName = "assets_export.csv"
                if ($dlgCsv.ShowDialog() -eq "OK") {
                    $objs | Export-Csv -Path $dlgCsv.FileName -NoTypeInformation -Force
                    $lblStatus.Text = "Excel export unavailable, saved CSV"
                }
            }
        }
    })
    $btnImportAssetsExcel.Add_Click({
        $dlg = New-Object System.Windows.Forms.OpenFileDialog
        $dlg.Filter = "Excel Workbook (*.xlsx)|*.xlsx|CSV files (*.csv)|*.csv"
        if ($dlg.ShowDialog() -eq "OK") {
            try {
                if ($dlg.FileName.ToLower().EndsWith(".xlsx")) {
                    Import-AssetsFromExcel -Path $dlg.FileName -User $CurrentUser.username
                }
                else {
                    Import-AssetsFromCsv -Path $dlg.FileName -User $CurrentUser.username
                }
                Refresh-AssetList
                $lblStatus.Text = "Imported assets from file"
            } catch {
                [System.Windows.Forms.MessageBox]::Show("Import failed. Try CSV if Excel is unavailable.", "Import Error", "OK", "Error")
            }
        }
    })
    $btnPrintQR.Add_Click({
        if ($dgvAssets.SelectedRows.Count -eq 0) { [System.Windows.Forms.MessageBox]::Show("Select assets.", "Info", "OK", "Information"); return }
        $ids = @()
        foreach ($row in $dgvAssets.SelectedRows) { $ids += [string]$row.Cells["ID"].Value }
        Print-QRForIds -Ids $ids
    })
    $btnPrintIDs.Add_Click({
        if ($dgvAssets.SelectedRows.Count -eq 0) { [System.Windows.Forms.MessageBox]::Show("Select assets.", "Info", "OK", "Information"); return }
        $ids = @()
        foreach ($row in $dgvAssets.SelectedRows) { $ids += [string]$row.Cells["ID"].Value }
        Print-IDs -Ids $ids
    })
    $btnSaveQR.Add_Click({
        if ($dgvAssets.SelectedRows.Count -eq 0) { [System.Windows.Forms.MessageBox]::Show("Select assets.", "Info", "OK", "Information"); return }
        $ids = @()
        foreach ($row in $dgvAssets.SelectedRows) { $ids += [string]$row.Cells["ID"].Value }
        Save-QRForIds -Ids $ids
        $lblStatus.Text = "Saved QR PNGs for selected assets"
    })
    $btnPreviewQR.Add_Click({
        if ($dgvAssets.SelectedRows.Count -eq 0) { [System.Windows.Forms.MessageBox]::Show("Select an asset.", "Info", "OK", "Information"); return }
        $id = [string]$dgvAssets.SelectedRows[0].Cells["ID"].Value
        Show-QRPreview -Id $id
    })
    $btnStartServer.Add_Click({
        Start-LocationServer -Port 8080
        $lblStatus.Text = "Location server running at " + $script:ServerBaseUrl
    })
    $btnStopServer.Add_Click({
        Stop-LocationServer
        $lblStatus.Text = "Location server stopped"
    })
    $btnGenerateQR.Add_Click({
        if ($dgvAssets.SelectedRows.Count -eq 0) { [System.Windows.Forms.MessageBox]::Show("Select assets.", "Info", "OK", "Information"); return }
        $ids = @()
        foreach ($row in $dgvAssets.SelectedRows) { $ids += [string]$row.Cells["ID"].Value }
        Save-QRForIds -Ids $ids
        $lblStatus.Text = "Generated QR PNGs for selected assets"
    })
    
    # Audit Log (Super User Only)
    $btnAuditLog.Add_Click({
        if ($CurrentUser.role -ne "superuser") {
            [System.Windows.Forms.MessageBox]::Show("Only super users can view audit logs.", "Access Denied", "OK", "Warning")
            return
        }
        
        $logForm = New-Object System.Windows.Forms.Form
        $logForm.Text = "Audit Log - Change History"
        $logForm.Size = New-Object System.Drawing.Size(1000, 600)
        $logForm.StartPosition = "CenterScreen"
        
        $dgvLog = New-Object System.Windows.Forms.DataGridView
        $dgvLog.Location = New-Object System.Drawing.Point(20, 20)
        $dgvLog.Size = New-Object System.Drawing.Size(960, 520)
        $dgvLog.AutoSizeColumnsMode = "Fill"
        $dgvLog.ReadOnly = $true
        $dgvLog.AllowUserToAddRows = $false
        
        $logs = @()
        if (Test-Path $auditLogFile) {
            try {
                $logs = Get-Content $auditLogFile -Raw | ConvertFrom-Json
                if ($logs -isnot [array]) { $logs = @($logs) }
            }
            catch { $logs = @() }
        }
        
        if ($logs.Count -gt 0) {
            $logTable = New-Object System.Data.DataTable
            $logTable.Columns.Add("Timestamp") | Out-Null
            $logTable.Columns.Add("User") | Out-Null
            $logTable.Columns.Add("Action") | Out-Null
            $logTable.Columns.Add("Asset ID") | Out-Null
            $logTable.Columns.Add("Details") | Out-Null
            
            foreach ($log in $logs | Sort-Object -Property Timestamp -Descending) {
                $row = $logTable.NewRow()
                $row["Timestamp"] = $log.Timestamp
                $row["User"] = $log.User
                $row["Action"] = $log.Action
                $row["Asset ID"] = $log.AssetId
                $row["Details"] = $log.Details
                $logTable.Rows.Add($row) | Out-Null
            }
            
            $dgvLog.DataSource = $logTable
        }
        
        $logForm.Controls.Add($dgvLog)
        $btnExportLogJson = New-Object System.Windows.Forms.Button
        $btnExportLogJson.Location = New-Object System.Drawing.Point(20, 550)
        $btnExportLogJson.Size = New-Object System.Drawing.Size(120, 30)
        $btnExportLogJson.Text = "Export JSON"
        $logForm.Controls.Add($btnExportLogJson)
        $btnExportLogExcel = New-Object System.Windows.Forms.Button
        $btnExportLogExcel.Location = New-Object System.Drawing.Point(150, 550)
        $btnExportLogExcel.Size = New-Object System.Drawing.Size(120, 30)
        $btnExportLogExcel.Text = "Export Excel"
        $logForm.Controls.Add($btnExportLogExcel)
        $btnExportLogJson.Add_Click({
            $ds = $dgvLog.DataSource
            if ($ds -is [System.Data.DataTable]) {
                $objs = Convert-DataTableToObjects -dt $ds
                $dlg = New-Object System.Windows.Forms.SaveFileDialog
                $dlg.Filter = "JSON files (*.json)|*.json"
                $dlg.FileName = "audit_export.json"
                if ($dlg.ShowDialog() -eq "OK") { Export-ObjectsToJson -Objects $objs -Path $dlg.FileName }
            }
        })
        $btnExportLogExcel.Add_Click({
            $ds = $dgvLog.DataSource
            if ($ds -is [System.Data.DataTable]) {
                $objs = Convert-DataTableToObjects -dt $ds
                $dlg = New-Object System.Windows.Forms.SaveFileDialog
                $dlg.Filter = "Excel Workbook (*.xlsx)|*.xlsx"
                $dlg.FileName = "audit_export.xlsx"
                if ($dlg.ShowDialog() -eq "OK") {
                    try { Export-ObjectsToExcel -Objects $objs -Path $dlg.FileName }
                    catch {
                        $dlgCsv = New-Object System.Windows.Forms.SaveFileDialog
                        $dlgCsv.Filter = "CSV files (*.csv)|*.csv"
                        $dlgCsv.FileName = "audit_export.csv"
                        if ($dlgCsv.ShowDialog() -eq "OK") { $objs | Export-Csv -Path $dlgCsv.FileName -NoTypeInformation -Force }
                    }
                }
            }
        })
        $logForm.ShowDialog()
    })
    
    # Logout
    $btnLogout.Add_Click({
        $form.Close()
    })
    
    $form.ShowDialog()
}

# Main execution
$users = Load-Users

while ($true) {
    $loginInfo = Show-LoginForm
    if ($null -eq $loginInfo) {
        break
    }
    
    $user = Authenticate-User -Username $loginInfo.Username -Password $loginInfo.Password -Users $users
    if ($null -eq $user) {
        [System.Windows.Forms.MessageBox]::Show("Invalid username or password.", "Login Failed", "OK", "Error")
        continue
    }
    
    Write-AuditLog -Action "LOGIN" -User $user.username -AssetId "" -Details "User logged in"
    Show-AssetManager -CurrentUser $user
    Write-AuditLog -Action "LOGOUT" -User $user.username -AssetId "" -Details "User logged out"
}

