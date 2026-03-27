/**
 * formAutosave.js
 * Automatically saves form data to localStorage to prevent data loss on reload.
 */

export function initFormAutosave() {
    console.log('[FormAutosave] Initializing...');
    
    // Identify the main asset form
    const formId = 'addAssetForm'; // Ensure this ID matches your actual form ID
    const storageKey = 'asset_form_draft';

    // Function to save data
    const saveData = () => {
        const form = document.getElementById(formId);
        if (!form) return;

        const formData = new FormData(form);
        const data = {};
        for (const [key, value] of formData.entries()) {
            data[key] = value;
        }
        
        // Handle checkboxes explicitly if needed (FormData handles them if checked)
        // Store timestamp
        data._savedAt = new Date().getTime();

        localStorage.setItem(storageKey, JSON.stringify(data));
        console.log('[FormAutosave] Draft saved');
    };

    // Function to restore data
    const restoreData = () => {
        const form = document.getElementById(formId);
        if (!form) return;

        const savedJson = localStorage.getItem(storageKey);
        if (!savedJson) return;

        try {
            const data = JSON.parse(savedJson);
            // Check if draft is too old (e.g., > 24 hours)
            if (data._savedAt && (new Date().getTime() - data._savedAt > 24 * 60 * 60 * 1000)) {
                console.log('[FormAutosave] Draft expired, clearing');
                localStorage.removeItem(storageKey);
                return;
            }

            console.log('[FormAutosave] Restoring draft...');
            Object.keys(data).forEach(key => {
                if (key === '_savedAt') return;
                
                const input = form.elements[key];
                if (input) {
                    if (input.type === 'checkbox') {
                        input.checked = !!data[key];
                    } else if (input.type === 'radio') {
                        // Handle radio groups
                        const radio = form.querySelector(`input[name="${key}"][value="${data[key]}"]`);
                        if (radio) radio.checked = true;
                    } else {
                        input.value = data[key];
                    }
                }
            });
            
            // Show a small toast/notification that data was restored?
            // For now just log
        } catch (e) {
            console.error('[FormAutosave] Error restoring draft:', e);
        }
    };

    // Function to clear data on successful submit
    const clearData = () => {
        localStorage.removeItem(storageKey);
        console.log('[FormAutosave] Draft cleared after submit');
    };

    // Attach listeners
    // We need to wait for the form to be in the DOM. 
    // Since the dashboard might render it later, we use a MutationObserver or poll, 
    // OR just rely on event delegation on the document body if the form is dynamic.
    
    // Using Event Delegation for input changes (captures events from dynamically added forms)
    document.body.addEventListener('input', (e) => {
        if (e.target.form && e.target.form.id === formId) {
            saveData();
        }
    });
    
    document.body.addEventListener('change', (e) => {
        if (e.target.form && e.target.form.id === formId) {
            saveData();
        }
    });

    // Attach submit listener to clear data
    // We can't easily delegate 'submit' to the form if the form variable isn't stable.
    // Instead, we can intercept the submit event on the body.
    document.body.addEventListener('submit', (e) => {
        if (e.target.id === formId) {
            // We clear ONLY if the submit is successful? 
            // Usually we clear on submit attempt, or let the actual saveAsset function clear it.
            // Let's expose clearData globally so saveAsset can call it.
            // But for now, let's clear it here. If save fails, user might want data back? 
            // Ideally we clear ONLY on success.
            // So we'll expose a global function.
        }
    });

    window.clearAssetDraft = clearData;
    window.restoreAssetDraft = restoreData;

    // Try to restore immediately (if form exists)
    restoreData();
    
    // Also try to restore whenever the form might be re-rendered (e.g. view switch)
    // We can hook into `showView` or just rely on the user navigating.
    // Since `restoreData` checks if form exists, it's safe to call multiple times.
    setInterval(restoreData, 2000); // Poll every 2s to check if form appeared and needs restore (simple/hacky but effective for dynamic SPAs)
}
