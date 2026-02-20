/**
 * admin.js
 * Handles administrative views and operations
 * Version: 4.1
 */

import { showView } from './utils.js?v=3.8';

let allUsers = [];

export function renderAdmin() {
    console.log('Rendering Admin View...');
    const container = document.getElementById('admin-view');
    if (!container) return;

    // Force inject the HTML structure
    container.innerHTML = `
        <div class="view-toolbar" style="margin-bottom: 20px;">
            <h2 class="view-title">Administration</h2>
        </div>

        <div class="admin-tabs" style="display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 1px solid #ddd; padding-bottom: 10px;">
            <button class="tab-btn active" onclick="switchAdminTab('users')" id="tab-users">User Management</button>
            <button class="tab-btn" onclick="switchAdminTab('logs')" id="tab-logs">Audit Logs</button>
        </div>

        <div id="admin-content-users" class="admin-tab-content">
            <div class="card-panel">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h3>System Users</h3>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <input type="text" id="userSearch" placeholder="Search users..." oninput="filterUsers()" style="padding: 8px 12px; border-radius: 20px; border: 1px solid #ddd; min-width: 200px;">
                        <button class="action-button blue" onclick="openAddUserModal()">+ Add User</button>
                    </div>
                </div>
                <div id="user-list-container">
                    <p>Loading users...</p>
                </div>
            </div>
        </div>

        <div id="admin-content-logs" class="admin-tab-content" style="display: none;">
            <div class="view-actions" style="display: flex; gap: 10px; margin-bottom: 15px; justify-content: flex-end;">
                <button class="action-button blue" onclick="downloadLogs('json')">📥 Export JSON</button>
                <button class="action-button green" onclick="downloadLogs('excel')">📊 Export Excel</button>
            </div>
            <div class="card-panel">
                <h3>Audit Logs</h3>
                <div id="audit-log-container">
                    <p>Loading logs...</p>
                </div>
            </div>
        </div>

        <!-- Add User Modal -->
        <div id="addUserModal" class="modal" style="display: none;">
            <div class="modal-content" style="max-width: 500px;">
                <span class="close-modal" onclick="closeAddUserModal()">&times;</span>
                <h3>Add New User</h3>
                <form id="addUserForm" onsubmit="handleCreateUser(event)">
                    <div class="form-group">
                        <label>Username *</label>
                        <input type="text" name="username" required class="form-control">
                    </div>
                    <div class="form-group">
                        <label>Full Name</label>
                        <input type="text" name="fullname" class="form-control">
                    </div>
                    <div class="form-group">
                        <label>Employee ID (Optional)</label>
                        <input type="text" name="employeeId" class="form-control" placeholder="e.g. EMP-001">
                    </div>
                    <div class="form-group">
                        <label>Password *</label>
                        <input type="password" name="password" required class="form-control">
                    </div>
                    <div class="form-group">
                        <label>Role</label>
                        <select name="role" class="form-control">
                            <option value="user">User</option>
                            <option value="manager">Manager</option>
                            <option value="admin">Admin</option>
                            <option value="superuser">Superuser</option>
                            <option value="it_user">IT User</option>
                            <option value="it_manager">IT Manager</option>
                        </select>
                    </div>
                    <div class="modal-actions" style="margin-top: 20px; text-align: right;">
                        <button type="button" class="cancel-button" onclick="closeAddUserModal()">Cancel</button>
                        <button type="submit" class="action-button blue">Create User</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    // Initialize Global Functions for HTML event handlers
    window.switchAdminTab = switchAdminTab;
    window.openAddUserModal = openAddUserModal;
    window.closeAddUserModal = closeAddUserModal;
    window.handleCreateUser = handleCreateUser;
    window.deleteUser = deleteUser;
    window.downloadLogs = downloadLogs;
    window.updateUserRole = updateUserRole;
    window.filterUsers = filterUsers;

    // Load initial data
    loadUsers();
    loadAuditLogs();
}

function filterUsers() {
    const query = (document.getElementById('userSearch').value || '').toLowerCase();
    const filtered = allUsers.filter(u => 
        (u.username && u.username.toLowerCase().includes(query)) ||
        (u.fullname && u.fullname.toLowerCase().includes(query)) ||
        (u.role && u.role.toLowerCase().includes(query)) ||
        (u.employee_id && u.employee_id.toLowerCase().includes(query))
    );
    renderDrunkUserList(filtered);
}

function switchAdminTab(tabName) {
    // Hide all content
    document.querySelectorAll('.admin-tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

    // Show selected
    const content = document.getElementById(`admin-content-${tabName}`);
    const btn = document.getElementById(`tab-${tabName}`);
    
    if (content) content.style.display = 'block';
    if (btn) btn.classList.add('active');
}

async function downloadLogs(format) {
    try {
        const response = await fetch('/api/audit-logs');
        if (!response.ok) throw new Error('Failed to fetch logs');
        const logs = await response.json();

        if (format === 'json') {
            const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `audit_logs_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } else if (format === 'excel') {
            if (typeof XLSX === 'undefined') {
                alert('Excel library not loaded');
                return;
            }
            const ws = XLSX.utils.json_to_sheet(logs);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Audit Logs");
            XLSX.writeFile(wb, `audit_logs_${new Date().toISOString().split('T')[0]}.xlsx`);
        }
    } catch (err) {
        console.error('Error downloading logs:', err);
        alert('Failed to download logs');
    }
}

