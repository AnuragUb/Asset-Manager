/**
 * rbac.js
 * Handles Role-Based Access Control management for Superusers
 */

import { showView } from './utils.js?v=6.41';

let allPermissions = [];
let allRoles = [];
let selectedRole = null;

export async function renderRBAC() {
    console.log('Rendering RBAC View (Sub-Tab)...');
    
    try {
        // 1. Initialize listeners (if not already done)
        initRBACListeners();

        // 2. Load initial data
        await Promise.all([
            loadPermissions(),
            loadRoles(),
            loadUsers()
        ]);
    } catch (err) {
        console.error('Critical error in renderRBAC:', err);
    }
}

function initRBACListeners() {
    const rbacView = document.getElementById('admin-rbac-tab');
    if (!rbacView || rbacView.dataset.listenersBound) return;

    console.log('Binding RBAC listeners...');

    // Save Role
    document.getElementById('btnSaveRole')?.addEventListener('click', async () => {
        const nameInput = document.getElementById('rbac-role-name');
        if (!selectedRole && (!nameInput || !nameInput.value)) return;

        const name = nameInput.value;
        const description = document.getElementById('rbac-role-desc').value;
        const permissions = Array.from(document.querySelectorAll('#rbac-permissions-grid input[type="checkbox"]:checked'))
                                .map(cb => cb.value);

        try {
            const response = await fetch('/api/rbac/roles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, permissions })
            });

            if (response.ok) {
                alert('Role policy saved successfully');
                await loadRoles();
                window.selectRBACRole(name);
            } else {
                const err = await response.json();
                alert('Error: ' + err.error);
            }
        } catch (err) {
            console.error('Save error:', err);
            alert('Failed to save role');
        }
    });

    // Create New Role
    document.getElementById('btnCreateRole')?.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('Create Role clicked');
        const modal = document.getElementById('rbacRoleModal');
        if (modal) {
            modal.style.display = 'flex';
            modal.style.zIndex = '10001'; // Ensure it's above other things
            document.getElementById('newRoleName').value = '';
            document.getElementById('newRoleDesc').value = '';
        } else {
            console.error('rbacRoleModal not found in DOM');
        }
    });

    document.getElementById('btnSubmitNewRole')?.addEventListener('click', async () => {
        const name = document.getElementById('newRoleName').value.trim();
        const description = document.getElementById('newRoleDesc').value.trim();

        if (!name) return alert('Role name is required');

        try {
            const response = await fetch('/api/rbac/roles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, permissions: [] })
            });

            if (response.ok) {
                document.getElementById('rbacRoleModal').style.display = 'none';
                await loadRoles();
                window.selectRBACRole(name);
            } else {
                const err = await response.json();
                alert('Error: ' + err.error);
            }
        } catch (err) {
            console.error('Create error:', err);
            alert('Failed to create role');
        }
    });

    document.getElementById('btnCancelRoleEdit')?.addEventListener('click', () => {
        document.getElementById('rbac-editor-container').classList.add('hidden');
        document.getElementById('rbac-empty-state').classList.remove('hidden');
        selectedRole = null;
        renderRolesList();
    });

    rbacView.dataset.listenersBound = 'true';
}

async function loadPermissions() {
    try {
        const response = await fetch('/api/permissions');
        if (response.ok) {
            allPermissions = await response.json();
            renderPermissionsGrid();
        }
    } catch (err) {
        console.error('Error loading permissions:', err);
    }
}

async function loadRoles() {
    const listContainer = document.getElementById('rbac-roles-list');
    try {
        const response = await fetch('/api/rbac/roles');
        const data = await response.json();
        if (response.ok && data.success) {
            allRoles = data.roles;
            renderRolesList();
        } else {
            console.error('RBAC Role Load Failed:', data);
            listContainer.innerHTML = `<div style="padding: 20px; color: #ef4444;">Failed to load roles: ${data.error || 'Unknown Error'}</div>`;
        }
    } catch (err) {
        console.error('Error loading roles:', err);
        listContainer.innerHTML = '<div style="padding: 20px; color: #ef4444;">Error connecting to server</div>';
    }
}

async function loadUsers() {
    const tableContainer = document.getElementById('rbac-users-assignment-table');
    try {
        const response = await fetch('/api/users');
        if (response.ok) {
            const data = await response.json();
            // Server returns { ok: true, users: [...] }
            if (data && Array.isArray(data.users)) {
                renderUsersTable(data.users);
            } else if (Array.isArray(data)) {
                renderUsersTable(data);
            }
        }
    } catch (err) {
        console.error('Error loading users:', err);
    }
}

