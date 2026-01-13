/**
 * admin.js
 * Handles administrative views and operations
 * Version: 4.0
 */

import { showView } from './utils.js?v=3.8';

export function renderAdmin() {
    console.log('Rendering Admin View...');
    const adminContainer = document.getElementById('adminView');
    if (!adminContainer) return;

    // Show the view
    showView('adminView');
    
    // Set active nav
    document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
    document.getElementById('nav-admin')?.classList.add('active');

    // Initialize admin components (Audit Log, User Management, etc.)
    loadAuditLogs();
}

async function loadAuditLogs() {
    const logContainer = document.getElementById('audit-log-container');
    if (!logContainer) return;

    try {
        const response = await fetch('/api/audit-logs');
        if (response.ok) {
            const logs = await response.json();
            renderLogsTable(logs);
        } else {
            logContainer.innerHTML = '<p class="error">Failed to load audit logs.</p>';
        }
    } catch (err) {
        console.error('Error loading audit logs:', err);
        logContainer.innerHTML = '<p class="error">Error connecting to server.</p>';
    }
}

function renderLogsTable(logs) {
    const container = document.getElementById('audit-log-container');
    if (!container) return;

    if (!logs || logs.length === 0) {
        container.innerHTML = '<p>No audit logs found.</p>';
        return;
    }

    let html = `
        <div class="admin-table-wrapper">
            <table class="admin-table">
                <thead>
                    <tr>
                        <th>Timestamp</th>
                        <th>User</th>
                        <th>Action</th>
                        <th>Asset ID</th>
                        <th>Details</th>
                    </tr>
                </thead>
                <tbody>
    `;

    // Sort logs by timestamp descending
    const sortedLogs = [...logs].sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));

    sortedLogs.forEach(log => {
        html += `
            <tr>
                <td>${log.Timestamp}</td>
                <td><span class="user-badge">${log.User}</span></td>
                <td><span class="action-badge ${log.Action.toLowerCase()}">${log.Action}</span></td>
                <td>${log.AssetId || '-'}</td>
                <td>${log.Details}</td>
            </tr>
        `;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
}
