/**
 * Generate the NSIS installer BMP assets from the existing logo.
 *
 * Outputs:
 *   build/installerHeader.bmp     150 x 57   — top banner on wizard pages
 *   build/installerSidebar.bmp    164 x 314  — Welcome / Finish sidebar
 *   build/uninstallerSidebar.bmp  164 x 314  — same image, used by uninstaller
 *
 * Visual style: deep navy background matching the app titlebar (#11111c),
 * with the MailFlow logo centered and a subtle purple accent. No external
 * fonts or libraries beyond `jimp` (already in devDependencies).
 *
 * Run with:  node scripts/generate-installer-assets.cjs
 * Or via the build:  npm run build:assets
 */

const path = require('path');
const fs = require('fs');
const { Jimp, ResizeStrategy } = require('jimp');

const PROJECT_ROOT = path.join(__dirname, '..');
const LOGO_PATH = path.join(PROJECT_ROOT, 'public', 'img', 'logo.png');
const BUILD_DIR = path.join(PROJECT_ROOT, 'build');

// Brand colors — match the app's CSS variables
const BG_NAVY = 0x11111cff;        // var(--bg-1)
const BG_NAVY_LIGHTER = 0x18182aff; // var(--bg-2)
const ACCENT = 0x8b5cf6ff;          // var(--accent)
const ACCENT_DARK = 0x6d28d9ff;     // var(--accent-active)

/**
 * Build a vertical gradient image (top → bottom).
 */
async function gradientBg(width, height, topColor, bottomColor) {
    const img = new Jimp({ width, height, color: topColor });
    const topR = (topColor >>> 24) & 0xff;
    const topG = (topColor >>> 16) & 0xff;
    const topB = (topColor >>> 8) & 0xff;
    const botR = (bottomColor >>> 24) & 0xff;
    const botG = (bottomColor >>> 16) & 0xff;
    const botB = (bottomColor >>> 8) & 0xff;

    for (let y = 0; y < height; y++) {
        const t = y / (height - 1);
        const r = Math.round(topR + (botR - topR) * t);
        const g = Math.round(topG + (botG - topG) * t);
        const b = Math.round(topB + (botB - topB) * t);
        const color = (r << 24) | (g << 16) | (b << 8) | 0xff;
        for (let x = 0; x < width; x++) {
            img.setPixelColor(color >>> 0, x, y);
        }
    }
    return img;
}

/**
 * Composite a soft accent bar at a specific position (used as a brand stripe).
 */
function drawStripe(img, x, y, width, height, color) {
    for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
            const px = x + dx;
            const py = y + dy;
            if (px >= 0 && py >= 0 && px < img.bitmap.width && py < img.bitmap.height) {
                img.setPixelColor(color >>> 0, px, py);
            }
        }
    }
}

async function generateHeader() {
    // 150 x 57 — small banner shown on every wizard page after Welcome
    const W = 150, H = 57;
    const bg = await gradientBg(W, H, BG_NAVY, BG_NAVY_LIGHTER);

    // Accent stripe at the bottom edge
    drawStripe(bg, 0, H - 2, W, 2, ACCENT);

    // Load and shrink the logo to fit on the right side
    const logo = await Jimp.read(LOGO_PATH);
    logo.resize({ w: 38, h: 38, mode: ResizeStrategy.BICUBIC });

    // Place logo on the right with vertical centering
    const logoX = W - 38 - 10;
    const logoY = Math.round((H - 38) / 2);
    bg.composite(logo, logoX, logoY);

    const outPath = path.join(BUILD_DIR, 'installerHeader.bmp');
    await bg.write(outPath);
    console.log('  ✓ Wrote', path.relative(PROJECT_ROOT, outPath), `(${W}x${H})`);
}

async function generateSidebar(filename) {
    // 164 x 314 — tall left sidebar shown on Welcome and Finish pages
    const W = 164, H = 314;
    const bg = await gradientBg(W, H, BG_NAVY, BG_NAVY_LIGHTER);

    // Accent stripe down the right edge (subtle brand line)
    drawStripe(bg, W - 3, 0, 3, H, ACCENT);

    // Soft accent glow rectangle behind the logo
    const glowSize = 110;
    const glowX = Math.round((W - glowSize) / 2);
    const glowY = 60;
    drawStripe(bg, glowX, glowY, glowSize, glowSize, 0x231a4044); // semi-transparent purple wash

    // Load and resize the logo (target ~96 px square, centered horizontally)
    const logo = await Jimp.read(LOGO_PATH);
    logo.resize({ w: 96, h: 96, mode: ResizeStrategy.BICUBIC });
    const logoX = Math.round((W - 96) / 2);
    const logoY = 67;
    bg.composite(logo, logoX, logoY);

    // A second accent stripe near the bottom under where text would go
    drawStripe(bg, 24, H - 60, W - 48, 2, ACCENT_DARK);

    const outPath = path.join(BUILD_DIR, filename);
    await bg.write(outPath);
    console.log('  ✓ Wrote', path.relative(PROJECT_ROOT, outPath), `(${W}x${H})`);
}

(async () => {
    console.log('[InstallerAssets] Generating NSIS BMP assets…');

    if (!fs.existsSync(LOGO_PATH)) {
        console.error('[InstallerAssets] Source logo missing:', LOGO_PATH);
        process.exit(1);
    }
    if (!fs.existsSync(BUILD_DIR)) {
        fs.mkdirSync(BUILD_DIR, { recursive: true });
    }

    try {
        await generateHeader();
        await generateSidebar('installerSidebar.bmp');
        await generateSidebar('uninstallerSidebar.bmp');
        console.log('[InstallerAssets] Done.');
    } catch (err) {
        console.error('[InstallerAssets] Failed:', err);
        process.exit(1);
    }
})();
