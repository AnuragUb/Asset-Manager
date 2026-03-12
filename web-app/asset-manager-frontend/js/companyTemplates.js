
import { fetchWithAuth } from './auth.js?v=5.8';

// Company Template Management Module

// Constants
const API_BASE = '/api/company-templates';

// State
let companyTemplates = [];

/**
 * Initialize Company Template listeners and load initial data
 */
export function initCompanyTemplates() {
    console.log('Initializing Company Templates...');
    
    // Attach event listeners
    const fetchSelect = document.getElementById('dcCompanyTemplate');
    const saveBtn = document.getElementById('btnSaveCompanyTemplate');
    const deleteBtn = document.getElementById('btnDeleteCompanyTemplate');
    
    if (fetchSelect) {
        fetchSelect.addEventListener('change', handleTemplateSelection);
        // Load templates on init
        loadCompanyTemplates(); 
    }
    
    if (saveBtn) {
        saveBtn.addEventListener('click', handleSaveTemplate);
    }
    
    if (deleteBtn) {
        deleteBtn.addEventListener('click', handleDeleteTemplate);
    }
}

/**
 * Load all company templates from the backend
 */
async function loadCompanyTemplates() {
    console.log('[CompanyTemplates] Loading templates...');
    try {
        // NOTE: The 'token' item in localStorage is NOT set by auth.js (it sets 'currentUser').
        // We should rely on the browser sending the cookie automatically.
        // Or if we need a header, we can try to extract it from currentUser if it existed there,
        // but currently auth.js relies on HttpOnly cookies for the main session token.
        // Sending 'Bearer null' or 'Bearer undefined' will fail the server check.
        // So we should omit the header if token is missing to let the server check the cookie.
        
        const token = localStorage.getItem('token');
        const headers = {};
        if (token && token !== 'null' && token !== 'undefined') {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetchWithAuth(API_BASE, {
            headers: headers
        });
        
        console.log('[CompanyTemplates] Response status:', response.status);
        
        if (!response.ok) throw new Error('Failed to fetch templates');
        
        const data = await response.json();
        console.log('[CompanyTemplates] Data received:', data);
        
        if (data.success) {
            companyTemplates = data.templates;
            console.log('[CompanyTemplates] Templates count:', companyTemplates.length);
            renderTemplateOptions();
        }
    } catch (err) {
        console.error('Error loading company templates:', err);
        // showToast('Failed to load company templates', 'error');
    }
}

/**
 * Render the dropdown options
 */
function renderTemplateOptions() {
    const select = document.getElementById('dcCompanyTemplate');
    if (!select) return;
    
    // Keep default option
    select.innerHTML = '<option value="">-- Fetch Company --</option>';
    
    companyTemplates.forEach(template => {
        const option = document.createElement('option');
        option.value = template.id;
        option.textContent = template.name;
        if (template.is_default) {
            option.textContent += ' (Default)';
        }
        select.appendChild(option);
    });
}

/**
 * Handle selection of a template
 */
function handleTemplateSelection(e) {
    const id = e.target.value;
    const deleteBtn = document.getElementById('btnDeleteCompanyTemplate');
    
    if (!id) {
        if (deleteBtn) deleteBtn.style.display = 'none';
        return;
    }
    
    const template = companyTemplates.find(t => t.id == id);
    if (template) {
        // Populate fields
        document.getElementById('dcCompanyName').value = template.company_name || '';
        document.getElementById('dcCompanyAddress').value = template.address || '';
        document.getElementById('dcCompanyGST').value = template.gst || '';
        document.getElementById('dcCompanyCIN').value = template.cin || '';
        document.getElementById('dcCompanyState').value = template.state_name || '';
        document.getElementById('dcCompanyStateCode').value = template.state_code || '';
        
        // Show delete button
        if (deleteBtn) deleteBtn.style.display = 'inline-block';
    }
}

/**
 * Handle saving a new template
 */
async function handleSaveTemplate() {
    const companyName = document.getElementById('dcCompanyName').value.trim();
    if (!companyName) {
        alert('Please enter at least a Company Name');
        return;
    }
    
    // Ask for template name
    const templateName = prompt('Enter a name for this template:', companyName);
    if (!templateName) return; // User cancelled
    
    const payload = {
        name: templateName,
        company_name: companyName,
        address: document.getElementById('dcCompanyAddress').value.trim(),
        gst: document.getElementById('dcCompanyGST').value.trim(),
        cin: document.getElementById('dcCompanyCIN').value.trim(),
        state_name: document.getElementById('dcCompanyState').value.trim(),
        state_code: document.getElementById('dcCompanyStateCode').value.trim(),
        is_default: false // Could add checkbox for this later
    };
    
    try {
        const token = localStorage.getItem('token');
        const headers = {
            'Content-Type': 'application/json'
        };
        if (token && token !== 'null' && token !== 'undefined') {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(API_BASE, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        if (data.success) {
            // Reload templates
            await loadCompanyTemplates();
            // Select the new one
            const select = document.getElementById('dcCompanyTemplate');
            select.value = data.id;
            // Show delete button
            const deleteBtn = document.getElementById('btnDeleteCompanyTemplate');
            if (deleteBtn) deleteBtn.style.display = 'inline-block';
            
            alert('Template saved successfully!');
        } else {
            alert('Error: ' + data.error);
        }
    } catch (err) {
        console.error('Error saving template:', err);
        alert('Failed to save template');
    }
}

/**
 * Handle deleting a template
 */
async function handleDeleteTemplate() {
    const select = document.getElementById('dcCompanyTemplate');
    const id = select.value;
    if (!id) return;
    
    if (!confirm('Are you sure you want to delete this template?')) return;
    
    try {
        const token = localStorage.getItem('token');
        const headers = {};
        if (token && token !== 'null' && token !== 'undefined') {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`${API_BASE}/${id}`, {
            method: 'DELETE',
            headers: headers
        });
        
        const data = await response.json();
        if (data.success) {
            // Clear fields
            document.getElementById('dcCompanyName').value = '';
            document.getElementById('dcCompanyAddress').value = '';
            document.getElementById('dcCompanyGST').value = '';
            document.getElementById('dcCompanyCIN').value = '';
            document.getElementById('dcCompanyState').value = '';
            document.getElementById('dcCompanyStateCode').value = '';
            
            // Reload templates
            await loadCompanyTemplates();
            
            // Hide delete button
            const deleteBtn = document.getElementById('btnDeleteCompanyTemplate');
            if (deleteBtn) deleteBtn.style.display = 'none';
        } else {
            alert('Error: ' + data.error);
        }
    } catch (err) {
        console.error('Error deleting template:', err);
        alert('Failed to delete template');
    }
}
