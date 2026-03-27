/**
 * itAssets.js
 * Specialized view for IT-specific asset details (MAC, IP, Ports)
 * Version: 4.0
 */

import { showView } from './utils.js?v=3.8';

export function renderItAssets() {
    console.log('Rendering IT Assets View...');
    const container = document.getElementById('itAssetsView');
    if (!container) return;

    showView('itAssetsView');
    
    // Set active nav if it exists
    document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
    document.getElementById('nav-it-assets')?.classList.add('active');

    loadItAssets();
}

async function loadItAssets() {
    const body = document.getElementById('tblBodyItAssets');
    if (!body) return;

    try {
        const response = await fetch('/api/assets?category=IT');
        if (response.ok) {
            const assets = await response.json();
            renderItAssetsTable(assets);
        } else {
            body.innerHTML = '<tr><td colspan="5">Failed to load IT assets.</td></tr>';
        }
    } catch (err) {
        console.error('Error loading IT assets:', err);
        body.innerHTML = '<tr><td colspan="5">Error connecting to server.</td></tr>';
    }
}

function renderItAssetsTable(assets) {
    const body = document.getElementById('tblBodyItAssets');
    if (!body) return;

    if (!assets || assets.length === 0) {
        body.innerHTML = '<tr><td colspan="5">No IT assets found.</td></tr>';
        return;
    }

    let html = '';
    assets.forEach(asset => {
        html += `
            <tr onclick="showAssetDetails('${asset.ID}')" style="cursor: pointer;">
                <td>${asset.ID || '-'}</td>
                <td>
                    <div style="font-weight: 600;">${asset.ItemName || '-'}</div>
                    <button onclick="event.stopPropagation(); window.showQuantityHistoryModal('${asset.ID}')" style="color: #0056b3; font-weight: 700; text-decoration: none; background: #e7f3ff; padding: 2px 5px; border-radius: 4px; border: 1px solid #b3d7ff; font-size: 9px; display: inline-flex; align-items: center; gap: 3px; margin-top: 3px; cursor: pointer;" title="View Quantity Events">📅 History</button>
                </td>
                <td>${asset.IPAddress || '-'}</td>
                <td>${asset.MACAddress || '-'}</td>
                <td>${asset.AssignedTo || 'Unassigned'}</td>
            </tr>
        `;
    });
    body.innerHTML = html;
}
