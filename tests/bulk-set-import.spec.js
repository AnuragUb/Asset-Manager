const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * Playwright Test: Bulk Set Import with Group Linking
 * Verifies:
 * 1. Template generation.
 * 2. Upload flow with "Temporary Group Name" mapping.
 * 3. Automatic parent-child linking based on group names.
 */

test.describe('Asset Manager: Bulk Set Import', () => {
    
    test.beforeEach(async ({ page }) => {
        // Handle any alerts/dialogs to prevent hanging
        page.on('dialog', dialog => {
            console.log(`[UI ALERT] ${dialog.message()}`);
            dialog.dismiss().catch(() => {});
        });

        // Login
        await page.goto('/');
        
        // 1. Use scoped selectors to avoid strict mode violations (duplicates in hidden modals)
        const loginForm = page.locator('#loginForm');
        await loginForm.locator('#username').fill('admin');
        await loginForm.locator('#password').fill('password123');
        
        // 2. Explicitly select the module and wait for the 'active' state
        const itModule = page.locator('.module-option', { hasText: 'IT Assets' });
        await itModule.click();
        await expect(itModule).toHaveClass(/active/);
        
        // 3. Perform Login
        // We use Promise.all to ensure the listener is ready before the click triggers the request
        await Promise.all([
            page.waitForResponse(res => res.url().includes('/api/auth/login'), { timeout: 15000 }).catch(() => null),
            loginForm.locator('button[type="submit"]').click()
        ]);
        
        // 4. Wait for positive indicator that dashboard is ready
        await expect(page.locator('#dashboardView')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#display-username')).not.toBeEmpty();
    });

    test('Verify Set Import Template Download', async ({ page }) => {
        // Navigate to Projects -> Sample
        await page.click('#nav-projects');
        const projectRow = page.locator('.project-card, .project-row, .card-title').filter({ hasText: 'Sample' }).first();
        await projectRow.click();
        await page.click('#projectAssetsTabBtn');

        // Check if "Set Import Template" button exists
        const templateBtn = page.locator('button').filter({ hasText: 'Set Import Template' });
        await expect(templateBtn).toBeVisible();

        // Test download (IT version)
        const downloadPromise = page.waitForEvent('download');
        // Handle the confirm dialog (click OK for IT)
        page.once('dialog', dialog => dialog.accept()); 
        await templateBtn.click();
        const download = await downloadPromise;
        
        expect(download.suggestedFilename()).toContain('Asset_Set_Import_Template_IT.csv');
    });

    test('Verify Bulk Upload with Temporary Group Name Linking', async ({ page }) => {
        // 1. Create a dummy CSV with Group Linking
        const csvPath = path.join(__dirname, 'test-set-import.csv');
        const csvContent = [
            'ItemName,Category,Type,Temporary Group Name,Make,Model',
            'Test_Camera_Parent,IT,Camera,AutoKit_001,Sony,FX6',
            'Test_Lens_Child_1,IT,Accessory,AutoKit_001,Canon,24-70mm',
            'Test_Lens_Child_2,IT,Accessory,AutoKit_001,Canon,70-200mm'
        ].join('\n');
        fs.writeFileSync(csvPath, csvContent);

        // 2. Open Bulk Upload Modal
        await page.click('#dashboardViewBtn'); // Go to Dashboard
        await page.click('#btnBulkUpload'); // Open Bulk Upload

        // 3. Upload File
        await page.setInputFiles('#bulkUploadInput', csvPath);

        // 4. Verify Mapping Modal
        const mappingModal = page.locator('#bulkMappingModal');
        await expect(mappingModal).toBeVisible();

        // 5. Check if "Temporary Group Name" was auto-mapped
        const groupMappingSelect = mappingModal.locator('tr').filter({ hasText: 'Temporary Group Name' }).locator('select');
        await expect(groupMappingSelect).toHaveValue('ParentGroup');

        // 6. Process & Upload
        // Handle success alert
        page.once('dialog', dialog => dialog.accept()); 
        await page.click('#confirmBulkMapping');

        // 7. Verify Result on Dashboard
        // Search for the new parent
        await page.fill('#assetSearch', 'Test_Camera_Parent');
        const parentRow = page.locator('tr').filter({ hasText: 'Test_Camera_Parent' });
        await expect(parentRow).toBeVisible();

        // Open details to verify children linked
        await parentRow.locator('button').filter({ hasText: 'View' }).click();
        
        // Check "Includes:" section in details or project view
        const includesList = page.locator('#childrenListContainer');
        await expect(includesList).toContainText('Test_Lens_Child_1');
        await expect(includesList).toContainText('Test_Lens_Child_2');

        // Cleanup
        fs.unlinkSync(csvPath);
        console.log('[SUCCESS] Bulk Set Import verified: Group names correctly resolved to Parent/Child links.');
    });
});
