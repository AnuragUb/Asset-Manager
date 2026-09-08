const bcrypt = require('bcryptjs');

class PasswordService {
    constructor() {
        this.saltRounds = 12;
        this.minLength = 8;
        this.maxLength = 128;
    }

    /**
     * Hash a plain text password
     * @param {string} password
     * @returns {Promise<string>} The hashed password
     */
    async hashPassword(password) {
        return bcrypt.hash(password, this.saltRounds);
    }

    /**
     * Compare a plain text password with a hash
     * @param {string} password
     * @param {string} hash
     * @returns {Promise<boolean>} True if match, false otherwise
     */
    async comparePassword(password, hash) {
        return bcrypt.compare(password, hash);
    }

    looksLikeBcrypt(value) {
        return typeof value === 'string' && /^\$2[aby]\$/.test(value);
    }

    /**
     * Server-side password rules. Returns an operator-facing message or null.
     * @param {string} password
     * @param {string} [confirmPassword]
     * @returns {string|null}
     */
    validatePassword(password, confirmPassword) {
        if (password == null || String(password).length === 0) {
            return 'Password is required.';
        }
        const value = String(password);
        if (value.length < this.minLength) {
            return `Password must be at least ${this.minLength} characters.`;
        }
        if (value.length > this.maxLength) {
            return `Password must be at most ${this.maxLength} characters.`;
        }
        if (confirmPassword !== undefined && confirmPassword !== null && value !== String(confirmPassword)) {
            return 'Passwords do not match.';
        }
        return null;
    }
}

module.exports = new PasswordService();
