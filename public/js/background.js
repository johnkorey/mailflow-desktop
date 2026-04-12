// ===== Background Image (Appearance preference) =====
// Stored in localStorage so it survives restarts. Image is a data URL, capped
// at ~3 MB to stay under the localStorage quota.
// Depends on: app.js (showToast)

const BG_IMAGE_KEY = 'appearance:bgImage';
const BG_DIM_KEY = 'appearance:bgDim';
const BG_BLUR_KEY = 'appearance:bgBlur';
const BG_CLEARED_KEY = 'appearance:bgCleared'; // set when user explicitly opted out of the default
const BG_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
// Built-in default wallpaper that ships with MailFlow. Used when the user
// hasn't uploaded their own image and hasn't explicitly cleared the background.
const BG_DEFAULT_URL = 'img/backgrounds/mailflow-hero.svg';

/**
 * Resolve which background image to show right now.
 *   - User upload wins if present.
 *   - Otherwise, the bundled default wallpaper, unless the user explicitly
 *     cleared it (then nothing).
 */
function resolveBackgroundSource() {
    const userImg = localStorage.getItem(BG_IMAGE_KEY);
    if (userImg) return userImg;
    if (localStorage.getItem(BG_CLEARED_KEY) === '1') return null;
    return BG_DEFAULT_URL;
}

/**
 * Apply the current saved background to <body>. Called on app boot and
 * whenever the user uploads/clears the image or changes dim/blur.
 */
function applyBackgroundImage() {
    const img = resolveBackgroundSource();
    const dimPct = Number(localStorage.getItem(BG_DIM_KEY) ?? 75);
    const blurPx = Number(localStorage.getItem(BG_BLUR_KEY) ?? 0);

    document.body.style.setProperty('--bg-dim', (dimPct / 100).toFixed(2));
    document.body.style.setProperty('--bg-blur', `${blurPx}px`);

    if (img) {
        document.body.style.backgroundImage = `url("${img}")`;
        document.body.classList.add('has-bg-image');
    } else {
        document.body.style.backgroundImage = '';
        document.body.classList.remove('has-bg-image');
    }
}

/**
 * Populate the Appearance card controls from localStorage. Called when the
 * user navigates to the Account page.
 */
function loadBackgroundSettings() {
    const resolved = resolveBackgroundSource();
    const isCustom = !!localStorage.getItem(BG_IMAGE_KEY);
    const dimPct = Number(localStorage.getItem(BG_DIM_KEY) ?? 75);
    const blurPx = Number(localStorage.getItem(BG_BLUR_KEY) ?? 0);

    const dimInput = document.getElementById('bgDimInput');
    const dimValue = document.getElementById('bgDimValue');
    const blurInput = document.getElementById('bgBlurInput');
    const blurValue = document.getElementById('bgBlurValue');
    const preview = document.getElementById('bgPreview');
    const status = document.getElementById('bgStatusLabel');

    if (dimInput) dimInput.value = dimPct;
    if (dimValue) dimValue.textContent = `${dimPct}%`;
    if (blurInput) blurInput.value = blurPx;
    if (blurValue) blurValue.textContent = `${blurPx}px`;

    if (preview) {
        if (resolved) {
            preview.style.backgroundImage = `url("${resolved}")`;
            preview.classList.add('has-image');
        } else {
            preview.style.backgroundImage = '';
            preview.classList.remove('has-image');
        }
    }

    if (status) {
        if (isCustom) {
            status.textContent = 'Using your uploaded image';
        } else if (resolved) {
            status.textContent = 'Using the built-in MailFlow wallpaper';
        } else {
            status.textContent = 'No background image';
        }
    }

    // The Remove Background button is contextual — its label changes based on
    // current state so the user always knows what clicking will do.
    const clearBtn = document.getElementById('bgClearBtn');
    if (clearBtn) {
        if (isCustom) {
            clearBtn.textContent = 'Restore Default Wallpaper';
        } else if (resolved) {
            clearBtn.textContent = 'Hide Background';
        } else {
            clearBtn.textContent = 'Restore Default Wallpaper';
        }
    }
}

function handleBackgroundImageUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast('Please choose an image file', 'error');
        return;
    }
    if (file.size > BG_IMAGE_MAX_BYTES) {
        showToast(`Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 3 MB.`, 'error');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = e.target.result;
        try {
            localStorage.setItem(BG_IMAGE_KEY, dataUrl);
            localStorage.removeItem(BG_CLEARED_KEY);
        } catch (err) {
            showToast('Image is too large to store. Try a smaller file.', 'error');
            event.target.value = '';
            return;
        }
        applyBackgroundImage();
        loadBackgroundSettings();
        showToast('Background updated', 'success');
        event.target.value = '';
    };
    reader.onerror = () => showToast('Failed to read image', 'error');
    reader.readAsDataURL(file);
}

// Slider events fire continuously while dragging — write to localStorage on a
// debounce to avoid hundreds of synchronous writes per drag, and apply only the
// cheap CSS-variable overlay (not the full background-image URL) for instant
// visual feedback.
let bgPersistTimer = null;
function persistBgSettingDebounced(key, value) {
    bgPersistTimer && clearTimeout(bgPersistTimer);
    bgPersistTimer = setTimeout(() => {
        try { localStorage.setItem(key, String(value)); } catch {}
    }, 150);
}

function applyBackgroundOverlay(dimPct, blurPx) {
    document.body.style.setProperty('--bg-dim', (dimPct / 100).toFixed(2));
    document.body.style.setProperty('--bg-blur', `${blurPx}px`);
}

function handleBackgroundDimChange(event) {
    const value = Number(event.target.value);
    const blur = Number(localStorage.getItem(BG_BLUR_KEY) ?? 0);
    applyBackgroundOverlay(value, blur);
    persistBgSettingDebounced(BG_DIM_KEY, value);
    const label = document.getElementById('bgDimValue');
    if (label) label.textContent = `${value}%`;
}

function handleBackgroundBlurChange(event) {
    const value = Number(event.target.value);
    const dim = Number(localStorage.getItem(BG_DIM_KEY) ?? 75);
    applyBackgroundOverlay(dim, value);
    persistBgSettingDebounced(BG_BLUR_KEY, value);
    const label = document.getElementById('bgBlurValue');
    if (label) label.textContent = `${value}px`;
}

/**
 * "Remove Background" / "Reset to Default" three-state flow:
 *   - If the user has a custom upload → remove it, revert to built-in default.
 *   - If currently on the built-in default → hide it entirely (plain theme).
 *   - If already hidden → restore the built-in default.
 */
function clearBackgroundImage() {
    const hasCustom = !!localStorage.getItem(BG_IMAGE_KEY);
    const isCleared = localStorage.getItem(BG_CLEARED_KEY) === '1';

    if (hasCustom) {
        if (!confirm('Remove your uploaded image and restore the MailFlow default wallpaper?')) return;
        localStorage.removeItem(BG_IMAGE_KEY);
        localStorage.removeItem(BG_CLEARED_KEY);
        showToast('Restored MailFlow default wallpaper', 'success');
    } else if (!isCleared) {
        if (!confirm('Hide the background wallpaper? You can restore it anytime.')) return;
        localStorage.setItem(BG_CLEARED_KEY, '1');
        showToast('Background hidden', 'success');
    } else {
        localStorage.removeItem(BG_CLEARED_KEY);
        showToast('Restored MailFlow default wallpaper', 'success');
    }

    applyBackgroundImage();
    loadBackgroundSettings();
}

// Apply the saved background as soon as the script loads so there's no flash
// of the default background on app startup.
applyBackgroundImage();
