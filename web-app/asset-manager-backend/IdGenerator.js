class IdGenerator {
    static generateAssetId(typeCode, locCode) {
        // Trim codes to prevent spaces in IDs
        const t = String(typeCode || '').trim();
        const l = String(locCode || '').trim();

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
        return `${t}-${l}-${date}-${rand6}-${extra}`;
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

    static productAlphabet() {
        return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    }

    static productChecksumWeights() {
        return [1, 5, 7, 11, 13, 17];
    }

    static productIdMmyy(now) {
        const d = now instanceof Date ? now : new Date();
        return (d.getMonth() + 1).toString().padStart(2, '0') + d.getFullYear().toString().substr(-2);
    }

    /**
     * Weighted mod-36 checksum over payload "PRD" + MMYY + XXXXXX.
     * Weights [1,5,7,11,13,17] are all coprime with 36.
     */
    static computeProductChecksum(payload) {
        const alphabet = IdGenerator.productAlphabet();
        const weights = IdGenerator.productChecksumWeights();
        const text = String(payload || '');
        if (!text) {
            throw new Error('Product checksum payload is empty');
        }
        let sum = 0;
        for (let i = 0; i < text.length; i++) {
            const idx = alphabet.indexOf(text[i]);
            if (idx < 0) {
                throw new Error(`Product checksum payload contains invalid character: ${text[i]}`);
            }
            sum += idx * weights[i % weights.length];
        }
        return alphabet[sum % alphabet.length];
    }

    /**
     * Immutable Product ID: PRD-MMYY-XXXXXX-C
     * Does not depend on make, model, manufacturer, location, SKU, or Zoho ID.
     */
    static generateProductId(now) {
        const alphabet = IdGenerator.productAlphabet();
        const mmyy = IdGenerator.productIdMmyy(now);
        let rand6 = '';
        for (let i = 0; i < 6; i++) {
            rand6 += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
        }
        const payload = `PRD${mmyy}${rand6}`;
        const checksum = IdGenerator.computeProductChecksum(payload);
        return `PRD-${mmyy}-${rand6}-${checksum}`;
    }

    static verifyProductId(id) {
        const match = String(id || '').trim().match(/^PRD-([0-9]{4})-([A-Z0-9]{6})-([A-Z0-9])$/);
        if (!match) return false;
        try {
            const payload = `PRD${match[1]}${match[2]}`;
            return IdGenerator.computeProductChecksum(payload) === match[3];
        } catch (err) {
            return false;
        }
    }

    /**
     * Immutable Reservation ID: RSV-MMYY-XXXXXX-C
     * Same checksum family as Product IDs. Independent of owner/resource IDs.
     */
    static generateReservationId(now) {
        const alphabet = IdGenerator.productAlphabet();
        const mmyy = IdGenerator.productIdMmyy(now);
        let rand6 = '';
        for (let i = 0; i < 6; i++) {
            rand6 += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
        }
        const payload = `RSV${mmyy}${rand6}`;
        const checksum = IdGenerator.computeProductChecksum(payload);
        return `RSV-${mmyy}-${rand6}-${checksum}`;
    }

    static verifyReservationId(id) {
        const match = String(id || '').trim().match(/^RSV-([0-9]{4})-([A-Z0-9]{6})-([A-Z0-9])$/);
        if (!match) return false;
        try {
            const payload = `RSV${match[1]}${match[2]}`;
            return IdGenerator.computeProductChecksum(payload) === match[3];
        } catch (err) {
            return false;
        }
    }

    /**
     * Immutable Conversion operation ID: CONV-MMYY-XXXXXX-C
     * Audit / logger / reconciliation only. Not a user-facing holding identifier.
     */
    static generateConversionId(now) {
        const alphabet = IdGenerator.productAlphabet();
        const mmyy = IdGenerator.productIdMmyy(now);
        let rand6 = '';
        for (let i = 0; i < 6; i++) {
            rand6 += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
        }
        const payload = `CONV${mmyy}${rand6}`;
        const checksum = IdGenerator.computeProductChecksum(payload);
        return `CONV-${mmyy}-${rand6}-${checksum}`;
    }

    static verifyConversionId(id) {
        const match = String(id || '').trim().match(/^CONV-([0-9]{4})-([A-Z0-9]{6})-([A-Z0-9])$/);
        if (!match) return false;
        try {
            const payload = `CONV${match[1]}${match[2]}`;
            return IdGenerator.computeProductChecksum(payload) === match[3];
        } catch (err) {
            return false;
        }
    }

    /**
     * Checksum-family IDs: PREFIX-MMYY-XXXXXX-C
     * Used by Set / Requirement / Allocation. Does not embed location or physical type.
     */
    static generateChecksumPrefixedId(prefix, now) {
        const p = String(prefix || '').trim().toUpperCase();
        if (!p) throw new Error('Checksum ID prefix is required');
        const alphabet = IdGenerator.productAlphabet();
        const mmyy = IdGenerator.productIdMmyy(now);
        let rand6 = '';
        for (let i = 0; i < 6; i++) {
            rand6 += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
        }
        const payload = `${p}${mmyy}${rand6}`;
        const checksum = IdGenerator.computeProductChecksum(payload);
        return `${p}-${mmyy}-${rand6}-${checksum}`;
    }

    static verifyChecksumPrefixedId(prefix, id) {
        const p = String(prefix || '').trim().toUpperCase();
        const match = String(id || '').trim().match(new RegExp(`^${p}-([0-9]{4})-([A-Z0-9]{6})-([A-Z0-9])$`));
        if (!match) return false;
        try {
            const payload = `${p}${match[1]}${match[2]}`;
            return IdGenerator.computeProductChecksum(payload) === match[3];
        } catch (err) {
            return false;
        }
    }

    static generateSetId(now) {
        return IdGenerator.generateChecksumPrefixedId('SET', now);
    }

    static verifySetId(id) {
        return IdGenerator.verifyChecksumPrefixedId('SET', id);
    }

    static generateRequirementId(now) {
        return IdGenerator.generateChecksumPrefixedId('REQ', now);
    }

    static verifyRequirementId(id) {
        return IdGenerator.verifyChecksumPrefixedId('REQ', id);
    }

    static generateAllocationId(now) {
        return IdGenerator.generateChecksumPrefixedId('ALC', now);
    }

    static verifyAllocationId(id) {
        return IdGenerator.verifyChecksumPrefixedId('ALC', id);
    }

    static generateReceiptNoteId(now) {
        return IdGenerator.generateChecksumPrefixedId('RN', now);
    }

    static verifyReceiptNoteId(id) {
        return IdGenerator.verifyChecksumPrefixedId('RN', id);
    }

    static generateReceiptLineId(now) {
        return IdGenerator.generateChecksumPrefixedId('RNL', now);
    }

    static verifyReceiptLineId(id) {
        return IdGenerator.verifyChecksumPrefixedId('RNL', id);
    }

    static generateProcurementPoId(now) {
        return IdGenerator.generateChecksumPrefixedId('PPO', now);
    }

    static verifyProcurementPoId(id) {
        return IdGenerator.verifyChecksumPrefixedId('PPO', id);
    }

    static generateProcurementPoLineId(now) {
        return IdGenerator.generateChecksumPrefixedId('POL', now);
    }

    static verifyProcurementPoLineId(id) {
        return IdGenerator.verifyChecksumPrefixedId('POL', id);
    }

    static generateProcurementSyncEventId(now) {
        return IdGenerator.generateChecksumPrefixedId('PSE', now);
    }

    static verifyProcurementSyncEventId(id) {
        return IdGenerator.verifyChecksumPrefixedId('PSE', id);
    }

    static generatePurchaseBookId(now) {
        return IdGenerator.generateChecksumPrefixedId('PBK', now);
    }

    static verifyPurchaseBookId(id) {
        return IdGenerator.verifyChecksumPrefixedId('PBK', id);
    }

    static generatePurchaseBookLineId(now) {
        return IdGenerator.generateChecksumPrefixedId('PBL', now);
    }

    static verifyPurchaseBookLineId(id) {
        return IdGenerator.verifyChecksumPrefixedId('PBL', id);
    }

    static generatePurchaseBookDcConsumptionId(now) {
        return IdGenerator.generateChecksumPrefixedId('PBC', now);
    }

    static verifyPurchaseBookDcConsumptionId(id) {
        return IdGenerator.verifyChecksumPrefixedId('PBC', id);
    }

    static generateSerialIdentityId(now) {
        return IdGenerator.generateChecksumPrefixedId('SER', now);
    }

    static verifySerialIdentityId(id) {
        return IdGenerator.verifyChecksumPrefixedId('SER', id);
    }

    /**
     * Physical Intake operation ID: INTAKE-MMYY-XXXXXX-C
     * Audit / provenance reference only. Not a physical holding identifier.
     */
    static generatePhysicalIntakeId(now) {
        return IdGenerator.generateChecksumPrefixedId('INTAKE', now);
    }

    static verifyPhysicalIntakeId(id) {
        return IdGenerator.verifyChecksumPrefixedId('INTAKE', id);
    }
}

module.exports = IdGenerator;