/**
 * auth.js
 * Manages user login, session persistence, and module selection
 * Version: 4.0
 */

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
        
        newLoginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = newLoginForm.username.value;
            const password = newLoginForm.password.value;
            const category = moduleSelect ? moduleSelect.value : 'IT';

            console.log('Attempting login for:', username, 'Category:', category);

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password, category })
                });

                if (response.ok) {
                    const user = await response.json();
                    user.category = category; // Ensure category is attached
                    localStorage.setItem('currentUser', JSON.stringify(user));
                    localStorage.setItem('selectedAssetCategory', category);
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
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('currentUser');
            localStorage.removeItem('selectedAssetCategory');
            window.location.reload();
        });
    }
}
