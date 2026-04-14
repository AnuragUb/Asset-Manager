const crypto = require('crypto');

// Master Key for Encryption at Rest
// In a real production environment, this would be in an environment variable
const ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY || 'a-very-secret-key-32-chars-long!!!'; 
const IV_LENGTH = 16; // For AES, this is always 16

/**
 * Encrypts a string using AES-256-CBC
 */
function encrypt(text) {
    if (!text || typeof text !== 'string') return text;
    
    // Check if already encrypted (starts with 'enc:')
    if (text.startsWith('enc:')) return text;

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32).substring(0, 32)), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    return 'enc:' + iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Decrypts a string using AES-256-CBC
 */
function decrypt(text) {
    if (!text || typeof text !== 'string' || !text.startsWith('enc:')) return text;

    try {
        const parts = text.split(':');
        const iv = Buffer.from(parts[1], 'hex');
        const encryptedText = Buffer.from(parts[2], 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32).substring(0, 32)), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        
        return decrypted.toString();
    } catch (err) {
        console.error('[EncryptionService] Decryption failed:', err.message);
        return text; // Return original if decryption fails
    }
}

/**
 * Helper to decrypt an entire object's sensitive fields
 */
function decryptObject(obj, sensitiveFields = []) {
    if (!obj) return obj;
    const newObj = { ...obj };
    sensitiveFields.forEach(field => {
        if (newObj[field]) {
            newObj[field] = decrypt(newObj[field]);
        }
    });
    return newObj;
}

/**
 * Encrypts a string deterministically (same input = same output)
 * Used for fields that need to be searchable (like Serial Numbers)
 */
function encryptDeterministic(text) {
    if (!text || typeof text !== 'string') return text;
    if (text.startsWith('det:')) return text;

    // Use a fixed IV for deterministic encryption
    const iv = Buffer.from('AssetManagerDetIV'.substring(0, 16)); 
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32).substring(0, 32)), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    return 'det:' + encrypted.toString('hex');
}

/**
 * Decrypts a deterministically encrypted string
 */
function decryptDeterministic(text) {
    if (!text || typeof text !== 'string' || !text.startsWith('det:')) return text;

    try {
        const encryptedText = Buffer.from(text.substring(4), 'hex');
        const iv = Buffer.from('AssetManagerDetIV'.substring(0, 16)); 
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32).substring(0, 32)), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        
        return decrypted.toString();
    } catch (err) {
        console.error('[EncryptionService] Deterministic decryption failed:', err.message);
        return text;
    }
}

/**
 * Enhanced decrypt that handles both standard and deterministic
 */
function universalDecrypt(text) {
    if (!text || typeof text !== 'string') return text;
    if (text.startsWith('enc:')) return decrypt(text);
    if (text.startsWith('det:')) return decryptDeterministic(text);
    return text;
}

module.exports = {
    encrypt,
    decrypt,
    decryptObject,
    encryptDeterministic,
    decryptDeterministic,
    universalDecrypt
};
