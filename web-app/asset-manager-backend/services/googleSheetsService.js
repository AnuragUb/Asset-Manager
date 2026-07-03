const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

/**
 * Service to handle Google Sheets synchronization
 */
class GoogleSheetsService {
    constructor() {
        this.scopes = ['https://www.googleapis.com/auth/spreadsheets'];
        this.credentialsPath = path.join(__dirname, '..', 'credentials.json');
        this.spreadsheetId = process.env.GOOGLE_SHEETS_ID;
        this.auth = null;
    }

    /**
     * Initialize authentication
     */
    async init() {
        if (this.auth) return this.auth;

        try {
            if (!fs.existsSync(this.credentialsPath)) {
                throw new Error('credentials.json missing in asset-manager-backend/');
            }

            this.auth = new google.auth.GoogleAuth({
                keyFile: this.credentialsPath,
                scopes: this.scopes,
            });

            return this.auth;
        } catch (err) {
            console.error('[GoogleSheets] Auth Init Failed:', err.message);
            throw err;
        }
    }

    /**
     * Sync Job Cards to a specific sheet
     */
    async syncJobCards(jobCards) {
        try {
            const auth = await this.init();
            const sheets = google.sheets({ version: 'v4', auth });

            // Prepare header and data
            const header = [
                'JC No', 'Date', 'Customer Name', 'Contact Person', 'Contact No', 
                'Model Name', 'Serial No', 'Status', 'Reported Problem', 'Action Taken'
            ];

            const rows = jobCards.map(jc => [
                jc.JobCardNo || jc.jobcardno,
                jc.Date || jc.date,
                jc.CustomerName || jc.customername,
                jc.ContactPerson || jc.contactperson,
                jc.ContactNo || jc.contactno,
                jc.ModelName || jc.modelname,
                jc.SerialNo || jc.serialno,
                jc.Status || jc.status,
                jc.ReportedProblem || jc.reportedproblem,
                jc.ActionTaken || jc.actiontaken
            ]);

            const values = [header, ...rows];

            // Clear and update the sheet (assuming 'Job Cards' sheet exists)
            await sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: 'Job Cards!A1',
                valueInputOption: 'RAW',
                resource: { values },
            });

            console.log(`[GoogleSheets] Synced ${rows.length} Job Cards successfully.`);
            return { success: true, count: rows.length };

        } catch (err) {
            console.error('[GoogleSheets] Sync Failed:', err.message);
            throw err;
        }
    }
}

module.exports = new GoogleSheetsService();
