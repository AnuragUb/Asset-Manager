# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: bulk-set-import.spec.js >> Asset Manager: Bulk Set Import >> Verify Bulk Upload with Temporary Group Name Linking
- Location: tests\bulk-set-import.spec.js:60:5

# Error details

```
Test timeout of 30000ms exceeded while running "beforeEach" hook.
```

```
Error: page.waitForResponse: Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- main [ref=e4]:
  - generic [ref=e6]:
    - generic [ref=e9]: Asset Manager
    - generic [ref=e11]:
      - generic [ref=e12]:
        - generic [ref=e13]:
          - generic [ref=e14]: Username
          - textbox "Username" [ref=e15]:
            - /placeholder: Enter your username
            - text: admin
        - generic [ref=e16]:
          - generic [ref=e17]: Password
          - textbox "Password" [ref=e19]:
            - /placeholder: Enter your password
            - text: password123
        - generic [ref=e20]:
          - generic [ref=e21] [cursor=pointer]:
            - checkbox "Remember me" [ref=e22]
            - text: Remember me
          - link "Forgot Password?" [ref=e23] [cursor=pointer]:
            - /url: "#"
        - generic [ref=e24]:
          - generic [ref=e25]: Select Module
          - list [ref=e28]:
            - listitem [ref=e29] [cursor=pointer]: IT Assets
            - listitem [ref=e30] [cursor=pointer]: In-House
            - listitem [ref=e31] [cursor=pointer]: Rental
            - listitem [ref=e32] [cursor=pointer]: Inventory
        - button "Sign In" [active] [ref=e33] [cursor=pointer]
      - paragraph [ref=e34]:
        - text: Don't have an account?
        - link "Sign Up" [ref=e35] [cursor=pointer]:
          - /url: "#"
      - paragraph [ref=e36]
```

# Test source