async function loadUsers() {
    const container = document.getElementById('user-list-container');
    if (!container) return;

    try {
        const response = await fetch('/api/tenant/users');
        if (response.ok) {
            const data = await response.json();
            allUsers = data.users || [];
            renderDrunkUserList(allUsers);
        } else {
            container.innerHTML = '<p class="error">Failed to load users.</p>';
        }
    } catch (err) {
        console.error('Error loading users:', err);
        container.innerHTML = '<p class="error">Error connecting to server.</p>';
    }
}

function renderDrunkUserList(users) {
    const container = document.getElementById('user-list-container');
    if (!container) return;

    if (!users || users.length === 0) {
        container.innerHTML = '<p>No users found.</p>';
        return;
    }

    // Drunk Style CSS Injection (if not already present)
    if (!document.getElementById('drunk-style-css')) {
        const style = document.createElement('style');
        style.id = 'drunk-style-css';
        style.textContent = `
            .drunk-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                gap: 20px;
                padding: 10px;
            }
            .drunk-card {
                background: rgba(255, 255, 255, 0.7);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.5);
                border-radius: 16px;
                padding: 20px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.1);
                transition: transform 0.2s, box-shadow 0.2s;
                position: relative;
                overflow: hidden;
            }
            .drunk-card:hover {
                transform: translateY(-5px);
                box-shadow: 0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05);
                background: rgba(255, 255, 255, 0.85);
            }
            .drunk-card::before {
                content: '';
                position: absolute;
                top: -50px;
                right: -50px;
                width: 100px;
                height: 100px;
                background: linear-gradient(135deg, rgba(66, 133, 244, 0.2), rgba(219, 68, 55, 0.2));
                border-radius: 50%;
                filter: blur(20px);
                z-index: 0;
            }
            .drunk-content {
                position: relative;
                z-index: 1;
            }
            .drunk-avatar {
                width: 50px;
                height: 50px;
                background: linear-gradient(135deg, #000000, #ff0000);
                color: white;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 20px;
                font-weight: bold;
                margin-bottom: 15px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            }
            .drunk-info h4 {
                margin: 0 0 5px 0;
                font-size: 18px;
                color: #333;
            }
            .drunk-info p {
                margin: 0 0 15px 0;
                color: #666;
                font-size: 13px;
            }
            .drunk-actions {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-top: 15px;
                border-top: 1px solid rgba(0,0,0,0.05);
                padding-top: 15px;
            }
            .role-select {
                padding: 6px 12px;
                border-radius: 20px;
                border: 1px solid #ddd;
                background: white;
                font-size: 12px;
                cursor: pointer;
                outline: none;
                transition: border-color 0.2s;
            }
            .role-select:focus {
                border-color: #4285f4;
            }
            .btn-drunk-delete {
                background: rgba(220, 53, 69, 0.1);
                color: #dc3545;
                border: none;
                padding: 6px 12px;
                border-radius: 20px;
                font-size: 12px;
                cursor: pointer;
                font-weight: 600;
                transition: background 0.2s;
            }
            .btn-drunk-delete:hover {
                background: rgba(220, 53, 69, 0.2);
            }
        `;
        document.head.appendChild(style);
    }

    let html = '<div class="drunk-grid">';
    
    // Limit to 25 users
    const limitedUsers = users.slice(0, 25);
    
    limitedUsers.forEach(user => {
        const initial = (user.fullname || user.username || '?').charAt(0).toUpperCase();
        html += `
            <div class="drunk-card">
                <div class="drunk-content">
                    <div class="drunk-avatar">${initial}</div>
                    <div class="drunk-info">
                        <h4>${user.fullname || user.username}</h4>
                        <p>@${user.username}</p>
                        ${user.employee_id ? `<p style="font-weight: 500; color: #4285f4; margin-top: -10px;">ID: ${user.employee_id}</p>` : ''}
                    </div>
                    <div class="drunk-actions">
                        <select class="role-select" onchange="updateUserRole('${user.username}', this.value)">
                            <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
                            <option value="manager" ${user.role === 'manager' ? 'selected' : ''}>Manager</option>
                            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                            <option value="superuser" ${user.role === 'superuser' ? 'selected' : ''}>Superuser</option>
                            <option value="it_user" ${user.role === 'it_user' ? 'selected' : ''}>IT User</option>
                            <option value="it_manager" ${user.role === 'it_manager' ? 'selected' : ''}>IT Manager</option>
                        </select>
                        <button class="btn-drunk-delete" onclick="deleteUser('${user.username}')">Delete</button>
                    </div>
                </div>
            </div>
        `;
    });

    if (users.length > 25) {
        html += `<p style="grid-column: 1 / -1; text-align: center; color: #888; margin-top: 20px;">Showing 25 of ${users.length} users. Use search to find specific users.</p>`;
    }

    html += '</div>';
    container.innerHTML = html;
}

