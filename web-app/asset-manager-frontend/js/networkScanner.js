/**
 * Network Scanner Module
 * Handles IP discovery, subnet detection, and linking assets to network devices.
 */
import { TABULATOR_BASE_CONFIG, robustRedraw, registerTabulator } from './utils.js?v=3.4';

let scannerTabulator = null;

export async function initScannerView() {
    console.log('initScannerView() called from module');
    const btnStartScan = document.getElementById('btnStartScan');
    const btnScanEntireNetwork = document.getElementById('btnScanEntireNetwork');
    const scannerTarget = document.getElementById('scannerTarget');
    const scannerPorts = document.getElementById('scannerPorts');
    const scannerInterfaceInfo = document.getElementById('scannerInterfaceInfo');

    let detectedSubnet = '';

    // Load network info to suggest a range
    try {
        const infoRes = await fetch('/api/network-info');
        if (!infoRes.ok) throw new Error(`Server returned ${infoRes.status}`);
        
        const data = await infoRes.json();
        const interfaces = data.interfaces || [];
        
        console.log('Detected interfaces:', interfaces);
        
        if (interfaces.length > 0) {
            scannerInterfaceInfo.innerHTML = interfaces.map(iface => 
                `<span style="margin-right: 15px; cursor: pointer; text-decoration: underline; ${iface.isClientSubnet ? 'font-weight: bold; color: #28a745;' : ''}" 
                    title="Click to set target" 
                    onclick="document.getElementById('scannerTarget').value='${iface.subnet}'">
                    ${iface.name}: ${iface.address} ${iface.isClientSubnet ? '(Your Network)' : ''}
                </span>`
            ).join('');

            // Pick the most likely subnet
            const primary = interfaces.find(i => i.isClientSubnet) || interfaces[0];
            if (primary && primary.subnet) {
                detectedSubnet = primary.subnet;
                
                if (scannerTarget && !scannerTarget.value) {
                    scannerTarget.value = detectedSubnet;
                }
            }
        } else {
            scannerInterfaceInfo.innerHTML = '<span style="color: #666; font-style: italic;">No active network interfaces detected.</span>';
        }
    } catch (err) {
        console.error('Failed to load network info:', err);
        scannerInterfaceInfo.innerHTML = `<span style="color: #dc3545; font-style: italic;">Network detection failed: ${err.message}</span>`;
    }

    const runScan = async (targetRange) => {
        const ports = scannerPorts.value;
        const target = targetRange || scannerTarget.value;

        if (!target) return alert('Please enter or detect a target IP range');

        try {
            const activeBtn = targetRange ? btnScanEntireNetwork : btnStartScan;
            
            activeBtn.textContent = 'Scanning...';
            activeBtn.disabled = true;
            if (!targetRange) btnScanEntireNetwork.disabled = true;
            else btnStartScan.disabled = true;

            const response = await fetch(`/api/scan?target=${encodeURIComponent(target)}&ports=${encodeURIComponent(ports)}`);
            if (!response.ok) throw new Error(await response.text());
            
            const results = await response.json();
            
            // Validate results before rendering
            if (!Array.isArray(results)) {
                throw new Error('Invalid response format from server');
            }
            
            renderScannerResults(results);
        } catch (err) {
            console.error('Network scan failed:', err);
            // Check if this is a Tabulator internal error (which we can ignore if results are shown)
            if (err.message && !err.message.includes('offsetWidth')) {
                alert('Scan failed: ' + err.message);
            }
        } finally {
            btnStartScan.textContent = 'Start Scan';
            btnScanEntireNetwork.textContent = 'Scan Entire Network';
            btnStartScan.disabled = false;
            btnScanEntireNetwork.disabled = false;
        }
    };

    if (btnStartScan) {
        btnStartScan.onclick = () => runScan();
    }

    if (btnScanEntireNetwork) {
        btnScanEntireNetwork.onclick = () => {
            if (!detectedSubnet) {
                return alert('Could not automatically detect your network. Please enter a range manually.');
            }
            if (scannerTarget) scannerTarget.value = detectedSubnet;
            runScan(detectedSubnet);
        };
    }
}

