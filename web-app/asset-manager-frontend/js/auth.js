/**
 * auth.js
 * Manages user login, session persistence, and module selection
 * Version: 4.0
 */

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
        console.warn('[FetchWithAuth] 401 Unauthorized detected. Attempting session refresh...');
        
        // Attempt to refresh session (via Remember Me cookie)
        const user = await checkSession();
        
        if (user) {
            console.log('[FetchWithAuth] Session refreshed successfully. Retrying request...');
            // Retry the original request
            response = await fetch(url, options);
        } else {
            console.error('[FetchWithAuth] Session refresh failed.');
            // We don't force reload here to avoid infinite loops, but the UI will likely stay broken/empty
            // until the user manually logs in. 
            // Ideally we should trigger the login view.
            if (window.showView) window.showView('loginView');
        }
    }

    return response;
}

export function setupAuth(onLoginSuccess) {
    const loginForm = document.getElementById('loginForm');
    const loginView = document.getElementById('loginView');
    const logoutBtn = document.getElementById('logout-btn');
    const moduleSelect = document.getElementById('assetCategory');

    // Auto-login removed as per user request to ensure login page is usable
    /*
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        try {
            const user = JSON.parse(savedUser);
            if (user && user.username) {
                console.log('Found saved session for:', user.username);
                onLoginSuccess(user);
            }
        } catch (e) {
            console.error('Error parsing saved user:', e);
            localStorage.removeItem('currentUser');
        }
    }
    */

    if (loginForm) {
        // Remove existing listener to avoid duplicates
        const newLoginForm = loginForm.cloneNode(true);
        loginForm.parentNode.replaceChild(newLoginForm, loginForm);
        
        // Handle clicks on the form (Event Delegation)
        newLoginForm.addEventListener('click', (e) => {
            // Handle Forgot Password Click
            if (e.target.matches('#forgotPasswordLink')) {
                e.preventDefault();
                console.log('Forgot password link clicked via delegation');
                const modal = document.getElementById('forgotPasswordModal');
                if (modal) modal.style.display = 'block';
            }
        });

        newLoginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = newLoginForm.username.value;
            const password = newLoginForm.password.value;
            const rememberMe = document.getElementById('rememberMe').checked;
            const category = moduleSelect ? moduleSelect.value : 'IT';

            console.log('[Auth] Attempting login:', { username, category, rememberMe });
            console.log('[Auth] Current Cookies before login:', document.cookie);

            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password, category, rememberMe })
                });
                
                console.log('[Auth] Login response status:', response.status);

                if (response.ok) {
                    const payload = await response.json();
                    console.log('[Auth] Login success payload:', payload);
                    console.log('[Auth] Cookies after login:', document.cookie);
                    
                    const user = payload && payload.user ? payload.user : payload;
                    user.category = category;
                    // No longer using localStorage for session persistence, relying on cookie
                    // localStorage.setItem('currentUser', JSON.stringify(user)); 
                    localStorage.setItem('selectedAssetCategory', category);
                    
                    // Handle returnTo logic
                    const returnTo = sessionStorage.getItem('returnTo');
                    if (returnTo) {
                        sessionStorage.removeItem('returnTo');
                        // Restore captured hash/query
                        const url = new URL(returnTo, window.location.origin);
                        if (url.hash) {
                             window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
                        }
                    } else if (window.location.hash) {
                        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
                    }
                    
                    onLoginSuccess(user);
                } else {
                    const error = await response.json();
                    alert(error.message || 'Login failed');
                }
            } catch (err) {
                console.error('Login error:', err);
                alert('An error occurred during login. Please check if the server is running.');
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (err) {
                console.error('Logout error:', err);
            }
            // localStorage.removeItem('currentUser'); // No longer used
            localStorage.removeItem('selectedAssetCategory');
            window.location.href = '/';
        });
    }

    // --- Forgot Password Logic (Global Modal Handling) ---
    const forgotModal = document.getElementById('forgotPasswordModal');
    const closeForgot = document.getElementById('closeForgotModal');
    const forgotForm = document.getElementById('forgotPasswordForm');

    // Close button
    if (closeForgot && forgotModal) {
        closeForgot.addEventListener('click', () => {
            forgotModal.style.display = 'none';
        });
    }

    // Click outside to close - DISABLED as per QoL requirements
    /*
    window.addEventListener('click', (e) => {
        if (e.target === forgotModal) {
            forgotModal.style.display = 'none';
        }
    });
    */

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
                
                const result = await response.json();
                alert(result.message || 'Check your email for reset instructions.');
                forgotModal.style.display = 'none';
            } catch (err) {
                console.error('Forgot password error:', err);
                alert('Failed to process request.');
            } finally {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        });
    }

    // --- Reset Password Logic (URL Handling) ---
    // Check if we are in a reset password flow
    // The token might be in the hash (/#reset-password?token=...) or query (?token=...) depending on routing
    if (window.location.hash.includes('reset-password')) {
        let token = null;
        
        // Try parsing from hash first: #reset-password?token=XYZ
        const hashParts = window.location.hash.split('?');
        if (hashParts.length > 1) {
            const hashParams = new URLSearchParams(hashParts[1]);
            token = hashParams.get('token');
        }
        
        // If not in hash, try normal query params
        if (!token) {
            const urlParams = new URLSearchParams(window.location.search);
            token = urlParams.get('token');
        }

        const resetModal = document.getElementById('resetPasswordModal');
        const resetForm = document.getElementById('resetPasswordForm');
        
        if (token && resetModal) {
            document.getElementById('resetToken').value = token;
            resetModal.style.display = 'block';
            console.log('Reset modal opened for token:', token);
        } else {
            console.warn('Reset password detected but no token found or modal missing');
        }

        if (resetForm) {
            // Remove existing listeners by cloning
            const newResetForm = resetForm.cloneNode(true);
            resetForm.parentNode.replaceChild(newResetForm, resetForm);

            newResetForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const newPass = document.getElementById('newPassword').value;
                const confirmPass = document.getElementById('confirmPassword').value;
                const tokenVal = document.getElementById('resetToken').value;

                if (newPass !== confirmPass) {
                    alert('Passwords do not match!');
                    return;
                }

                const btn = resetForm.querySelector('button');
                btn.disabled = true;
                btn.textContent = 'Resetting...';

                try {
                    const response = await fetch('/api/auth/reset-password', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: tokenVal, newPassword: newPass })
                    });

                    const result = await response.json();
                    if (response.ok) {
                        alert('Password reset successful! Please log in.');
                        resetModal.style.display = 'none';
                        window.location.href = '/'; // Reload to clear URL params
                    } else {
                        alert('Error: ' + result.error);
                    }
                } catch (err) {
                    console.error('Reset error:', err);
                    alert('Failed to reset password.');
                } finally {
                    btn.disabled = false;
                    btn.textContent = 'Set Password';
                }
            });
        }
    }
}
