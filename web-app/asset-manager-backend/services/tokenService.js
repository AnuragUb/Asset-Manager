const crypto = require('crypto');
const { db } = require('../utils');

class TokenService {
    /**
     * Generate a cryptographically secure random token
     * @returns {string} The generated token
     */
    generateToken() {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Hash a token using SHA-256
     * @param {string} token - The token to hash
     * @returns {string} The hashed token
     */
    hashToken(token) {
        return crypto.createHash('sha256').update(token).digest('hex');
    }

    /**
     * Store a "Remember Me" token for a user
     * @param {string} userId - The user ID
     * @param {string} token - The raw token (will be hashed)
     * @param {number} expiresInDays - Expiration in days (default 30)
     */
    storeRememberToken(userId, token, expiresInDays = 30) {
        console.log('[TokenService] Storing remember token for user:', userId);
        const tokenHash = this.hashToken(token);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiresInDays);

        try {
            db.prepare(`
                INSERT INTO auth_tokens (user_id, token_hash, expires_at, created_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            `).run(userId, tokenHash, expiresAt.toISOString());
            console.log('[TokenService] Token stored successfully');
        } catch (e) {
            console.error('[TokenService] Error storing token:', e);
        }
    }

    /**
     * Verify a "Remember Me" token
     * @param {string} token - The raw token to verify
     * @returns {string|null} The user ID if valid, null otherwise
     */
    verifyRememberToken(token) {
        console.log('[TokenService] Verifying remember token...');
        const tokenHash = this.hashToken(token);
        const now = new Date().toISOString();

        const record = db.prepare(`
            SELECT user_id, expires_at 
            FROM auth_tokens 
            WHERE token_hash = ?
        `).get(tokenHash);

        if (record) {
             console.log('[TokenService] Token found. Expires at:', record.expires_at, 'Now:', now);
             if (record.expires_at > now) {
                return record.user_id;
             } else {
                 console.log('[TokenService] Token expired');
             }
        } else {
            console.log('[TokenService] Token hash not found in DB');
        }

        return null;
    }

    /**
     * Invalidate a specific "Remember Me" token (Logout)
     * @param {string} token - The raw token to invalidate
     */
    invalidateRememberToken(token) {
        const tokenHash = this.hashToken(token);
        db.prepare('DELETE FROM auth_tokens WHERE token_hash = ?').run(tokenHash);
    }

    /**
     * Invalidate all tokens for a user (Password Change / Security Breach)
     * @param {string} userId - The user ID
     */
    invalidateAllUserTokens(userId) {
        db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(userId);
    }

    /**
     * Store a Password Reset token
     * @param {string} email - The user's email
     * @param {string} token - The raw token (will be hashed)
     * @param {number} expiresInMinutes - Expiration in minutes (default 60)
     */
    storeResetToken(email, token, expiresInMinutes = 60) {
        const tokenHash = this.hashToken(token);
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + expiresInMinutes);

        // Delete any existing reset tokens for this email to prevent spamming
        db.prepare('DELETE FROM password_resets WHERE email = ?').run(email);

        db.prepare(`
            INSERT INTO password_resets (email, token_hash, expires_at, created_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `).run(email, tokenHash, expiresAt.toISOString());
    }

    /**
     * Verify a Password Reset token
     * @param {string} token - The raw token to verify
     * @returns {string|null} The email if valid, null otherwise
     */
    verifyResetToken(token) {
        const tokenHash = this.hashToken(token);
        const now = new Date().toISOString();

        const record = db.prepare(`
            SELECT email, expires_at 
            FROM password_resets 
            WHERE token_hash = ?
        `).get(tokenHash);

        if (record && record.expires_at > now) {
            return record.email;
        }
        return null;
    }

    /**
     * Consume (delete) a Reset token after successful use
     * @param {string} token - The raw token
     */
    consumeResetToken(token) {
        const tokenHash = this.hashToken(token);
        db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(tokenHash);
    }
}

module.exports = new TokenService();