export function renderScannerResults(results) {
    console.log('Rendering scanner results:', results);
    
    if (!scannerTabulator) {
        scannerTabulator = new Tabulator("#scanner-grid", {
            ...TABULATOR_BASE_CONFIG,
            data: results,
            placeholder: "No devices found",
            columns: [
                {title: "IP Address", field: "ip", sorter: "string", width: 120, headerFilter: "input", headerFilterFunc: (headerValue, rowValue) => {
                    // If user types a full IP, do exact match. Otherwise, do startsWith match.
                    const val = String(rowValue);
                    const search = String(headerValue);
                    
                    // Regex for full IPv4
                    const isFullIp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(search);
                    
                    if (isFullIp) {
                        return val === search;
                    }
                    return val.startsWith(search);
                }},
                {title: "Hostname", field: "name", sorter: "string", width: 150},
                {title: "MAC Address", field: "mac", sorter: "string", width: 150},
                {title: "Manufacturer", field: "manufacturer", sorter: "string", width: 150, formatter: (cell) => {
                    const val = cell.getValue();
                    return val && val !== 'Unknown' ? val : '<span style="color:#999; font-style:italic;">Unknown</span>';
                }},
                {title: "Open Ports", field: "ports", formatter: (cell) => {
                    const ports = cell.getValue();
                    return ports && ports.length > 0 ? ports.join(', ') : '<span style="color:#999; font-style:italic;">None detected</span>';
                }},
                {title: "Status", field: "status", width: 100, formatter: (cell) => `<span style="color: green;">● Online</span>`},
                {title: "Action", width: 130, hozAlign: "center", formatter: () => `<button class="login-button" style="padding: 2px 10px; font-size: 11px;">Link to Asset</button>`, cellClick: (e, cell) => {
                    const data = cell.getData();
                    openLinkToAssetModal(data.ip, data.mac);
                }}
            ]
        });
        
        registerTabulator(scannerTabulator);
        
        // Ensure redraw on next tick to handle any flexbox initialization lag
        robustRedraw(scannerTabulator);
    } else {
        scannerTabulator.setData(results).then(() => {
            robustRedraw(scannerTabulator);
        });
    }
}

export function openLinkToAssetModal(ip, mac) {
    const modal = document.getElementById('linkAssetModal');
    const subtitle = document.getElementById('linkModalSubtitle');
    const select = document.getElementById('linkAssetSelect');
    const btnConfirm = document.getElementById('btnConfirmLinkAsset');

    subtitle.textContent = `Device: ${ip} ${mac !== 'Unknown' ? '(' + mac + ')' : ''}`;
    modal.style.display = 'flex';

    // Populate dropdown
    select.innerHTML = '<option value="">-- Select Asset --</option>';
    fetch('/api/assets')
        .then(res => res.json())
        .then(assets => {
            assets.sort((a, b) => (a.AssetName || '').localeCompare(b.AssetName || ''));
            assets.forEach(asset => {
                const opt = document.createElement('option');
                opt.value = asset.ID;
                opt.textContent = `${asset.AssetName || 'Unnamed'} (ID: ${asset.ID}${asset.AssetKindName ? ' - ' + asset.AssetKindName : ''})`;
                select.appendChild(opt);
            });
        })
        .catch(err => {
            console.error('Failed to load assets:', err);
            select.innerHTML = '<option value="">Error loading assets</option>';
        });

    btnConfirm.onclick = () => {
        const assetId = select.value;
        if (!assetId) return alert('Please select an asset');
        
        linkIpToAsset(ip, mac, assetId);
        modal.style.display = 'none';
    };
}

export async function linkIpToAsset(ip, mac, assetId) {
    try {
        const payload = { IPAddress: ip };
        if (mac && mac !== 'Unknown') {
            payload.MACAddress = mac;
        }

        const response = await fetch(`/api/assets/${assetId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (response.ok) {
            alert(`Asset ${assetId} updated with IP ${ip} ${mac ? 'and MAC ' + mac : ''}`);
            if (window.loadAssets) window.loadAssets();
        } else {
            const err = await response.text();
            alert('Failed to link: ' + err);
        }
    } catch (err) {
        alert('Error linking: ' + err.message);
    }
}
