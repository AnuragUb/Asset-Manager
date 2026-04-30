const crypto = require('crypto');
const { db, isPostgres } = require('../utils');

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
            if (isPostgres) {
                await db('auth_tokens').insert({
                    user_id: userId,
                    token_hash: tokenHash,
                    expires_at: expiresAt.toISOString(),
                    created_at: db.fn.now()
                });
            } else {
                db.prepare(`
                    INSERT INTO auth_tokens (user_id, token_hash, expires_at, created_at)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                `).run(userId, tokenHash, expiresAt.toISOString());
            }
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
            let record;
            if (isPostgres) {
                record = await db('auth_tokens')
                    .where('token_hash', tokenHash)
                    .select('user_id', 'expires_at')
                    .first();
            } else {
                record = db.prepare(`
                    SELECT user_id, expires_at 
                    FROM auth_tokens 
                    WHERE token_hash = ?
                `).get(tokenHash);
            }

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
        const tokenHash = this.hashToken(token);
        try {
            if (isPostgres) {
                await db('auth_tokens').where('token_hash', tokenHash).delete();
            } else {
                db.prepare('DELETE FROM auth_tokens WHERE token_hash = ?').run(tokenHash);
            }
        } catch (e) {
            console.error('[TokenService] Error invalidating token:', e);
        }
    }

    /**
     * Invalidate all tokens for a user (Password Change / Security Breach)
     * @param {string} userId - The user ID
     */
    async invalidateAllUserTokens(userId) {
        try {
            if (isPostgres) {
                await db('auth_tokens').where('user_id', userId).delete();
            } else {
                db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(userId);
            }
        } catch (e) {
            console.error('[TokenService] Error invalidating user tokens:', e);
        }
    }

    /**
     * Store a Password Reset token
     * @param {string} email - The user's email
     * @param {string} token - The raw token (will be hashed)
     * @param {number} expiresInMinutes - Expiration in minutes (default 60)
     */
    async storeResetToken(email, token, expiresInMinutes = 60) {
        const tokenHash = this.hashToken(token);
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + expiresInMinutes);

        try {
            if (isPostgres) {
                await db('password_resets').where('email', email).delete();
                await db('password_resets').insert({
                    email,
                    token_hash: tokenHash,
                    expires_at: expiresAt.toISOString(),
                    created_at: db.fn.now()
                });
            } else {
                // Delete any existing reset tokens for this email to prevent spamming
                db.prepare('DELETE FROM password_resets WHERE email = ?').run(email);
                db.prepare(`
                    INSERT INTO password_resets (email, token_hash, expires_at, created_at)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                `).run(email, tokenHash, expiresAt.toISOString());
            }
        } catch (e) {
            console.error('[TokenService] Error storing reset token:', e);
        }
    }

    /**
     * Verify a Password Reset token
     * @param {string} token - The raw token to verify
     * @returns {string|null} The email if valid, null otherwise
     */
    async verifyResetToken(token) {
        const tokenHash = this.hashToken(token);
        const now = new Date().toISOString();

        try {
            let record;
            if (isPostgres) {
                record = await db('password_resets')
                    .where('token_hash', tokenHash)
                    .select('email', 'expires_at')
                    .first();
            } else {
                record = db.prepare(`
                    SELECT email, expires_at 
                    FROM password_resets 
                    WHERE token_hash = ?
                `).get(tokenHash);
            }

            if (record && new Date(record.expires_at) > new Date()) {
                return record.email;
            }
        } catch (e) {
            console.error('[TokenService] Error verifying reset token:', e);
        }
        return null;
    }

    /**
     * Consume (delete) a Reset token after successful use
     * @param {string} token - The raw token
     */
    async consumeResetToken(token) {
        const tokenHash = this.hashToken(token);
        try {
            if (isPostgres) {
                await db('password_resets').where('token_hash', tokenHash).delete();
            } else {
                db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(tokenHash);
            }
        } catch (e) {
            console.error('[TokenService] Error consuming reset token:', e);
        }
    }
}

module.exports = new TokenService();