async function updateUserRole(username, newRole) {
    try {
        const response = await fetch(`/api/tenant/users/${username}/role`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: newRole })
        });

        if (response.ok) {
            // Optional: Show a subtle toast or success indicator
            // For now, we assume it worked. If we want to be robust:
            console.log(`Role for ${username} updated to ${newRole}`);
        } else {
            const err = await response.json();
            alert('Error updating role: ' + (err.message || 'Unknown error'));
            // Revert selection (reload users)
            loadUsers();
        }
    } catch (err) {
        console.error('Error updating role:', err);
        alert('Failed to update role');
        loadUsers();
    }
}

function openAddUserModal() {
    document.getElementById('addUserModal').style.display = 'flex';
}

function closeAddUserModal() {
    document.getElementById('addUserModal').style.display = 'none';
}

async function handleCreateUser(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    try {
        const response = await fetch('/api/tenant/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            closeAddUserModal();
            form.reset();
            loadUsers();
            alert('User created successfully!');
        } else {
            const err = await response.json();
            alert('Error: ' + (err.message || 'Failed to create user'));
        }
    } catch (err) {
        console.error('Error creating user:', err);
        alert('Failed to create user');
    }
}

async function deleteUser(username) {
    if (!confirm(`Are you sure you want to delete user "${username}"?`)) return;

    try {
        const response = await fetch(`/api/tenant/users/${username}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            loadUsers();
        } else {
            const err = await response.json();
            alert('Error: ' + (err.message || 'Failed to delete user'));
        }
    } catch (err) {
        console.error('Error deleting user:', err);
        alert('Failed to delete user');
    }
}

// --- Audit Log Logic (Existing) ---

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
        <div class="admin-table-wrapper" style="overflow-x: auto;">
            <table class="admin-table" style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                <thead>
                    <tr style="background: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                        <th style="padding: 12px; text-align: left;">Timestamp</th>
                        <th style="padding: 12px; text-align: left;">User</th>
                        <th style="padding: 12px; text-align: left;">Action</th>
                        <th style="padding: 12px; text-align: left;">Asset ID</th>
                        <th style="padding: 12px; text-align: left;">Details</th>
                    </tr>
                </thead>
                <tbody>
    `;

    const sortedLogs = logs; 

    sortedLogs.forEach(log => {
        const date = new Date(log.Timestamp);
        const formattedDate = date.toLocaleString();

        html += `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 10px;">${formattedDate}</td>
                <td style="padding: 10px;"><span class="user-badge" style="background: #e7f3ff; color: #0056b3; padding: 2px 6px; border-radius: 4px; font-size: 12px;">${log.User || 'System'}</span></td>
                <td style="padding: 10px;"><span class="action-badge" style="font-weight: 600;">${log.Action}</span></td>
                <td style="padding: 10px;">${log.AssetId || '-'}</td>
                <td style="padding: 10px; color: #555;">${log.Details}</td>
            </tr>
        `;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
}
