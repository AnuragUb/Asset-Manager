/**
 * auth.js
 * Manages user login, session persistence, and module selection
 * Version: 7.31
 */

import { startLoginButtonSaver, stopLoginButtonSaver } from './loginAnimations.js?v=7.36';

const AUTH_GENERIC_LOGIN = 'Invalid username or password.';
const AUTH_SESSION_EXPIRED = 'Your session has expired. Please sign in again.';
const AUTH_FORGOT_NEUTRAL = 'If an account exists for that address, a reset link has been sent.';
const AUTH_MUST_CHANGE = 'Check your email for a link to set your own password before using AssetEngine.';

function operatorAuthMessage(payload, fallback) {
    if (!payload || typeof payload !== 'object') return fallback;
    const raw = String(payload.message || payload.error || '').trim();
    if (!raw) return fallback;
    if (/stack|sql|postgres|knex|exception/i.test(raw)) return fallback;
    return raw;
}

function showAuthMessage(id, text) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = text || '';
        return true;
    }
    if (text) alert(text);
    return false;
}

export async function checkSession() {
    try {
        const response = await fetch('/api/auth/me');
        if (response.ok) {
            const payload = await response.json();
            return payload.user;
        }
    } catch (err) {
        console.error('Session check error:', err);
    }
    return null;
}

/**
 * Wrapper for fetch that handles 401 Unauthorized by attempting session refresh.
 * Use this instead of native fetch for authenticated endpoints.
 * @param {string} url
 * @param {object} options
 */
export async function fetchWithAuth(url, options = {}) {
    let response = await fetch(url, options);

    if (response.status === 401) {
        const user = await checkSession();

        if (user) {
            response = await fetch(url, options);
        } else {
            if (typeof window.closePoCarousel === 'function') window.closePoCarousel();
            if (window.showView) window.showView('loginView');
        }
    }

    return response;
}

export function setupAuth(onLoginSuccess) {
    const loginForm = document.getElementById('loginForm');
    const logoutBtn = document.getElementById('logout-btn');
    const rememberBox = document.getElementById('rememberMe');
    if (rememberBox) rememberBox.checked = false;

    checkSession().then(user => {
        if (user) {
            if (!user.category || user.category === 'IT') {
                let savedCategory = localStorage.getItem('selectedAssetCategory');
                if (savedCategory && (savedCategory.length > 20 || savedCategory.includes('-'))) {
                    localStorage.removeItem('selectedAssetCategory');
                    savedCategory = null;
                }
                user.category = savedCategory || user.category || 'IT';
            }
            onLoginSuccess(user);
        }
    });

    if (loginForm) {
        if (loginForm.dataset.authInitialized) return;
        loginForm.dataset.authInitialized = "true";

        loginForm.addEventListener('click', (e) => {
            if (e.target.matches('#forgotPasswordLink')) {
                e.preventDefault();
                const modal = document.getElementById('forgotPasswordModal');
                if (modal) modal.style.display = 'block';
            }
        });

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = loginForm.username.value;
            const password = loginForm.password.value;
            const rememberMe = document.getElementById('rememberMe') ? document.getElementById('rememberMe').checked : false;
            const currentModuleSelect = document.getElementById('assetCategory');
            const category = currentModuleSelect ? currentModuleSelect.value : 'IT';

            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password, category, rememberMe })
                });

                if (response.ok) {
                    const payload = await response.json();
                    stopLoginButtonSaver();
                    if (payload && payload.mustChangePassword) {
                        showAuthMessage('loginMsg', operatorAuthMessage(payload, AUTH_MUST_CHANGE));
                        if (payload.setupToken) {
                            openResetPasswordModal(payload.setupToken);
                        } else if (payload.devResetLink) {
                            const tokenFromLink = String(payload.devResetLink).split('token=')[1];
                            if (tokenFromLink) openResetPasswordModal(tokenFromLink);
                        }
                        return;
                    }
                    const user = payload && payload.user ? payload.user : payload;
                    user.category = category;
                    localStorage.setItem('selectedAssetCategory', category);

                    const returnTo = sessionStorage.getItem('returnTo');
                    if (returnTo) {
                        sessionStorage.removeItem('returnTo');
                        const url = new URL(returnTo, window.location.origin);
                        if (url.hash) {
                             window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
                        }
                    } else if (window.location.hash) {
                        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
                    }

                    onLoginSuccess(user);
                } else if (response.status === 401) {
                    showAuthMessage('loginMsg', AUTH_GENERIC_LOGIN);
                    startLoginButtonSaver();
                } else {
                    const error = await response.json().catch(() => ({}));
                    showAuthMessage('loginMsg', operatorAuthMessage(error, AUTH_GENERIC_LOGIN));
                    startLoginButtonSaver();
                }
            } catch (err) {
                console.error('Login error:', err);
                showAuthMessage('loginMsg', 'Unable to sign in. Please try again.');
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}'
                });
            } catch (err) {
                console.error('Logout error:', err);
            }
            localStorage.removeItem('selectedAssetCategory');
            window.location.href = '/';
        });
    }

    const forgotModal = document.getElementById('forgotPasswordModal');
    const closeForgot = document.getElementById('closeForgotModal');
    const forgotForm = document.getElementById('forgotPasswordForm');

    if (closeForgot && forgotModal) {
        closeForgot.addEventListener('click', () => {
            forgotModal.style.display = 'none';
        });
    }

    if (forgotForm) {
        forgotForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = forgotForm.querySelector('button');
            const originalText = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Sending...';

            const email = document.getElementById('forgotEmail').value;

            try {
                const response = await fetch('/api/auth/forgot-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });

                const result = await response.json().catch(() => ({}));
                if (response.status === 503) {
                    showAuthMessage('forgotMsg', operatorAuthMessage(result, 'Password reset is temporarily unavailable.'));
                    return;
                }
                if (!response.ok) {
                    showAuthMessage('forgotMsg', operatorAuthMessage(result, AUTH_FORGOT_NEUTRAL));
                    return;
                }

                let msg = AUTH_FORGOT_NEUTRAL;
                if (result.devResetLink) {
                    msg += `\n\nDevelopment reset link:\n${result.devResetLink}`;
                    try {
                        await navigator.clipboard.writeText(result.devResetLink);
                        msg += '\n\n(Link copied to clipboard.)';
                    } catch (_) { /* clipboard optional */ }
                }
                alert(msg);
                showAuthMessage('forgotMsg', '');
                if (forgotModal) forgotModal.style.display = 'none';
            } catch (err) {
                console.error('Forgot password error:', err);
                showAuthMessage('forgotMsg', 'Failed to process request.');
            } finally {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        });
    }

    bindResetPasswordForm();
    const hashToken = readResetTokenFromLocation();
    if (hashToken) openResetPasswordModal(hashToken);
}

