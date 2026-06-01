# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: verify-changes.spec.js >> Asset Manager: Hierarchy & Lifecycle >> Verify Smart Unassign & Recursive Release
- Location: tests\verify-changes.spec.js:54:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  locator('#dashboardView')
Expected: visible
Received: hidden
Timeout:  10000ms

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('#dashboardView')
    23 × locator resolved to <div id="dashboardView" class="view hidden">…</div>
       - unexpected value "hidden"

```

```yaml
- main:
  - text: Asset Manager Username
  - textbox "Username":
    - /placeholder: Enter your username
    - text: admin
  - text: Password
  - textbox "Password":
    - /placeholder: Enter your password
    - text: password123
  - checkbox "Remember me"
  - text: Remember me
  - link "Forgot Password?":
    - /url: "#"
  - text: Select Module
  - list:
    - listitem: IT Assets
    - listitem: In-House
    - listitem: Rental
    - listitem: Inventory
  - button "Sign In"
  - paragraph:
    - text: Don't have an account?
    - link "Sign Up":
      - /url: "#"
  - paragraph
```

# Test source

```ts
  1   | const { test, expect } = require('@playwright/test');
  2   | 
  3   | /**
  4   |  * Automated Verification for Asset Manager Hierarchy & Lifecycle
  5   |  * Verifies:
  6   |  * 1. Nested display of child assets under parent sets in projects.
  7   |  * 2. The new "Smart Unassign" flow (Modal -> Inspection -> Release).
  8   |  * 3. Atomic status synchronization across the set.
  9   |  */
  10  | 
  11  | test.describe('Asset Manager: Hierarchy & Lifecycle', () => {
  12  |   
  13  |   test.beforeEach(async ({ page }) => {
  14  |     // 1. Login to the system
  15  |     await page.goto('/');
  16  |     await page.fill('input[name="username"]', 'admin');
  17  |     await page.fill('input[name="password"]', 'password123');
  18  |     await page.click('button[type="submit"]');
  19  |     
  20  |     // Wait for a positive indicator that login was successful 
  21  |     // This implicitly handles the async transition from loginView to dashboardView
> 22  |     await expect(page.locator('#dashboardView')).toBeVisible({ timeout: 10000 });
      |                                                  ^ Error: expect(locator).toBeVisible() failed
  23  |     await expect(page.locator('#display-username')).not.toBeEmpty();
  24  |   });
  25  | 
  26  |   test('Verify Asset Hierarchy in Project View', async ({ page }) => {
  27  |     // Navigate to Project view
  28  |     await page.click('#nav-projects');
  29  |     
  30  |     // Find and click the 'Sample' project
  31  |     // Using a more robust selector for the project row
  32  |     const projectRow = page.locator('.project-card, .project-row, .card-title').filter({ hasText: 'Sample' }).first();
  33  |     await projectRow.click();
  34  |     
  35  |     // Wait for project detail tabs to load
  36  |     await page.click('#projectAssetsTabBtn');
  37  |     
  38  |     // Locate the SampleSuperSet row
  39  |     const setRow = page.locator('tr').filter({ hasText: 'SampleSuperSet' });
  40  |     await expect(setRow).toBeVisible();
  41  |     
  42  |     // 1. Check if the "Includes:" section exists (Hierarchy Logic)
  43  |     const includesHeader = setRow.locator('text=Includes:');
  44  |     await expect(includesHeader).toBeVisible();
  45  |     
  46  |     // 2. Check if specific components are listed inside that same row/cell
  47  |     // We promoted IP and SFP-10GSER earlier
  48  |     await expect(setRow).toContainText('SFP-10GSER');
  49  |     await expect(setRow).toContainText('IP');
  50  |     
  51  |     console.log('[SUCCESS] Hierarchy verified: Components are nested under parent set.');
  52  |   });
  53  | 
  54  |   test('Verify Smart Unassign & Recursive Release', async ({ page }) => {
  55  |     // Navigate to Sample Project
  56  |     await page.click('#nav-projects');
  57  |     await page.locator('.project-card, .project-row, .card-title').filter({ hasText: 'Sample' }).first().click();
  58  |     await page.click('#projectAssetsTabBtn');
  59  | 
  60  |     // Identify the Unassign button for the Superset
  61  |     const unassignBtn = page.locator('tr').filter({ hasText: 'SampleSuperSet' }).locator('button').filter({ hasText: 'Unassign' });
  62  |     await unassignBtn.click();
  63  | 
  64  |     // 1. Verify Smart Inspection Modal pops up
  65  |     const modal = page.locator('#inspectionModal');
  66  |     await expect(modal).toBeVisible();
  67  |     await expect(modal).toContainText('Inward Inspection');
  68  | 
  69  |     // 2. Fill the Inspection Form
  70  |     await page.selectOption('#inspectionCondition', 'Good');
  71  |     await page.fill('#inspectionRemarks', 'Playwright Automated Verification: Recursive Release Test');
  72  |     
  73  |     // 3. Submit and verify transition
  74  |     await page.click('#inspectionForm button[type="submit"]');
  75  | 
  76  |     // Modal should close
  77  |     await expect(modal).not.toBeVisible();
  78  |     
  79  |     // Asset should be gone from the project list (successfully unassigned)
  80  |     await expect(page.locator('tr').filter({ hasText: 'SampleSuperSet' })).not.toBeVisible();
  81  | 
  82  |     // 4. Verify Recursive Release: Check Dashboard for the parent and children
  83  |     await page.click('#nav-dashboard');
  84  |     
  85  |     // Both parent and child should now be visible in 'In Store' (not hidden in Under Inspection)
  86  |     const dashboardList = page.locator('#assetListTable');
  87  |     await expect(dashboardList).toContainText('SampleSuperSet');
  88  |     await expect(dashboardList).toContainText('SFP-10GSER');
  89  |     
  90  |     console.log('[SUCCESS] Smart Unassign verified: Parent and Children released to store recursively.');
  91  |   });
  92  | 
  93  |   test('Verify DC Component Formatting', async ({ page }) => {
  94  |     // Navigate to Project
  95  |     await page.click('#nav-projects');
  96  |     await page.locator('.project-card, .project-row, .card-title').filter({ hasText: 'Sample' }).first().click();
  97  |     
  98  |     // Re-assign if it was unassigned in previous test (Tests are parallel but use same DB)
  99  |     // Note: In a real environment we'd use a clean test DB, but here we verify the live state
  100 |     const setRow = page.locator('tr').filter({ hasText: 'SampleSuperSet' });
  101 |     if (!(await setRow.isVisible())) {
  102 |         console.log('Set not found, re-assigning for DC test...');
  103 |         // Logic to re-assign if needed
  104 |     }
  105 | 
  106 |     // Open DC Preview (Trigger logic we updated in server.js)
  107 |     // This usually happens from a 'Generate DC' button in the workspace or assets tab
  108 |     const generateDcBtn = page.locator('button').filter({ hasText: 'Generate DC' });
  109 |     if (await generateDcBtn.isVisible()) {
  110 |         await generateDcBtn.click();
  111 |         
  112 |         // Wait for preview modal
  113 |         const dcPreview = page.locator('#dcPreviewModal');
  114 |         await expect(dcPreview).toBeVisible();
  115 |         
  116 |         // Check for the "with: ..." formatting in the description column
  117 |         await expect(dcPreview).toContainText('with: IP, LIC-SDI, SFP-10GSER');
  118 |         console.log('[SUCCESS] DC Formatting verified: Components listed under parent.');
  119 |     }
  120 |   });
  121 | });
  122 | 
```