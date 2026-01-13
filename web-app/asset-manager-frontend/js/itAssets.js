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
            body.innerHTML = '<tr><td colspan="3">Failed to load IT assets.</td></tr>';
        }
    } catch (err) {
        console.error('Error loading IT assets:', err);
        body.innerHTML = '<tr><td colspan="3">Error connecting to server.</td></tr>';
    }
}

function renderItAssetsTable(assets) {
    const body = document.getElementById('tblBodyItAssets');
    if (!body) return;

    if (!assets || assets.length === 0) {
        body.innerHTML = '<tr><td colspan="3">No IT assets found.</td></tr>';
        return;
    }

    let html = '';
    assets.forEach(asset => {
        html += `
            <tr>
                <td>${asset.AssetTag || asset.ID || '-'}</td>
                <td>${asset.Model || '-'}</td>
                <td>${asset.AssignedTo || 'Unassigned'}</td>
            </tr>
        `;
    });
    body.innerHTML = html;
}
