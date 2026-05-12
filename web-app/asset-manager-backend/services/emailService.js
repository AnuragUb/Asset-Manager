const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Logic to find dynamic.json (must match utils.js logic)
const getDataDir = () => {
    return process.env.DATA_DIR || path.join(__dirname, '../../');
};
const dynamicFile = path.join(process.env.DATA_DIR ? getDataDir() : path.join(__dirname, '../'), 'dynamic.json');

class EmailService {
    
    constructor() {
        this.transporter = null;
    }

    /**
     * Get SMTP configuration from dynamic.json
     * @returns {Object|null} SMTP config object or null if not enabled
     */
    getSmtpConfig() {
        try {
            if (!fs.existsSync(dynamicFile)) {
                console.log('[EmailService] dynamic.json not found at:', dynamicFile);
                return null;
            }
            
            const data = JSON.parse(fs.readFileSync(dynamicFile, 'utf8'));
            const config = data.email_settings;
            
            if (!config) {
                console.log('[EmailService] No email_settings found in dynamic.json');
                return null;
            }

            // console.log('[EmailService] SMTP Config Loaded:', { ...config, smtp_pass: '***' });
            
            if (!config.enabled) {
                console.log('[EmailService] SMTP is disabled in settings');
                return null;
            }
            
            return config;
        } catch (err) {
            console.error('Error fetching SMTP config:', err);
            return null;
        }
    }

    /**
     * Create a transporter using current settings
     */
    createTransporter(config) {
        console.log('[EmailService] Creating transporter with host:', config.smtp_host, 'port:', config.smtp_port);
        return nodemailer.createTransport({
            host: config.smtp_host,
            port: config.smtp_port,
            secure: config.smtp_port === 465, // true for 465, false for other ports
            auth: {
                user: config.smtp_user,
                pass: config.smtp_pass
            },
            tls: {
                rejectUnauthorized: false // Often needed for self-signed certs or internal servers
            }
        });
    }

    /**
     * Send a password reset email
     * @param {string} toEmail 
     * @param {string} resetLink 
     */
    async sendPasswordResetEmail(toEmail, resetLink) {
        console.log('[EmailService] Attempting to send reset email to:', toEmail);
        const config = this.getSmtpConfig();
        
        if (!config) {
            console.warn('[EmailService] Email service disabled or not configured. Reset link would be:', resetLink);
            return false;
        }

        const transporter = this.createTransporter(config);

        try {
            console.log('[EmailService] Sending mail...');
            const info = await transporter.sendMail({
                from: `"${config.smtp_user}" <${config.smtp_user}>`, // sender address
                to: toEmail, // list of receivers
                subject: "Password Reset Request - Asset Manager", // Subject line
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
                        <h2 style="color: #333;">Password Reset Request</h2>
                        <p>You requested to reset your password for Asset Manager.</p>
                        <p>Click the button below to reset it:</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
                        </div>
                        <p style="color: #666; font-size: 14px;">Or copy and paste this link into your browser:</p>
                        <p style="color: #007bff; font-size: 12px; word-break: break-all;">${resetLink}</p>
                        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                        <p style="color: #999; font-size: 12px;">If you didn't ask for this, you can safely ignore this email.</p>
                        <p style="color: #999; font-size: 12px;">This link expires in 1 hour.</p>
                    </div>
                `
            });

            console.log("[EmailService] Password reset email sent: %s", info.messageId);
            return true;
        } catch (error) {
            console.error("[EmailService] Error sending password reset email:", error);
            // Don't throw, just return false so we don't crash the request
            return false; 
        }
    }
}

module.exports = new EmailService();