function readResetTokenFromLocation() {
    if (window.location.hash.includes('reset-password')) {
        const hashParts = window.location.hash.split('?');
        if (hashParts.length > 1) {
            const hashParams = new URLSearchParams(hashParts[1]);
            const token = hashParams.get('token');
            if (token) return token;
        }
    }
    return new URLSearchParams(window.location.search).get('token');
}

function openResetPasswordModal(token) {
    const resetModal = document.getElementById('resetPasswordModal');
    const tokenInput = document.getElementById('resetToken');
    if (!token || !resetModal || !tokenInput) return;
    tokenInput.value = token;
    tokenInput.setAttribute('value', token);
    resetModal.style.display = 'block';
}

function bindResetPasswordForm() {
    const resetModal = document.getElementById('resetPasswordModal');
    const resetForm = document.getElementById('resetPasswordForm');
    if (!resetForm || resetForm.dataset.resetBound) return;
    resetForm.dataset.resetBound = '1';
    resetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newPass = document.getElementById('newPassword').value;
        const confirmPass = document.getElementById('confirmPassword').value;
        const tokenVal = (document.getElementById('resetToken') || {}).value || '';

        if (newPass !== confirmPass) {
            showAuthMessage('resetMsg', 'Passwords do not match.');
            return;
        }
        if (!tokenVal) {
            showAuthMessage('resetMsg', 'This password reset link is no longer valid.');
            return;
        }

        const btn = resetForm.querySelector('button');
        const originalBtnText = btn ? btn.textContent : 'Reset Password';
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Saving...';
        }

        try {
            const response = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: tokenVal, newPassword: newPass, confirmPassword: confirmPass })
            });

            const result = await response.json().catch(() => ({}));
            if (response.ok) {
                alert(operatorAuthMessage(result, 'Your password has been reset. Please sign in.'));
                if (resetModal) resetModal.style.display = 'none';
                window.location.href = '/';
            } else {
                showAuthMessage('resetMsg', operatorAuthMessage(result, 'This password reset link is no longer valid.'));
            }
        } catch (err) {
            console.error('Reset error:', err);
            showAuthMessage('resetMsg', 'Failed to reset password.');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = originalBtnText;
            }
        }
    });
}
