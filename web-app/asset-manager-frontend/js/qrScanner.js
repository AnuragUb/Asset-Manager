
import { showView } from './utils.js';

let html5QrCode;
let currentCameraId;
let isScanning = false;
let scannedAssetId = null;
let scannedType = 'asset'; // Default type

export async function initQrScannerView() {
    console.log('Initializing QR Scanner View');
    showView('qr-scanner-view');
    
    // Check if library is loaded
    if (!window.Html5Qrcode) {
        document.getElementById('qr-reader').innerHTML = '<div style="padding: 20px; color: red;">Error: QR Code library not loaded. Please refresh the page.</div>';
        return;
    }

    // Initialize camera selection if not already done
    const cameraSelect = document.getElementById('cameraSelection');
    if (cameraSelect.options.length <= 1) {
        await populateCameraList();
    }

    // Event listeners
    document.getElementById('btnStartQrScan').onclick = startScanning;
    document.getElementById('btnStopQrScan').onclick = stopScanning;
    document.getElementById('btnScanAgain').onclick = resetScanner;
    document.getElementById('btnOpenScannedAsset').onclick = openScannedAsset;
    
    cameraSelect.onchange = async (e) => {
        currentCameraId = e.target.value;
        if (isScanning) {
            await stopScanning();
            if (currentCameraId) {
                await startScanning();
            }
        }
    };
    
    // Auto-start if cameras available and not scanning
    if (currentCameraId && !isScanning) {
        // Optional: auto-start
        // await startScanning();
    }
}

async function populateCameraList() {
    const select = document.getElementById('cameraSelection');
    select.innerHTML = '<option value="">Select Camera</option>';
    
    try {
        // This method triggers permission request
        const cameras = await Html5Qrcode.getCameras();
        if (cameras && cameras.length) {
            cameras.forEach(camera => {
                const option = document.createElement('option');
                option.value = camera.id;
                option.text = camera.label || `Camera ${select.options.length}`;
                select.appendChild(option);
            });
            
            // Prefer back camera (environment facing) if multiple cameras
            let backCamera = cameras.find(c => c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('environment'));
            if (!backCamera) backCamera = cameras[cameras.length - 1];
            
            currentCameraId = backCamera.id;
            select.value = currentCameraId;
        } else {
            select.innerHTML = '<option value="">No cameras found</option>';
        }
    } catch (err) {
        console.error('Error getting cameras', err);
        select.innerHTML = '<option value="">Error accessing camera (Permission denied?)</option>';
    }
}

async function startScanning() {
    const readerElement = document.getElementById('qr-reader');
    const resultElement = document.getElementById('qr-reader-results');
    const btnStart = document.getElementById('btnStartQrScan');
    const btnStop = document.getElementById('btnStopQrScan');
    const select = document.getElementById('cameraSelection');
    
    if (!currentCameraId) {
        await populateCameraList();
        if (!currentCameraId) {
            alert('Please select a camera first');
            return;
        }
    }

    // UI Updates
    resultElement.style.display = 'none';
    readerElement.style.display = 'block';
    
    if (html5QrCode) {
        try {
            await html5QrCode.clear();
        } catch (e) {
            console.warn('Error clearing previous instance', e);
        }
    }

    html5QrCode = new Html5Qrcode("qr-reader");
    
    try {
        console.log('Starting scanner with camera ID:', currentCameraId);
        await html5QrCode.start(
            currentCameraId, 
            {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0
            },
            (decodedText, decodedResult) => {
                handleScanSuccess(decodedText);
            },
            (errorMessage) => {
                // Ignore frame errors
            }
        );
        
        isScanning = true;
        btnStart.style.display = 'none';
        btnStop.style.display = 'inline-block';
        select.disabled = true;
        
    } catch (err) {
        console.error('Error starting scanner', err);
        alert('Failed to start camera: ' + err);
        isScanning = false;
    }
}

async function stopScanning() {
    if (html5QrCode && isScanning) {
        try {
            await html5QrCode.stop();
            isScanning = false;
        } catch (err) {
            console.error('Error stopping scanner', err);
        }
    }
    
    document.getElementById('btnStartQrScan').style.display = 'inline-block';
    document.getElementById('btnStopQrScan').style.display = 'none';
    document.getElementById('cameraSelection').disabled = false;
}

function handleScanSuccess(decodedText) {
    console.log(`Scan result: ${decodedText}`);
    stopScanning();
    
    const resultElement = document.getElementById('qr-reader-results');
    const contentElement = document.getElementById('scanned-result-content');
    
    document.getElementById('qr-reader').style.display = 'none';
    resultElement.style.display = 'block';
    contentElement.textContent = decodedText;
    
    // Parse Asset ID logic
    scannedAssetId = parseAssetId(decodedText);
    
    console.log('Extracted ID:', scannedAssetId, 'Type:', scannedType);
    
    if (scannedAssetId) {
        // Auto-open logic can be added here
    } else {
        alert('Could not detect a valid ID from the QR code.');
    }
}

function parseAssetId(text) {
    if (!text) return null;
    
    let assetId = text;
    scannedType = 'asset'; // Reset default
    
    try {
        // 1. URL format: .../asset/ASSET-ID or ...#asset-details?id=ASSET-ID
        if (text.startsWith('http')) {
            const url = new URL(text);
            
            // Check for hash based routing (e.g. #asset-details?id=...)
            if (url.hash && url.hash.includes('id=')) {
                const params = new URLSearchParams(url.hash.split('?')[1]);
                assetId = params.get('id');
                
                if (url.hash.includes('project')) {
                    scannedType = 'project';
                }
            } else {
                // Fallback to path based (old format)
                const pathParts = url.pathname.split('/');
                const segments = pathParts.filter(p => p.length > 0);
                
                if (segments.length > 0) {
                    assetId = segments[segments.length - 1];
                }
            }
            
            // Check for project URL pattern if needed
            if (text.includes('project')) {
                scannedType = 'project';
            }
        } 
        // 2. JSON format
        else if (text.trim().startsWith('{')) {
            const json = JSON.parse(text);
            if (json.type) scannedType = json.type.toLowerCase();
            return json.id || json.ID || json.AssetID || json.assetId;
        }
    } catch (e) {
        console.warn('Error parsing QR text, using raw value', e);
    }
    
    // Clean up query params if present in ID (e.g. ID?t=123)
    if (assetId && assetId.includes('?')) {
        assetId = assetId.split('?')[0];
    }
    
    return assetId;
}

function openScannedAsset() {
    if (!scannedAssetId) {
        alert('No valid ID scanned.');
        return;
    }
    
    if (scannedType === 'project') {
        if (window.showProjectDetails) {
            console.log('Opening project details for:', scannedAssetId);
            window.showProjectDetails(scannedAssetId);
        } else {
            alert('Project module not loaded.');
        }
    } else {
        if (window.editAsset) {
            console.log('Opening asset details for:', scannedAssetId);
            window.editAsset(scannedAssetId);
        } else {
            alert('Asset Manager not fully loaded. Please wait and try again.');
        }
    }
}

function resetScanner() {
    document.getElementById('qr-reader-results').style.display = 'none';
    startScanning();
}
