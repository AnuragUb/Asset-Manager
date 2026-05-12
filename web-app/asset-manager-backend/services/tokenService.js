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
    async storeRememberToken(userId, token, expiresInDays = 30) {
        console.log('[TokenService] Storing remember token for user:', userId);
        const tokenHash = this.hashToken(token);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiresInDays);

        try {
            await db('auth_tokens').insert({
                user_id: userId,
                token_hash: tokenHash,
                expires_at: expiresAt.toISOString(),
                created_at: db.fn.now()
            });
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
    async verifyRememberToken(token) {
        console.log('[TokenService] Verifying remember token...');
        const tokenHash = this.hashToken(token);
        const now = new Date().toISOString();

        try {
            const record = await db('auth_tokens')
                .where('token_hash', tokenHash)
                .select('user_id', 'expires_at')
                .first();

            if (record) {
                 console.log('[TokenService] Token found. Expires at:', record.expires_at, 'Now:', now);
                 if (new Date(record.expires_at) > new Date()) {
                    return record.user_id;
                 } else {
                     console.log('[TokenService] Token expired');
                 }
            } else {
                console.log('[TokenService] Token hash not found in DB');
            }
        } catch (e) {
            console.error('[TokenService] Error verifying token:', e);
        }

        return null;
    }

    /**
     * Invalidate a specific "Remember Me" token (Logout)
     * @param {string} token - The raw token to invalidate
     */
    async invalidateRememberToken(token) {
        console.log('[TokenService] Invalidating remember token...');
        const tokenHash = this.hashToken(token);
        try {
            await db('auth_tokens').where('token_hash', tokenHash).delete();
            console.log('[TokenService] Token invalidated successfully');
        } catch (e) {
            console.error('[TokenService] Error invalidating token:', e);
        }
    }

    /**
     * Invalidate all "Remember Me" tokens for a user
     * @param {string} userId - The user ID
     */
    async invalidateAllUserTokens(userId) {
        console.log('[TokenService] Invalidating all tokens for user:', userId);
        try {
            await db('auth_tokens').where('user_id', userId).delete();
            console.log('[TokenService] All tokens invalidated for user');
        } catch (e) {
            console.error('[TokenService] Error invalidating all user tokens:', e);
        }
    }

    /**
     * Clean up expired tokens from the database
     */
    async cleanupExpiredTokens() {
        console.log('[TokenService] Cleaning up expired tokens...');
        const now = new Date().toISOString();
        try {
            const count = await db('auth_tokens').where('expires_at', '<', now).delete();
            console.log(`[TokenService] Cleaned up ${count} expired tokens`);
        } catch (e) {
            console.error('[TokenService] Error cleaning up tokens:', e);
        }
    }
}

module.exports = new TokenService();
