const bcrypt = require('bcryptjs');

class PasswordService {
    constructor() {
        this.saltRounds = 12;
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
}

module.exports = new PasswordService();