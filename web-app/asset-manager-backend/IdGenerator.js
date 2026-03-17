class IdGenerator {
    static generateAssetId(typeCode, locCode) {
        // Date format MMYY (e.g. 0326)
        const d = new Date();
        const date = (d.getMonth() + 1).toString().padStart(2, '0') + d.getFullYear().toString().substr(-2);
        
        // 6 Character Random Alphanumeric String
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let rand6 = '';
        for (let i = 0; i < 6; i++) {
            rand6 += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        // "Extra random" - 1 char
        const extra = chars.charAt(Math.floor(Math.random() * chars.length));

        // Result: TYPE-LOC-MMYY-RAND6-EXTRA
        return `${typeCode}-${locCode}-${date}-${rand6}-${extra}`;
    }

    static generateProjectId(locCode) {
        const d = new Date();
        // Format: MMYY (e.g., 0326 for March 2026)
        const mmyy = (d.getMonth() + 1).toString().padStart(2, '0') + d.getFullYear().toString().substr(-2);
        
        // 6-digit random number
        const rand = Math.floor(Math.random() * 900000) + 100000;
        
        // Result: LOC-MMYY-RAND-P
        return `${locCode}-${mmyy}-${rand}-P`;
    }
    
    static generateTempAssetId() {
         return 'TEMP-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    }
    
    static generateSplitAssetId(parentId, index) {
        return `${parentId}-${index + 1}`;
    }
}

module.exports = IdGenerator;