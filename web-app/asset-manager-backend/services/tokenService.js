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
     * Store a password-reset token for a user
     * @param {string} userId - username / user identifier
     * @param {string} token - raw token (will be hashed)
     * @param {number} expiresInMinutes - expiration in minutes (default 60)
     */
    async storeResetToken(userId, token, expiresInMinutes = 60) {
        console.log('[TokenService] Storing password reset token for user:', userId);
        const tokenHash = this.hashToken(token);
        const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();
        const createdAt = new Date().toISOString();
        try {
            await db('password_resets').insert({
                email: String(userId),
                token_hash: tokenHash,
                expires_at: expiresAt,
                created_at: createdAt
            });
            console.log('[TokenService] Reset token stored');
            return true;
        } catch (e) {
            console.error('[TokenService] Error storing reset token:', e.message || e);
            return false;
        }
    }

    /**
     * Verify a password-reset token (valid signature + not expired).
     * Returns username on success, null otherwise.
     */
    async verifyResetToken(token) {
        if (!token) return null;
        console.log('[TokenService] Verifying reset token...');
        const tokenHash = this.hashToken(token);
        const now = new Date().toISOString();
        try {
            const record = await db('password_resets')
                .where('token_hash', tokenHash)
                .select('email', 'expires_at', 'created_at')
                .first();
            if (!record) {
                console.log('[TokenService] Reset token hash not found');
                return null;
            }
            if (new Date(record.expires_at) <= new Date()) {
                console.log('[TokenService] Reset token expired');
                return null;
            }
            return String(record.email);
        } catch (e) {
            console.error('[TokenService] Error verifying reset token:', e.message || e);
            return null;
        }
    }

    /**
     * Consume (delete) a reset token so it can't be reused.
     */
    async consumeResetToken(token) {
        if (!token) return;
        const tokenHash = this.hashToken(token);
        try {
            await db('password_resets').where('token_hash', tokenHash).delete();
            console.log('[TokenService] Reset token consumed');
        } catch (e) {
            console.error('[TokenService] Error consuming reset token:', e.message || e);
        }
    }

    /**
     * Clean up expired tokens from the database
     */
    async cleanupExpiredTokens() {
        console.log('[TokenService] Cleaning up expired tokens...');
        const now = new Date().toISOString();
        try {
            const count1 = await db('auth_tokens').where('expires_at', '<', now).delete();
            const count2 = await db('password_resets').where('expires_at', '<', now).delete();
            console.log(`[TokenService] Cleaned up ${count1} auth tokens + ${count2} password reset tokens`);
        } catch (e) {
            console.error('[TokenService] Error cleaning up tokens:', e);
        }
    }
}

module.exports = new TokenService();