```ts
  1   | const { test, expect } = require('@playwright/test');
  2   | const fs = require('fs');
  3   | const path = require('path');
  4   | 
  5   | /**
  6   |  * Playwright Test: Bulk Set Import with Group Linking
  7   |  * Verifies:
  8   |  * 1. Template generation.
  9   |  * 2. Upload flow with "Temporary Group Name" mapping.
  10  |  * 3. Automatic parent-child linking based on group names.
  11  |  */
  12  | 
  13  | test.describe('Asset Manager: Bulk Set Import', () => {
  14  |     
  15  |     test.beforeEach(async ({ page }) => {
  16  |         // Login
  17  |         await page.goto('/');
  18  |         
  19  |         // 1. Use scoped selectors to avoid strict mode violations (duplicates in hidden modals)
  20  |         const loginForm = page.locator('#loginForm');
  21  |         await loginForm.locator('#username').fill('admin');
  22  |         await loginForm.locator('#password').fill('password123');
  23  |         
  24  |         // 2. Explicitly select the module and wait for the 'active' state
  25  |         const itModule = page.locator('.module-option', { hasText: 'IT Assets' });
  26  |         await itModule.click();
  27  |         await expect(itModule).toHaveClass(/active/);
  28  |         
  29  |         // 3. Perform Login and wait for network confirmation
> 30  |         const loginPromise = page.waitForResponse(res => res.url().includes('/api/auth/login') && res.status() === 200);
      |                                   ^ Error: page.waitForResponse: Test timeout of 30000ms exceeded.
  31  |         await loginForm.locator('button[type="submit"]').click();
  32  |         await loginPromise;
  33  |         
  34  |         // 4. Wait for positive indicator that dashboard is ready
  35  |         await expect(page.locator('#dashboardView')).toBeVisible({ timeout: 15000 });
  36  |         await expect(page.locator('#display-username')).not.toBeEmpty();
  37  |     });
  38  | 
  39  |     test('Verify Set Import Template Download', async ({ page }) => {
  40  |         // Navigate to Projects -> Sample
  41  |         await page.click('#nav-projects');
  42  |         const projectRow = page.locator('.project-card, .project-row, .card-title').filter({ hasText: 'Sample' }).first();
  43  |         await projectRow.click();
  44  |         await page.click('#projectAssetsTabBtn');
  45  | 
  46  |         // Check if "Set Import Template" button exists
  47  |         const templateBtn = page.locator('button').filter({ hasText: 'Set Import Template' });
  48  |         await expect(templateBtn).toBeVisible();
  49  | 
  50  |         // Test download (IT version)
  51  |         const downloadPromise = page.waitForEvent('download');
  52  |         // Handle the confirm dialog (click OK for IT)
  53  |         page.once('dialog', dialog => dialog.accept()); 
  54  |         await templateBtn.click();
  55  |         const download = await downloadPromise;
  56  |         
  57  |         expect(download.suggestedFilename()).toContain('Asset_Set_Import_Template_IT.csv');
  58  |     });
  59  | 
  60  |     test('Verify Bulk Upload with Temporary Group Name Linking', async ({ page }) => {
  61  |         // 1. Create a dummy CSV with Group Linking
  62  |         const csvPath = path.join(__dirname, 'test-set-import.csv');
  63  |         const csvContent = [
  64  |             'ItemName,Category,Type,Temporary Group Name,Make,Model',
  65  |             'Test_Camera_Parent,IT,Camera,AutoKit_001,Sony,FX6',
  66  |             'Test_Lens_Child_1,IT,Accessory,AutoKit_001,Canon,24-70mm',
  67  |             'Test_Lens_Child_2,IT,Accessory,AutoKit_001,Canon,70-200mm'
  68  |         ].join('\n');
  69  |         fs.writeFileSync(csvPath, csvContent);
  70  | 
  71  |         // 2. Open Bulk Upload Modal
  72  |         await page.click('#dashboardViewBtn'); // Go to Dashboard
  73  |         await page.click('#btnBulkUpload'); // Open Bulk Upload
  74  | 
  75  |         // 3. Upload File
  76  |         await page.setInputFiles('#bulkUploadInput', csvPath);
  77  | 
  78  |         // 4. Verify Mapping Modal
  79  |         const mappingModal = page.locator('#bulkMappingModal');
  80  |         await expect(mappingModal).toBeVisible();
  81  | 
  82  |         // 5. Check if "Temporary Group Name" was auto-mapped
  83  |         const groupMappingSelect = mappingModal.locator('tr').filter({ hasText: 'Temporary Group Name' }).locator('select');
  84  |         await expect(groupMappingSelect).toHaveValue('ParentGroup');
  85  | 
  86  |         // 6. Process & Upload
  87  |         // Handle success alert
  88  |         page.once('dialog', dialog => dialog.accept()); 
  89  |         await page.click('#confirmBulkMapping');
  90  | 
  91  |         // 7. Verify Result on Dashboard
  92  |         // Search for the new parent
  93  |         await page.fill('#assetSearch', 'Test_Camera_Parent');
  94  |         const parentRow = page.locator('tr').filter({ hasText: 'Test_Camera_Parent' });
  95  |         await expect(parentRow).toBeVisible();
  96  | 
  97  |         // Open details to verify children linked
  98  |         await parentRow.locator('button').filter({ hasText: 'View' }).click();
  99  |         
  100 |         // Check "Includes:" section in details or project view
  101 |         const includesList = page.locator('#childrenListContainer');
  102 |         await expect(includesList).toContainText('Test_Lens_Child_1');
  103 |         await expect(includesList).toContainText('Test_Lens_Child_2');
  104 | 
  105 |         // Cleanup
  106 |         fs.unlinkSync(csvPath);
  107 |         console.log('[SUCCESS] Bulk Set Import verified: Group names correctly resolved to Parent/Child links.');
  108 |     });
  109 | });
  110 | 
```