function renderRolesList() {
    const container = document.getElementById('rbac-roles-list');
    if (!container) return;

    if (allRoles.length === 0) {
        container.innerHTML = '<div style="padding: 20px; color: #94a3b8;">No roles found</div>';
        return;
    }

    let html = '';
    allRoles.forEach(role => {
        const name = role.Name || role.name;
        const description = role.Description || role.description || 'No description';
        const isActive = selectedRole && (selectedRole.Name || selectedRole.name) === name;
        
        html += `
            <div class="rbac-role-item ${isActive ? 'active' : ''}" onclick="window.selectRBACRole('${name}')" 
                 style="padding: 15px; border-bottom: 1px solid #f1f5f9; cursor: pointer; transition: background 0.2s; ${isActive ? 'background: #eff6ff; border-left: 4px solid #3b82f6;' : ''}">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <div style="font-weight: 600; color: #1e293b; font-size: 14px;">${name}</div>
                        <div style="font-size: 12px; color: #64748b; margin-top: 2px;">${description}</div>
                    </div>
                    <span style="font-size: 11px; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; color: #475569;">${role.permissions.length} perms</span>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

function renderPermissionsGrid() {
    const grid = document.getElementById('rbac-permissions-grid');
    if (!grid) return;

    // Group permissions by prefix (module.xxx)
    const groups = {};
    allPermissions.forEach(p => {
        const prefix = p.key.includes('.') ? p.key.split('.')[0] : 'general';
        if (!groups[prefix]) groups[prefix] = [];
        groups[prefix].push(p);
    });

    let html = '';
    Object.keys(groups).sort().forEach(group => {
        html += `<div style="grid-column: 1 / -1; margin-top: 15px; margin-bottom: 5px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; font-weight: 700;">${group}</div>`;
        groups[group].forEach(p => {
            html += `
                <label style="display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid #f1f5f9; border-radius: 8px; cursor: pointer; background: #fff; transition: all 0.2s;">
                    <input type="checkbox" name="permission" value="${p.key}" style="margin-top: 3px; width: 16px; height: 16px;">
                    <div>
                        <div style="font-size: 13px; font-weight: 500; color: #334155;">${p.key}</div>
                        <div style="font-size: 11px; color: #94a3b8; line-height: 1.3;">${p.description || ''}</div>
                    </div>
                </label>
            `;
        });
    });
    grid.innerHTML = html;
}

function renderUsersTable(users) {
    const container = document.getElementById('rbac-users-assignment-table');
    if (!container) return;

    let html = `
        <table class="admin-table" style="width: 100%;">
            <thead>
                <tr>
                    <th>Username</th>
                    <th>Full Name</th>
                    <th>Current Role</th>
                    <th style="width: 200px;">Assign New Role</th>
                </tr>
            </thead>
            <tbody>
    `;

    users.forEach(user => {
        html += `
            <tr>
                <td><strong>${user.username}</strong></td>
                <td>${user.Fullname || '-'}</td>
                <td><span class="user-badge" style="background: #f1f5f9; color: #475569;">${user.role}</span></td>
                <td>
                    <select onchange="window.updateUserRole('${user.username}', this.value)" 
                            style="width: 100%; padding: 6px; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 12px;">
                        ${allRoles.map(r => `<option value="${r.name}" ${user.role === r.name ? 'selected' : ''}>${r.name}</option>`).join('')}
                    </select>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

// Global functions for UI callbacks
window.selectRBACRole = function(roleName) {
    selectedRole = allRoles.find(r => (r.Name || r.name) === roleName);
    if (!selectedRole) return;

    const name = selectedRole.Name || selectedRole.name;
    const description = selectedRole.Description || selectedRole.description;

    // Show editor, hide empty state
    document.getElementById('rbac-editor-container').classList.remove('hidden');
    document.getElementById('rbac-empty-state').classList.add('hidden');

    // Update form
    document.getElementById('rbac-editor-title').innerText = `Edit Role: ${name}`;
    document.getElementById('rbac-role-name').value = name;
    document.getElementById('rbac-role-name').disabled = true; // Key cannot be changed
    document.getElementById('rbac-role-desc').value = description || '';

    // Check permissions
    const checkboxes = document.querySelectorAll('#rbac-permissions-grid input[type="checkbox"]');
    checkboxes.forEach(cb => {
        cb.checked = selectedRole.permissions.includes(cb.value);
    });

    renderRolesList(); // Update active state in list
};

window.updateUserRole = async function(username, newRole) {
    if (!confirm(`Are you sure you want to change role for '${username}' to '${newRole}'?`)) return;

    try {
        const response = await fetch('/api/users/update-role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, role: newRole })
        });

        if (response.ok) {
            alert('User role updated successfully');
            loadUsers();
        } else {
            const err = await response.json();
            alert('Error: ' + err.message);
        }
    } catch (err) {
        console.error('Update error:', err);
        alert('Failed to update role');
    }
};

// No DOMContentLoaded listener needed as this is imported dynamically
