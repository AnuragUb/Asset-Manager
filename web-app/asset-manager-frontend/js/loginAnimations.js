
/**
 * Login page: cube lid lift, interior light, fireflies, and form reveal.
 */

let loginSaverRaf = 0;
let loginSaverState = null;

function looksLikeInvalidEmail(value) {
    const text = String(value || '').trim();
    if (!text.includes('@')) return false;
    return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

function loginCredentialIssue(username, password) {
    if (!String(username || '').trim() || !String(password || '')) {
        return 'Enter your username/email and password.';
    }
    if (looksLikeInvalidEmail(username)) {
        return 'Enter a valid email address.';
    }
    return '';
}

export function stopLoginButtonSaver() {
    if (loginSaverRaf) {
        cancelAnimationFrame(loginSaverRaf);
        loginSaverRaf = 0;
    }
    const btn = document.getElementById('loginSignInBtn');
    const slot = document.querySelector('.login-sign-slot');
    if (btn) {
        btn.classList.remove('login-button-saver');
        btn.style.left = '';
        btn.style.top = '';
        if (slot && slot.parentNode) slot.replaceWith(btn);
        else if (slot) slot.remove();
    } else if (slot) {
        slot.remove();
    }
    loginSaverState = null;
}

export function startLoginButtonSaver() {
    const btn = document.getElementById('loginSignInBtn');
    if (!btn) return;
    if (loginSaverState) return;

    const rect = btn.getBoundingClientRect();
    if (!document.querySelector('.login-sign-slot')) {
        const slot = document.createElement('div');
        slot.className = 'login-sign-slot';
        slot.style.height = `${Math.max(rect.height, 44)}px`;
        btn.insertAdjacentElement('afterend', slot);
    }
    const room = document.getElementById('loginRoom');
    if (room && btn.parentElement !== room) {
        room.appendChild(btn);
    }

    btn.classList.add('login-button-saver');
    const width = btn.offsetWidth || 168;
    const height = btn.offsetHeight || 44;
    const arena = document.getElementById('loginRoom') || document.getElementById('loginView');
    const box = () => {
        const r = arena ? arena.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
        return {
            minX: r.left,
            minY: r.top,
            maxX: Math.max(r.left, r.left + r.width - width),
            maxY: Math.max(r.top, r.top + r.height - height)
        };
    };
    const startBox = box();
    loginSaverState = {
        x: Math.min(Math.max(rect.left, startBox.minX), startBox.maxX),
        y: Math.min(Math.max(rect.top, startBox.minY), startBox.maxY),
        vx: 2.8,
        vy: 2.2,
        w: width,
        h: height
    };
    btn.style.left = `${loginSaverState.x}px`;
    btn.style.top = `${loginSaverState.y}px`;

    const tick = () => {
        const state = loginSaverState;
        if (!state) return;
        const limits = box();
        state.x += state.vx;
        state.y += state.vy;
        if (state.x <= limits.minX) {
            state.x = limits.minX;
            state.vx = Math.abs(state.vx);
        } else if (state.x >= limits.maxX) {
            state.x = limits.maxX;
            state.vx = -Math.abs(state.vx);
        }
        if (state.y <= limits.minY) {
            state.y = limits.minY;
            state.vy = Math.abs(state.vy);
        } else if (state.y >= limits.maxY) {
            state.y = limits.maxY;
            state.vy = -Math.abs(state.vy);
        }
        btn.style.left = `${state.x}px`;
        btn.style.top = `${state.y}px`;
        loginSaverRaf = requestAnimationFrame(tick);
    };
    loginSaverRaf = requestAnimationFrame(tick);

    if (!btn.dataset.saverPauseBound) {
        btn.dataset.saverPauseBound = '1';
        btn.addEventListener('pointerdown', () => {
            if (loginSaverRaf) {
                cancelAnimationFrame(loginSaverRaf);
                loginSaverRaf = 0;
            }
        });
        btn.addEventListener('pointerup', () => {
            if (loginSaverState && !loginSaverRaf) {
                loginSaverRaf = requestAnimationFrame(tick);
            }
        });
        btn.addEventListener('pointercancel', () => {
            if (loginSaverState && !loginSaverRaf) {
                loginSaverRaf = requestAnimationFrame(tick);
            }
        });
    }
}

function spawnLoginFireflies(container) {
    if (!container || container.dataset.spawned) return;
    container.dataset.spawned = '1';
    const style = document.createElement('style');
    const rules = [];
    for (let i = 0; i < 18; i += 1) {
        const size = (Math.random() * 4 + 3).toFixed(1);
        const duration = (Math.random() * 30 + 35).toFixed(1);
        const delay = (Math.random() * 3).toFixed(2);
        const frames = [];
        for (let s = 0; s < 6; s += 1) {
            frames.push(`${Math.floor(Math.random() * 100)}vw, ${Math.floor(Math.random() * 100)}vh`);
        }
        frames.push(frames[0]);
        const pct = frames.map((xy, idx) => {
            const p = Math.round((idx / (frames.length - 1)) * 100);
            return `${p}% { transform: translate(${xy}); }`;
        }).join(' ');
        rules.push(`@keyframes login-firefly-drift-${i} { ${pct} }`);
        const el = document.createElement('span');
        el.className = 'login-firefly';
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.animationDuration = `${duration}s, 3s`;
        el.style.animationDelay = `${delay}s, ${delay}s`;
        el.style.animationName = `login-firefly-drift-${i}, login-firefly-flicker`;
        container.appendChild(el);
    }
    style.textContent = rules.join('\n');
    document.head.appendChild(style);
}

export function initLoginAnimations() {
    const room = document.getElementById('loginRoom');
    const cube = document.getElementById('loginCubeBtn');
    const fireflies = document.getElementById('loginFireflies');
    if (!room || !cube) return;

    spawnLoginFireflies(fireflies);

    cube.addEventListener('dblclick', (event) => {
        event.preventDefault();
        room.classList.toggle('on');
    });

    const loginForm = document.getElementById('loginForm');
    const signInBtn = document.getElementById('loginSignInBtn');
    if (loginForm) {
        loginForm.addEventListener('submit', (event) => {
            const issue = loginCredentialIssue(loginForm.username && loginForm.username.value, loginForm.password && loginForm.password.value);
            if (!issue) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            const msg = document.getElementById('loginMsg');
            if (msg) msg.textContent = issue;
            startLoginButtonSaver();
        }, true);
    }
    if (signInBtn && loginForm && !signInBtn.dataset.formOwnerBound) {
        signInBtn.dataset.formOwnerBound = '1';
        signInBtn.setAttribute('form', 'loginForm');
        signInBtn.addEventListener('click', (event) => {
            if (loginForm.contains(signInBtn)) return;
            event.preventDefault();
            if (typeof loginForm.requestSubmit === 'function') {
                loginForm.requestSubmit(signInBtn);
            } else {
                loginForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            }
        });
    }
}

/**
 * Initializes the Raul Drunk style module selector
 */
export function initLoginModuleSelector() {
    const container = document.querySelector('.module-selector-container');
    if (!container) return;

    const options = container.querySelectorAll('.module-option');
    const bubbleActive = container.querySelector('.bubble-active');
    const hiddenInput = container.querySelector('#assetCategory');
    const errorMsg = container.querySelector('#moduleError');

    if (!options.length || !bubbleActive || !hiddenInput) return;

    function setActive(element) {
        // Update visual state
        options.forEach(opt => opt.classList.remove('active'));
        element.classList.add('active');

        // Move bubble
        const rect = element.getBoundingClientRect();
        const containerRect = container.querySelector('.module-selector-pill').getBoundingClientRect();
        
        bubbleActive.style.width = `${rect.width}px`;
        bubbleActive.style.left = `${rect.left - containerRect.left}px`; // Relative to container
        bubbleActive.style.opacity = '1';

        // Update value
        hiddenInput.value = element.dataset.value;
        if (errorMsg) errorMsg.style.display = 'none';
    }

    // Add click listeners
    options.forEach(option => {
        option.addEventListener('click', (e) => {
            setActive(e.currentTarget);
        });
    });

    // Initial selection
    if (options[0]) setActive(options[0]);

    // Handle form submission validation (optional hook)
    const form = document.getElementById('loginForm');
    if (form) {
        form.addEventListener('submit', (e) => {
            if (!hiddenInput.value) {
                e.preventDefault();
                if (errorMsg) errorMsg.style.display = 'block';
            }
        });
    }
}

/**
 * Initializes the Sign Up modal interactions
 */
export function initSignupModal() {
    const modal = document.getElementById('signupModal');
    const link = document.getElementById('signupLink');
    const closeBtn = document.getElementById('closeSignupModal');
    const signupForm = document.getElementById('signupForm');
    
    if (!modal || !link || !closeBtn) return;

    // Open modal
    link.addEventListener('click', (e) => {
        e.preventDefault();
        modal.style.display = 'flex';
    });

    // Close modal
    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    // Close on outside click - DISABLED as per QoL requirements
    /*
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
    */

    // Handle form submission
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            // Collect data
            const formData = new FormData(signupForm);
            const data = Object.fromEntries(formData.entries());
            
            const msg = document.getElementById('signupMsg');
            if (data.password !== data.confirmPassword) {
                if (msg) msg.textContent = 'Passwords do not match.';
                else alert('Passwords do not match.');
                return;
            }

            try {
                const response = await fetch('/api/signup', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        email: data.email,
                        name: data.name,
                        password: data.password,
                        confirmPassword: data.confirmPassword,
                        team: data.team
                    })
                });

                const result = await response.json().catch(() => ({}));

                if (response.ok) {
                    alert('Sign up successful! Please sign in.');
                    modal.style.display = 'none';
                    signupForm.reset();
                    if (msg) msg.textContent = '';
                } else {
                    const text = result.message || 'Could not create this account.';
                    if (msg) msg.textContent = text;
                    else alert(text);
                }
            } catch (err) {
                console.error('Signup error:', err);
                if (msg) msg.textContent = 'An error occurred during sign up. Please try again.';
                else alert('An error occurred during sign up. Please try again.');
            }
        });
    }
}
