// ===== Global State =====
let currentUser = null;

// ===== API Helper =====
async function api(endpoint, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    try {
        const response = await fetch(`/api${endpoint}`, {
            ...options,
            headers,
            cache: 'no-store'
        });

        return handleResponse(response);
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

async function handleResponse(response) {
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || 'Request failed');
    }

    return data;
}

// ===== Toast Notifications =====
function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'i'
    };

    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-content">${message}</span>
    `;

    container.appendChild(toast);

    if (type === 'success') {
        triggerMiniCelebration();
    }

    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function triggerMiniCelebration() {
    const colors = ['#7c3aed', '#ec4899', '#22c55e', '#f97316', '#0ea5e9'];
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);

    for (let i = 0; i < 20; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.animationDelay = Math.random() * 0.5 + 's';
        confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
        container.appendChild(confetti);
    }

    setTimeout(() => container.remove(), 3000);
}

function triggerFullCelebration() {
    const colors = ['#7c3aed', '#ec4899', '#22c55e', '#f97316', '#0ea5e9', '#eab308'];
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);

    for (let i = 0; i < 100; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.width = (Math.random() * 10 + 5) + 'px';
        confetti.style.height = (Math.random() * 10 + 5) + 'px';
        confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.animationDuration = (Math.random() * 2 + 2) + 's';
        confetti.style.animationDelay = Math.random() * 1 + 's';
        container.appendChild(confetti);
    }

    setTimeout(() => container.remove(), 5000);
}

// ===== Init =====
async function initApp() {
    try {
        const data = await api('/auth/me');
        currentUser = data.user;
    } catch (error) {
        console.error('Failed to load user:', error);
    }
}
