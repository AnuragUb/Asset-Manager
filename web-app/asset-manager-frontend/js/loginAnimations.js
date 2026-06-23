
/**
 * Login Page Animations
 * Handles dynamic background image switching and other visual effects
 */

const backgroundImages = [
    '/static/img/login/pexels-33205297-7042926.jpg',
    '/static/img/login/pexels-maksim-smirnov-27565989-32234331.jpg',
    '/static/img/login/pexels-maksim-smirnov-27565989-32234335.jpg',
    '/static/img/login/pexels-miroslav-glasa-2147620119-29678804.jpg'
];

export function initLoginAnimations() {
    const overlay = document.querySelector('.login-bg-overlay');
    if (!overlay) return;

    let currentIndex = 0;

    // Preload images to prevent flickering
    backgroundImages.forEach(url => {
        const img = new Image();
        img.src = url;
    });

    // Set initial image
    overlay.style.backgroundImage = `url('${backgroundImages[0]}')`;
    overlay.style.opacity = '1'; // Ensure full visibility

    // Change image every 5 seconds
    setInterval(() => {
        currentIndex = (currentIndex + 1) % backgroundImages.length;
        const nextImage = backgroundImages[currentIndex];
        
        // Create a temporary overlay for smooth crossfade
        const tempOverlay = document.createElement('div');
        tempOverlay.style.position = 'absolute';
        tempOverlay.style.top = '0';
        tempOverlay.style.left = '0';
        tempOverlay.style.width = '100%';
        tempOverlay.style.height = '100%';
        tempOverlay.style.backgroundImage = `url('${nextImage}')`;
        tempOverlay.style.backgroundSize = 'cover';
        tempOverlay.style.backgroundPosition = 'center';
        tempOverlay.style.opacity = '0';
        tempOverlay.style.transition = 'opacity 1s ease-in-out';
        tempOverlay.style.zIndex = '-1'; // Behind the content but above the base
        
        overlay.appendChild(tempOverlay);
        
        // Trigger reflow
        void tempOverlay.offsetWidth;
        
        // Fade in
        tempOverlay.style.opacity = '0';
        
        // After transition, set main overlay and remove temp
        setTimeout(() => {
            overlay.style.backgroundImage = `url('${nextImage}')`;
            tempOverlay.remove();
        }, 1000);
        
    }, 5000);
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
            
            // Validate passwords match
            if (data.password !== data.confirmPassword) {
                alert('Passwords do not match!');
                return;
            }

            console.log('Signup attempt:', data.username);
            
            try {
                const response = await fetch('/api/signup', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        username: data.username,
                        password: data.password,
                        email: data.email,
                        employeeId: data.employeeId
                    })
                });

                const result = await response.json();

                if (response.ok) {
                    alert('Sign up successful! Please log in.');
                    modal.style.display = 'none';
                    signupForm.reset();
                } else {
                    alert('Sign up failed: ' + (result.message || 'Unknown error'));
                }
            } catch (err) {
                console.error('Signup error:', err);
                alert('An error occurred during sign up. Please try again.');
            }
        });
    }
}
