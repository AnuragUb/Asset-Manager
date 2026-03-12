
import { fetchWithAuth } from './auth.js?v=5.8';

console.log('SETTINGS.JS: Module loaded');

export function initSettingsView() {
    console.log('initSettingsView() called');
    loadEmailSettings();
    setupSettingsHandlers();
}

async function loadEmailSettings() {
    try {
        const response = await fetchWithAuth('/api/settings/email');
        const settings = await response.json();
        
        document.getElementById('emailEnabled').checked = settings.enabled;
        document.getElementById('smtpHost').value = settings.smtp_host || '';
        document.getElementById('smtpPort').value = settings.smtp_port || 587;
        document.getElementById('smtpUser').value = settings.smtp_user || '';
        document.getElementById('smtpPass').value = settings.smtp_pass || '';
        document.getElementById('notificationEmail').value = settings.notification_email || '';
        document.getElementById('thresholdDays').value = settings.threshold_days || 30;
        
        toggleEmailFields(settings.enabled);
    } catch (err) {
        console.error('Failed to load email settings:', err);
    }
}

function toggleEmailFields(enabled) {
    const fields = document.getElementById('emailConfigFields');
    if (fields) {
        fields.style.opacity = enabled ? '1' : '0.5';
        fields.style.pointerEvents = enabled ? 'all' : 'none';
    }
}

function setupSettingsHandlers() {
    const enabledCheckbox = document.getElementById('emailEnabled');
    if (enabledCheckbox) {
        enabledCheckbox.onchange = (e) => toggleEmailFields(e.target.checked);
    }

    const form = document.getElementById('emailSettingsForm');
    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            
            const settings = {
                enabled: document.getElementById('emailEnabled').checked,
                smtp_host: document.getElementById('smtpHost').value,
                smtp_port: parseInt(document.getElementById('smtpPort').value),
                smtp_user: document.getElementById('smtpUser').value,
                smtp_pass: document.getElementById('smtpPass').value,
                notification_email: document.getElementById('notificationEmail').value,
                threshold_days: parseInt(document.getElementById('thresholdDays').value)
            };

            try {
                const response = await fetchWithAuth('/api/settings/email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(settings)
                });
                
                const result = await response.json();
                if (result.success) {
                    alert('Settings saved successfully!');
                    loadEmailSettings(); // Refresh to show masked password
                } else {
                    alert('Error saving settings: ' + result.error);
                }
            } catch (err) {
                console.error('Save error:', err);
                alert('Failed to save settings');
            }
        };
    }

    const testBtn = document.getElementById('btnTestEmail');
    if (testBtn) {
        testBtn.onclick = async () => {
            const settings = {
                enabled: document.getElementById('emailEnabled').checked,
                smtp_host: document.getElementById('smtpHost').value,
                smtp_port: parseInt(document.getElementById('smtpPort').value),
                smtp_user: document.getElementById('smtpUser').value,
                smtp_pass: document.getElementById('smtpPass').value,
                notification_email: document.getElementById('notificationEmail').value,
                threshold_days: parseInt(document.getElementById('thresholdDays').value)
            };

            testBtn.disabled = true;
            testBtn.textContent = 'Sending...';

            try {
                const response = await fetchWithAuth('/api/settings/email/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(settings)
                });
                
                const result = await response.json();
                if (result.success) {
                    alert('Test email sent successfully! Please check your inbox.');
                } else {
                    alert('Test failed: ' + result.error);
                }
            } catch (err) {
                console.error('Test error:', err);
                alert('Failed to send test email');
            } finally {
                testBtn.disabled = false;
                testBtn.textContent = 'Send Test Email';
            }
        };
    }

    const runCheckBtn = document.getElementById('btnRunWarrantyCheck');
    if (runCheckBtn) {
        runCheckBtn.onclick = async () => {
            runCheckBtn.disabled = true;
            runCheckBtn.textContent = 'Running Check...';

            try {
                const response = await fetch('/api/settings/email/run-check', {
                    method: 'POST'
                });
                
                const result = await response.json();
                if (result.success) {
                    alert('Warranty check completed! Any necessary alerts have been sent.');
                } else {
                    alert('Check failed: ' + result.error);
                }
            } catch (err) {
                console.error('Check error:', err);
                alert('Failed to trigger warranty check');
            } finally {
                runCheckBtn.disabled = false;
                runCheckBtn.textContent = 'Run Warranty Check Now';
            }
        };
    }
}
