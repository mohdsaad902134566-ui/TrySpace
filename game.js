/**
 * DON'T TOUCH RED
 * Main Game Logic
 */

// --- CONFIGURATION ---
// Global tuning values shared by the game loop, obstacle spawning and HUD logic.
const CONFIG = {
    playerSize: 30,
    playerSpeed: 300, // pixels per second
    obstacleSpeedBase: 180, // starting speed
    coinValue: 10,
    nearMissValue: 25,
    shieldDuration: 5, // seconds
    maxDifficulty: 5,
    nearMissDistance: 40 // distance for near miss points
};

// --- GAME STATE ---
// All supported game states used to gate updates, input and screen visibility.
const STATES = {
    MENU: 0,
    PLAYING: 1,
    PAUSED: 2,
    GAME_OVER: 3,
    HOW_TO_PLAY: 4,
    SETTINGS: 5
};

// Current game screen state.
let gameState = STATES.MENU;
// Current score during the active run.
let score = 0;
// Highest score saved across sessions.
let bestScore = 0;
// Coins collected in gameplay and spent in the shop.
let coins = 0;
// Time survived in seconds, used to raise difficulty.
let survivalTime = 0; // in seconds
// Current difficulty multiplier for obstacle speed and spawn rate.
let difficulty = 1;
// Last frame timestamp for delta-time based movement.
let lastTime = 0;
// Time remaining until the next obstacle spawn.
let spawnTimer = 0;
// Delay before the next obstacle is created.
let nextSpawnInterval = 1500; // ms

// Settings
// Sound toggled by the settings menu.
let soundEnabled = true;
// Vibration toggled by the settings menu.
let vibrationEnabled = true;

// --- CANVAS SETUP ---
// Canvas is the main drawing surface for the game world.
const canvas = document.getElementById('game-canvas');
// 2D context used for drawing the rocket, obstacles, pickups and text.
const ctx = canvas.getContext('2d', { alpha: false }); // Optimize for no transparency on base canvas
let vw = window.innerWidth;
let vh = window.innerHeight;

function resizeCanvas() {
    vw = window.innerWidth;
    vh = window.innerHeight;
    canvas.width = vw;
    canvas.height = vh;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- LOCAL STORAGE ---
// Save and load player progress such as coins, ammo, best score, purchased unlocks and settings.
function loadData() {
    const sBest = localStorage.getItem('dtr_best');
    const sCoins = localStorage.getItem('dtr_coins');
    const sAmmo = localStorage.getItem('dtr_ammo');
    const sAmmoCapacity = localStorage.getItem('dtr_ammo_capacity');
    const sSound = localStorage.getItem('dtr_sound');
    const sVib = localStorage.getItem('dtr_vibration');
    const sRockets = localStorage.getItem('dtr_rockets');
    const sSelectedRocket = localStorage.getItem('dtr_selected_rocket');

    const safeInt = (value, fallback) => {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    bestScore = safeInt(sBest, 0);
    coins = Math.max(0, safeInt(sCoins, 0));
    ammoCapacity = Math.max(5, Math.min(maxAmmoStorage, safeInt(sAmmoCapacity, maxAmmo) || maxAmmo));
    ammo = Math.max(0, Math.min(ammoCapacity, safeInt(sAmmo, 5) || 5));
    soundEnabled = sSound !== null ? sSound === 'true' : true;
    vibrationEnabled = sVib !== null ? sVib === 'true' : true;
    if (sRockets) {
        try {
            const saved = JSON.parse(sRockets);
            Object.keys(rockets).forEach((key) => {
                rockets[key].unlocked = !!(saved && saved[key] && saved[key].unlocked === true);
            });
        } catch (e) {
            console.warn('Invalid rocket save data; resetting rocket state.');
        }
    }
    const sShield = localStorage.getItem('dtr_shield');

    if (sSelectedRocket && rockets[sSelectedRocket] && rockets[sSelectedRocket].unlocked) {
        selectedRocket = sSelectedRocket;
    } else {
        selectedRocket = 'classic';
    }
    extraLife = 0;
    shield = sShield === 'true';
    if (!rockets.classic.unlocked) rockets.classic.unlocked = true;
    if (!rockets[selectedRocket] || !rockets[selectedRocket].unlocked) selectedRocket = 'classic';
    
    updateSettingsUI();
    updateHUD();
    updateDefenseHUD();
    if (document.getElementById('shop-rocket-list')) updateShopUI();
}

// Saves the active player's progress to localStorage.
function saveData() {
    ammo = Math.max(0, Math.min(ammoCapacity, ammo));
    localStorage.setItem('dtr_best', bestScore);
    localStorage.setItem('dtr_coins', coins);
    localStorage.setItem('dtr_ammo', ammo);
    localStorage.setItem('dtr_ammo_capacity', ammoCapacity);
    localStorage.setItem('dtr_sound', soundEnabled);
    localStorage.setItem('dtr_vibration', vibrationEnabled);
    localStorage.setItem('dtr_rockets', JSON.stringify(rockets));
    localStorage.setItem('dtr_selected_rocket', selectedRocket);
    localStorage.setItem('dtr_shield', shield);
}

// Exposed save helper kept for the existing UI flow.
function saveGameData() {
    saveData();
}

// Exposed load helper kept for the existing UI flow.
function loadGameData() {
    loadData();
}

// --- AUDIO (Synthetic Fallback) ---
// Simple synthetic sounds for coin pickups, hits and button clicks.
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx;

function initAudio() {
    if (!audioCtx) {
        try {
            audioCtx = new AudioContext();
        } catch(e) {
            console.warn("Web Audio API not supported");
        }
    }
}

function playSound(type) {
    if (!soundEnabled || !audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    const now = audioCtx.currentTime;
    
    switch(type) {
        case 'coin':
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, now);
            osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now);
            osc.stop(now + 0.1);
            break;
        case 'powerup':
            osc.type = 'square';
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.linearRampToValueAtTime(800, now + 0.2);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.linearRampToValueAtTime(0.01, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
            break;
        case 'hit':
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.exponentialRampToValueAtTime(40, now + 0.3);
            gain.gain.setValueAtTime(0.5, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
            break;
        case 'nearmiss':
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(600, now);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now);
            osc.stop(now + 0.1);
            break;
        case 'click':
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, now);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
            osc.start(now);
            osc.stop(now + 0.05);
            break;
    }
}

// --- VIBRATION ---
// Short vibration feedback for supported devices.
function vibrate(duration) {
    if (vibrationEnabled && navigator.vibrate) {
        try {
            navigator.vibrate(duration);
        } catch(e) {}
    }
}

// --- INPUT HANDLING ---
// Tracks the currently desired horizontal movement from keyboard and touch controls.
const input = { left: false, right: false };
// Keyboard direction state for A/D and arrow keys.
const keys = { left: false, right: false };
// Mobile hold-state used by the visible left/right buttons.
const mobileMovement = { left: false, right: false };

// Combines keyboard and touch states into a single movement input.
function syncMovementState() {
    const leftHeld = keys.left || mobileMovement.left;
    const rightHeld = keys.right || mobileMovement.right;

    if (leftHeld && !rightHeld) {
        input.left = true;
        input.right = false;
    } else if (rightHeld && !leftHeld) {
        input.left = false;
        input.right = true;
    } else {
        input.left = false;
        input.right = false;
    }
}

// Named movement functions — keyboard and touch both call these same functions.
// Moves the rocket left without changing the underlying movement system.
function movePlayerLeft() {
    input.left = true;
    input.right = false;
}
// Moves the rocket right without changing the underlying movement system.
function movePlayerRight() {
    input.left = false;
    input.right = true;
}

// Clears all horizontal movement input.
function stopMoving() {
    input.left = false;
    input.right = false;
}

// --- POINTER / TOUCH STATE ---
// Pointer state used by the full-screen touch controls and swipe handling.
let pointerDown = false;
let pointerStartX = 0;
let lastSwipeDir = 0; // -1 = left, 1 = right, 0 = none — used to avoid re-triggering same direction

// Apply touch-action directly on canvas so the browser never intercepts swipes.
canvas.style.touchAction = 'none';

// --- KEYBOARD CONTROLS ---
// Desktop movement: A/D and arrow keys steer the rocket while playing.
window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') keys.left  = true;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = true;

    if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        fireBullet();
    }

    if (!pointerDown) {
        syncMovementState();
    }

    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if      (gameState === STATES.PLAYING) pauseGame();
        else if (gameState === STATES.PAUSED)  resumeGame();
    }
});

window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') keys.left  = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;

    if (!pointerDown) {
        syncMovementState();
    }
});

// --- TOUCH / POINTER EVENT HANDLERS ---
// Mobile touch and pointer controls are handled here without changing the existing movement logic.

/**
 * handlePointerDown — called on touchstart / mousedown on the canvas.
 * Immediately moves the player based on which half of the screen was tapped.
 */
function handlePointerDown(e) {
    // Only respond during active gameplay.
    // Ignore canvas touches while a visible mobile button is already controlling the move state.
    if (gameState !== STATES.PLAYING || mobileMovement.left || mobileMovement.right) return;
    e.preventDefault();

    pointerDown = true;
    lastSwipeDir = 0;

    // Use bounding rect so position is correct even when canvas is scaled/centred
    const rect = canvas.getBoundingClientRect();
    const touchX = e.clientX - rect.left;
    const halfWidth = rect.width / 2;

    pointerStartX = e.clientX; // Store raw clientX for swipe delta

    // Immediate left / right response
    if (touchX < halfWidth) {
        movePlayerLeft();
    } else {
        movePlayerRight();
    }
}

/**
 * handleSwipe — called on pointermove.
 * Detects horizontal swipe direction and switches player direction accordingly.
 * Re-anchors start position when direction changes to stay responsive.
 */
function handleSwipe(e) {
    if (gameState !== STATES.PLAYING || !pointerDown || mobileMovement.left || mobileMovement.right) return;
    e.preventDefault();

    const diff = e.clientX - pointerStartX;
    const SWIPE_THRESHOLD = 20; // px — minimum horizontal distance to count as a swipe

    if (Math.abs(diff) > SWIPE_THRESHOLD) {
        const dir = diff < 0 ? -1 : 1;

        if (dir === -1) {
            movePlayerLeft();
        } else {
            movePlayerRight();
        }

        // Re-anchor so the player can immediately swipe back the other way
        if (dir !== lastSwipeDir) {
            pointerStartX = e.clientX;
            lastSwipeDir  = dir;
        }
    }
}

/**
 * handlePointerUp — called on touchend / mouseup.
 * Stops movement so the player doesn't drift after finger is lifted.
 */
function handlePointerUp(e) {
    e.preventDefault();
    pointerDown   = false;
    lastSwipeDir  = 0;
    if (!mobileMovement.left && !mobileMovement.right) {
        stopMoving();
    }
}

// Register all pointer event listeners on the canvas.
canvas.addEventListener('pointerdown',   handlePointerDown,  { passive: false });
canvas.addEventListener('pointermove',   handleSwipe,        { passive: false });
canvas.addEventListener('pointerup',     handlePointerUp,    { passive: false });
canvas.addEventListener('pointercancel', handlePointerUp,    { passive: false }); // e.g. notification shade

// Prevent context menu on long-press (mobile browsers).
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Updates the pressed state for the visible mobile left/right buttons.
function setMobileMoveState(direction, pressed) {
    const leftButton = document.getElementById('btn-mobile-left');
    const rightButton = document.getElementById('btn-mobile-right');

    if (direction === 'left') {
        mobileMovement.left = pressed;
        if (leftButton) leftButton.classList.toggle('is-pressed', pressed);
    }
    if (direction === 'right') {
        mobileMovement.right = pressed;
        if (rightButton) rightButton.classList.toggle('is-pressed', pressed);
    }

    if (pressed && gameState !== STATES.PLAYING) {
        return;
    }

    syncMovementState();
}

// Starts continuous movement while the left or right mobile button is held.
function handleMobileMoveStart(direction) {
    if (gameState !== STATES.PLAYING) return;
    setMobileMoveState(direction, true);
    if (direction === 'left') movePlayerLeft();
    if (direction === 'right') movePlayerRight();
}

// Stops the relevant side when the finger is released or leaves the button.
function handleMobileMoveEnd(direction) {
    setMobileMoveState(direction, false);
    if (!mobileMovement.left && !mobileMovement.right && !keys.left && !keys.right) {
        stopMoving();
    } else {
        syncMovementState();
    }
}

// Visible MOBILE LEFT button and MOBILE RIGHT button. These use pointer events to control the existing movement logic.
const mobileLeftButton = document.getElementById('leftBtn') || document.getElementById('btn-mobile-left');
const mobileRightButton = document.getElementById('rightBtn') || document.getElementById('btn-mobile-right');

if (mobileLeftButton) {
    // pointerdown: start moving left while pressed.
    mobileLeftButton.addEventListener('pointerdown', (e) => {
        e.preventDefault();
    e.stopPropagation();
    handleMobileMoveStart('left');
});
// pointerup: stop moving left when the finger is lifted.
mobileLeftButton.addEventListener('pointerup', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleMobileMoveEnd('left');
});
// pointercancel: stop movement if the system cancels the touch.
mobileLeftButton.addEventListener('pointercancel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleMobileMoveEnd('left');
});
// pointerleave: stop movement if the touch leaves the button area.
mobileLeftButton.addEventListener('pointerleave', (e) => {
    if (e.pressure > 0 || e.pointerType === 'touch') {
        e.preventDefault();
        e.stopPropagation();
        handleMobileMoveEnd('left');
    }
});
}

if (mobileRightButton) {
// pointerdown: start moving right while pressed.
mobileRightButton.addEventListener('pointerdown', (e) => {
        e.preventDefault();
    e.stopPropagation();
    handleMobileMoveStart('right');
});
// pointerup: stop moving right when the finger is lifted.
mobileRightButton.addEventListener('pointerup', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleMobileMoveEnd('right');
});
// pointercancel: stop movement if the system cancels the touch.
mobileRightButton.addEventListener('pointercancel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleMobileMoveEnd('right');
});
// pointerleave: stop movement if the touch leaves the button area.
mobileRightButton.addEventListener('pointerleave', (e) => {
    if (e.pressure > 0 || e.pointerType === 'touch') {
        e.preventDefault();
        e.stopPropagation();
        handleMobileMoveEnd('right');
    }
});
}

// --- ENTITIES ---
// Player data, movement bounds and visual state for the rocket.
const player = {
    x: 0,
    y: 0,
    size: CONFIG.playerSize,
    color: '#ffffff',
    shieldActive: false,
    shieldTimer: 0,
    invulnerableTimer: 0,

    // Rocket visual dimensions (visual only — collision uses smaller box)
    rocketWidth: 36,
    rocketHeight: 50,

    // Animation state
    tilt: 0,            // current tilt in radians (negative = left, positive = right)
    hoverOffset: 0,     // subtle vertical bobbing offset
    hoverPhase: 0,      // phase counter for hover sine wave
    flameFlicker: 0     // randomised flame length multiplier
};

// Current red obstacles on screen.
let obstacles = [];
// Active bullets fired by the player.
let bullets = [];
// Coins and shield pickups in the arena.
let pickups = []; // coins and powerups
// Floating score text effects.
let particles = []; // Floating text for score
// Maximum bullets the player can carry at once.
const maxAmmo = 15;
// Maximum bullets that can be stored across upgrades.
const maxAmmoStorage = 30;
// Current number of bullets available to fire.
let ammo = 5;
// Current maximum ammo capacity after upgrades.
let ammoCapacity = maxAmmo;
// Available rocket styles. These are cosmetic and do not change gameplay.
const rockets = {
    classic: { name: 'CLASSIC', price: 0, unlocked: true },
    blue: { name: 'BLUE', price: 50, unlocked: false },
    green: { name: 'GREEN', price: 100, unlocked: false },
    purple: { name: 'PURPLE', price: 200, unlocked: false },
    fire: { name: 'FIRE', price: 350, unlocked: false },
    galaxy: { name: 'GALAXY ROCKET', price: 2500, unlocked: false },
    gold: { name: 'GOLDEN ROCKET', price: 5000, unlocked: false },
    titan: { name: 'COSMIC TITAN', price: 10000, unlocked: false }
};
// Currently selected rocket style for the active run.
let selectedRocket = 'classic';
// Temporary run-only reward; the player gets at most one extra life per run.
let extraLife = 0;
// Reward inventory: at most one shield can be carried at a time.
let shield = false;
let extraLifeRewardInFlight = false;
// Prevent double-processing the same shop action while a purchase/equip update is in-flight.
let shopActionLocked = false;

function updateDefenseHUD() {
    const lifeEl = document.getElementById('hud-life');
    if (lifeEl) {
        lifeEl.classList.toggle('hidden', extraLife <= 0);
        lifeEl.textContent = `❤️ LIFE: ${extraLife}`;
    }

    const shieldEl = document.getElementById('hud-shield');
    if (shieldEl) {
        const shieldAvailable = Boolean(shield || player.shieldActive);
        shieldEl.classList.toggle('hidden', !shieldAvailable);
        if (player.shieldActive) {
            shieldEl.textContent = `🛡️ SHIELD: ${Math.ceil(player.shieldTimer)}s`;
        } else if (shield) {
            shieldEl.textContent = '🛡️ SHIELD';
        }
    }
}

// --- GAME LOGIC ---
// Reset the board to a clean new run without changing stored progression.
function resetGame() {
    extraLife = 0;
    extraLifeRewardInFlight = false;
    player.x = vw / 2;
    player.y = vh - 100;
    player.shieldActive = false;
    player.shieldTimer = 0;
    player.invulnerableTimer = 0;
    player.tilt = 0;
    player.hoverOffset = 0;
    player.hoverPhase = 0;
    player.flameFlicker = 1;
    
    obstacles = [];
    bullets = [];
    pickups = [];
    particles = [];
    
    ammo = Math.max(0, Math.min(ammoCapacity, ammo));
    score = 0;
    survivalTime = 0;
    difficulty = 1;
    spawnTimer = 0;
    
    updateHUD();
    updateDefenseHUD();
}

// Spawns the next obstacle based on the current difficulty and a simple probability mix.
function spawnObstacle() {
    const roll = Math.random();
    let width, height, speedY, speedX = 0;
    let obsType = 'block';
    
    // Difficulty curve logic.
    // Difficulty rises with survival time, which increases obstacle speed and frequency.
    const curSpeed = CONFIG.obstacleSpeedBase * difficulty;

    const isSpawnFair = (candidateX, candidateY, candidateW, candidateH) => {
        const safeTop = player.y - 90;
        const safeBottom = player.y + 90;
        const tooCloseToRocket = candidateY + candidateH > safeTop && candidateY < safeBottom;
        if (tooCloseToRocket) return false;

        for (const existing of obstacles) {
            const left = existing.x;
            const right = existing.x + existing.width;
            const top = existing.y;
            const bottom = existing.y + existing.height;
            const overlapsX = candidateX + candidateW > left - 25 && candidateX < right + 25;
            const overlapsY = candidateY + candidateH > top - 25 && candidateY < bottom + 25;
            if (overlapsX && overlapsY) return false;
        }
        return true;
    };
    
    // Simple probability mix to keep the game fair while introducing the new hazards.
    if (difficulty < 1.6) {
        if (roll < 0.72) {
            // Normal red block obstacle.
            obsType = 'block';
            width = 40 + Math.random() * 40;
            height = 30 + Math.random() * 20;
            speedY = curSpeed;
        } else if (roll < 0.9) {
            // Circular red meteor obstacle.
            obsType = 'meteor';
            width = 20 + Math.random() * 15;
            height = width;
            speedY = curSpeed * 1.15;
        } else {
            // Moving red bar obstacle.
            obsType = 'moving';
            width = 50;
            height = 30;
            speedY = curSpeed * 0.9;
            speedX = (Math.random() > 0.5 ? 1 : -1) * (50 + Math.random() * 100) * difficulty;
        }
    } else if (difficulty < 2.8) {
        if (roll < 0.52) {
            // Normal red block obstacle.
            obsType = 'block';
            width = 40 + Math.random() * 40;
            height = 30 + Math.random() * 20;
            speedY = curSpeed;
        } else if (roll < 0.73) {
            // Moving red bar obstacle.
            obsType = 'moving';
            width = 50;
            height = 30;
            speedY = curSpeed * 0.9;
            speedX = (Math.random() > 0.5 ? 1 : -1) * (50 + Math.random() * 100) * difficulty;
        } else if (roll < 0.9) {
            // Circular red meteor obstacle.
            obsType = 'meteor';
            width = 20 + Math.random() * 15;
            height = width;
            speedY = curSpeed * 1.2;
        } else {
            // Large red block obstacle.
            obsType = 'large';
            width = 120 + Math.random() * 80;
            height = 40;
            speedY = curSpeed * 0.7;
        }
    } else {
        if (roll < 0.43) {
            // Normal red block obstacle.
            obsType = 'block';
            width = 40 + Math.random() * 40;
            height = 30 + Math.random() * 20;
            speedY = curSpeed;
        } else if (roll < 0.68) {
            // Moving red bar obstacle.
            obsType = 'moving';
            width = 50;
            height = 30;
            speedY = curSpeed * 0.9;
            speedX = (Math.random() > 0.5 ? 1 : -1) * (50 + Math.random() * 100) * difficulty;
        } else if (roll < 0.86) {
            // Circular red meteor obstacle.
            obsType = 'meteor';
            width = 20 + Math.random() * 15;
            height = width;
            speedY = curSpeed * 1.25;
        } else if (roll < 0.94) {
            // Large red block obstacle.
            obsType = 'large';
            width = 120 + Math.random() * 80;
            height = 40;
            speedY = curSpeed * 0.7;
        } else {
            // Red wall with a safe gap: built as two separate rects that move together.
            const gapWidth = Math.max(player.rocketWidth * 2, 90);
            let gapX = 0.15 * vw + Math.random() * (0.55 * vw - gapWidth);
            const wallHeight = 80 + Math.random() * 40;
            const wallSpeed = curSpeed * 0.8;
            const wallY = -wallHeight;
            const wallId = 'wall-' + Date.now() + '-' + Math.random();

            for (let attempt = 0; attempt < 10; attempt++) {
                gapX = 0.15 * vw + Math.random() * (0.55 * vw - gapWidth);
                const gapEnd = gapX + gapWidth;
                const wallLeft = { x: 0, y: wallY, width: gapX, height: wallHeight };
                const wallRight = { x: gapEnd, y: wallY, width: vw - gapEnd, height: wallHeight };
                const fair = isSpawnFair(wallLeft.x, wallLeft.y, wallLeft.width, wallLeft.height) &&
                    isSpawnFair(wallRight.x, wallRight.y, wallRight.width, wallRight.height) &&
                    gapX > 40 && gapEnd < vw - 40;
                if (fair) {
                    obstacles.push({ type: 'wall', wallId, x: 0, y: wallY, width: gapX, height: wallHeight, speedY: wallSpeed, speedX: 0, passed: false });
                    obstacles.push({ type: 'wall', wallId, x: gapX + gapWidth, y: wallY, width: vw - (gapX + gapWidth), height: wallHeight, speedY: wallSpeed, speedX: 0, passed: false });
                    return;
                }
            }
            return;
        }
    }

    for (let attempt = 0; attempt < 10; attempt++) {
        const x = Math.random() * (vw - width);
        const y = -height;
        if (isSpawnFair(x, y, width, height)) {
            obstacles.push({
                type: obsType,
                x: x,
                y: y,
                width: width,
                height: height,
                speedY: speedY,
                speedX: speedX,
                passed: false
            });
            return;
        }
    }
}

// Spawns a shield or coin pickup for the current run.
function spawnPickup() {
    const isPowerup = Math.random() < 0.1; // 10% chance for powerup
    
    if (isPowerup && !player.shieldActive) {
        pickups.push({
            type: 'shield',
            x: Math.random() * (vw - 30),
            y: -30,
            radius: 15,
            speedY: 150 * difficulty
        });
    } else {
        pickups.push({
            type: 'coin',
            x: Math.random() * (vw - 20),
            y: -20,
            radius: 12,
            speedY: 150 * difficulty
        });
    }
}

// Fires one bullet if ammo is available.
function fireBullet() {
    if (gameState !== STATES.PLAYING || ammo <= 0) return;

    // Current ammo is reduced before the bullet is created.
    ammo = Math.max(0, ammo - 1);
    bullets.push({
        x: player.x,
        y: player.y - player.rocketHeight * 0.6,
        radius: 5,
        speed: 520,
        color: '#ffd32a'
    });
    saveData();
    updateHUD();
}

// Moves active bullets, removes expired ones and checks for bullet-to-obstacle collisions.
function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        bullet.y -= bullet.speed * dt;

        if (bullet.y + bullet.radius < 0) {
            bullets.splice(i, 1);
            continue;
        }

        let hit = false;
        for (let j = obstacles.length - 1; j >= 0; j--) {
            const obs = obstacles[j];
            const bx = bullet.x;
            const by = bullet.y;
            const nearestX = Math.max(obs.x, Math.min(bx, obs.x + obs.width));
            const nearestY = Math.max(obs.y, Math.min(by, obs.y + obs.height));
            const dx = bx - nearestX;
            const dy = by - nearestY;
            const distSq = dx * dx + dy * dy;

            if (distSq <= bullet.radius * bullet.radius) {
                bullets.splice(i, 1);

                if (obs.type === 'wall') {
                    const wallGroupId = obs.wallId;
                    for (let k = obstacles.length - 1; k >= 0; k--) {
                        if (obstacles[k].type === 'wall' && obstacles[k].wallId === wallGroupId) {
                            obstacles.splice(k, 1);
                        }
                    }
                } else {
                    obstacles.splice(j, 1);
                }

                score += 25;
                spawnFloatingText(obs.x + obs.width / 2, obs.y + obs.height / 2, '+25', '#ffd32a');
                hit = true;
                break;
            }
        }

        if (hit) {
            updateHUD();
        }
    }
}

function drawBullets() {
    for (const bullet of bullets) {
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
        ctx.fillStyle = bullet.color;
        ctx.shadowColor = bullet.color;
        ctx.shadowBlur = 10;
        ctx.fill();
    }
    ctx.shadowBlur = 0;
}

// Opens the shop screen without leaving the current progression state behind.
function openShop() {
    gameState = STATES.MENU;
    showScreen('shop-screen');
    updateShopUI();
}

// Returns the price for the next ammo storage upgrade.
function getAmmoUpgradeCost() {
    if (ammoCapacity < 10) return 100;
    if (ammoCapacity < 15) return 200;
    if (ammoCapacity < 20) return 300;
    if (ammoCapacity < 25) return 400;
    if (ammoCapacity < 30) return 500;
    return 0;
}

// Refreshes the ammo and rocket panels in the shop.
function updateShopUI() {
    const shopCoins = document.getElementById('shop-coins');
    const shopAmmoValue = document.getElementById('shop-ammo-value');
    const shopAmmoCapacity = document.getElementById('shop-ammo-capacity');
    const shopUpgradeCost = document.getElementById('shop-upgrade-cost');

    if (shopCoins) shopCoins.textContent = coins;
    if (shopAmmoValue) shopAmmoValue.textContent = `${ammo} / ${ammoCapacity}`;
    if (shopAmmoCapacity) shopAmmoCapacity.textContent = `${ammoCapacity} / ${maxAmmoStorage}`;
    if (shopUpgradeCost) shopUpgradeCost.textContent = getAmmoUpgradeCost();
    renderRocketShop();
}

// Shows status text for the last shop action.
function setShopStatus(message) {
    const status = document.getElementById('shop-status');
    if (status) status.textContent = message;
}

// Increases the ammo storage limit using collected coins.
function upgradeAmmoStorage() {
    if (ammoCapacity >= maxAmmoStorage) {
        setShopStatus('Storage Full');
        return;
    }

    const cost = getAmmoUpgradeCost();
    if (coins < cost) {
        setShopStatus('Not Enough Coins');
        return;
    }

    coins -= cost;
    ammoCapacity = Math.min(maxAmmoStorage, ammoCapacity + 5);
    ammo = Math.min(ammoCapacity, ammo);
    saveData();
    updateHUD();
    updateShopUI();
    setShopStatus(`Storage upgraded to ${ammoCapacity}`);
}

// Buys a refill of ammo using coins.
function buyAmmo() {
    const cost = 20;
    if (coins < cost) {
        setShopStatus('Not Enough Coins');
        return;
    }
    if (ammo >= ammoCapacity) {
        setShopStatus('Ammo Full');
        return;
    }

    coins -= cost;
    ammo = Math.min(ammoCapacity, ammo + 5);
    saveData();
    updateHUD();
    updateShopUI();
    setShopStatus('Purchased +5 ammo');
}

// Returns the render colors for the selected rocket style.
function getRocketPalette(key) {
    const palette = {
        classic: { body: '#f1f2f6', accent: '#5352ed', fin: '#ff4757', nose: '#e8e8e8', window: '#70a1ff', glow: '#ffffff' },
        blue: { body: '#60a5fa', accent: '#1d4ed8', fin: '#38bdf8', nose: '#dbeafe', window: '#dbeafe', glow: '#bfdbfe' },
        green: { body: '#4ade80', accent: '#16a34a', fin: '#22c55e', nose: '#dcfce7', window: '#bbf7d0', glow: '#bbf7d0' },
        purple: { body: '#c084fc', accent: '#7c3aed', fin: '#a855f7', nose: '#f3e8ff', window: '#ddd6fe', glow: '#e9d5ff' },
        fire: { body: '#ff8a65', accent: '#ff4757', fin: '#ffb703', nose: '#ffe0b2', window: '#fff7ed', glow: '#ffd166' },
        galaxy: { body: '#7c3aed', accent: '#312e81', fin: '#4f46e5', nose: '#d8b4fe', window: '#c4b5fd', glow: '#e9d5ff' },
        gold: { body: '#ffd166', accent: '#d97706', fin: '#facc15', nose: '#fef3c7', window: '#fef9c3', glow: '#fef3c7' },
        titan: { body: '#1f2937', accent: '#38bdf8', fin: '#6d28d9', nose: '#dbeafe', window: '#e0f2fe', glow: '#c4b5fd' }
    };
    return palette[key] || palette.classic;
}

// Equips the selected rocket style after unlock checks.
function equipRocket(key) {
    if (!rockets[key] || !rockets[key].unlocked) {
        if (rockets[key] && coins >= rockets[key].price) {
            coins -= rockets[key].price;
            rockets[key].unlocked = true;
            selectedRocket = key;
            saveData();
            updateHUD();
            updateShopUI();
            setShopStatus(`${rockets[key].name} unlocked`);
            return;
        }
        if (rockets[key]) setShopStatus('Not Enough Coins');
        return;
    }

    selectedRocket = key;
    saveData();
    updateShopUI();
    setShopStatus(`${rockets[key].name} equipped`);
}

// Renders the list of rockets and updates purchase/equip actions.
function renderRocketShop() {
    const list = document.getElementById('shop-rocket-list');
    if (!list) return;

    const rows = Object.keys(rockets).map((key) => {
        const rocket = rockets[key];
        const unlocked = rocket.unlocked;
        const selected = selectedRocket === key;
        let label = 'UNLOCK';
        let status = `${rocket.price} COINS`;
        let disabled = false;
        let preview = '🚀';
        let premiumTag = '';

        if (key === 'galaxy') preview = '🌌';
        else if (key === 'gold') preview = '🏆';
        else if (key === 'titan') preview = '🚀';

        if (key === 'galaxy' || key === 'gold' || key === 'titan') {
            premiumTag = '<div class="rocket-tag">PREMIUM SKIN</div>';
        }

        if (unlocked) {
            label = selected ? 'EQUIPPED' : 'EQUIP';
            status = selected ? 'EQUIPPED ✓' : 'UNLOCKED ✓';
        } else if (coins < rocket.price) {
            disabled = true;
        }

        return `
            <div class="rocket-item ${key === 'galaxy' || key === 'gold' || key === 'titan' ? 'premium-skin-card' : ''}">
                <div class="rocket-preview ${key}">${preview}</div>
                ${premiumTag}
                <div class="rocket-top">
                    <span class="rocket-name">${rocket.name}</span>
                    <span class="rocket-price">${unlocked ? '✓' : `${rocket.price.toLocaleString()} COINS`}</span>
                </div>
                <div class="rocket-status">${status}</div>
                <button class="rocket-action" data-rocket="${key}" ${disabled ? 'disabled' : ''}>${label}</button>
            </div>
        `;
    }).join('');

    list.innerHTML = rows;
    list.onclick = (event) => {
        const button = event.target.closest('.rocket-action');
        if (!button) return;

        const key = button.getAttribute('data-rocket');
        const rocket = rockets[key];
        if (!rocket) return;

        if (shopActionLocked) return;
        shopActionLocked = true;

        try {
            if (!rocket.unlocked) {
                if (coins >= rocket.price) {
                    coins -= rocket.price;
                    rocket.unlocked = true;
                    selectedRocket = key;
                    saveData();
                    updateHUD();
                    updateShopUI();
                    setShopStatus(`${rocket.name} unlocked`);
                } else {
                    setShopStatus('Not Enough Coins');
                }
            } else {
                selectedRocket = key;
                saveData();
                updateShopUI();
                setShopStatus(`${rocket.name} equipped`);
            }
        } finally {
            shopActionLocked = false;
        }
    };
}

// Creates a small floating text effect for score and near-miss rewards.
function spawnFloatingText(x, y, text, color) {
    particles.push({
        x: x,
        y: y,
        text: text,
        color: color,
        life: 1.0 // 1 second
    });
}

// --- UPDATE LOOP ---
// Main game update loop. Handles movement, spawning, collisions and pickups.
function update(dt) {
    if (gameState !== STATES.PLAYING) return;
    
    survivalTime += dt;
    difficulty = Math.min(CONFIG.maxDifficulty, 1 + survivalTime / 30);
    
    // Passive score increase
    score += dt * 10;
    
    // Shield Logic
    if (player.shieldActive) {
        player.shieldTimer -= dt;
        if (player.shieldTimer <= 0) {
            player.shieldActive = false;
            shield = false;
        }
        updateDefenseHUD();
    }
    if (player.invulnerableTimer > 0) {
        player.invulnerableTimer -= dt;
    }
    
    // Player Movement
    let dx = 0;
    if (input.left) dx = -1;
    if (input.right) dx = 1;
    
    player.x += dx * CONFIG.playerSpeed * dt;
    
    // Clamp Player (use half rocket width for boundary)
    const halfW = player.rocketWidth / 2;
    if (player.x - halfW < 0) player.x = halfW;
    if (player.x + halfW > vw) player.x = vw - halfW;
    
    // --- Rocket animation updates ---
    // Tilt: lean toward movement direction, smoothly return to centre
    const targetTilt = dx * 0.25; // ~14° max lean
    player.tilt += (targetTilt - player.tilt) * 6 * dt; // smooth ease

    // Hover bobbing (subtle sine wave, ±2 px)
    player.hoverPhase += dt * 3;
    player.hoverOffset = Math.sin(player.hoverPhase) * 2;

    // Flame flicker (random length factor, updated ~every frame)
    player.flameFlicker = 0.8 + Math.random() * 0.4; // 0.8 – 1.2
    
    // Spawning logic
    spawnTimer -= dt * 1000;
    if (spawnTimer <= 0) {
        spawnObstacle();
        if (Math.random() < 0.3) spawnPickup();
        
        // Calculate next spawn
        nextSpawnInterval = 1500 / difficulty;
        spawnTimer = nextSpawnInterval;
    }
    
    // Player collision box is aligned to the rocket's visible body and excludes the flame/glow.
    // This keeps collisions fair without making the rocket appear to clip through obstacles.
    const colW = 15;
    const colH = 19;
    const pBox = {
        left:   player.x - colW,
        right:  player.x + colW,
        top:    player.y - colH,
        bottom: player.y + colH
    };
    
    updateBullets(dt);

    // Update Obstacles
    for (let i = obstacles.length - 1; i >= 0; i--) {
        const obs = obstacles[i];
        obs.y += obs.speedY * dt;
        obs.x += obs.speedX * dt;
        
        // Bounce moving obstacles off walls
        if (obs.x < 0) {
            obs.x = 0;
            obs.speedX *= -1;
        }
        if (obs.x + obs.width > vw) {
            obs.x = vw - obs.width;
            obs.speedX *= -1;
        }
        
        const oBox = {
            left: obs.x,
            right: obs.x + obs.width,
            top: obs.y,
            bottom: obs.y + obs.height
        };
        
        // Collision detection: if the rocket touches a red obstacle, the run ends unless a defense is available.
        if (pBox.left < oBox.right && pBox.right > oBox.left &&
            pBox.top < oBox.bottom && pBox.bottom > oBox.top) {
             
            if (player.invulnerableTimer > 0) {
                obstacles.splice(i, 1);
                continue;
            }

            if (player.shieldActive || shield) {
                // Shield absorbs the collision and removes the obstacle.
                player.shieldActive = false;
                player.shieldTimer = 0;
                shield = false;
                if (player.invulnerableTimer <= 0) {
                    player.invulnerableTimer = 2;
                }
                playSound('hit');
                vibrate(100);
                saveData();
                obstacles.splice(i, 1);
                updateDefenseHUD();
                continue;
            } else if (extraLife > 0) {
                extraLife = 0;
                player.x = vw / 2;
                player.y = vh - 100;
                player.tilt = 0;
                player.invulnerableTimer = 2;
                saveData();
                updateDefenseHUD();
                playSound('powerup');
                vibrate(100);
                obstacles.splice(i, 1);
                continue;
            } else {
                gameOver();
                return;
            }
        }
        
        // Near Miss Detection
        if (!obs.passed && oBox.top > pBox.bottom && oBox.bottom < pBox.bottom + 180) {
            const centerX = obs.x + obs.width / 2;
            const dist = Math.abs(centerX - player.x);
            const nearMissThreshold = CONFIG.nearMissDistance + (obs.width * 0.4);

            if (dist > 0 && dist < nearMissThreshold) {
                score += CONFIG.nearMissValue;
                spawnFloatingText(player.x, player.y - 30, `+${CONFIG.nearMissValue} NEAR MISS`, '#2ed573');
                playSound('nearmiss');
            }
            obs.passed = true;
        }
        
        if (obs.y > vh) {
            obstacles.splice(i, 1);
        }
    }
    
    // Update Pickups
    for (let i = pickups.length - 1; i >= 0; i--) {
        const p = pickups[i];
        p.y += p.speedY * dt;
        
        // Circle collision approximation
        const dx = player.x - p.x;
        const dy = player.y - p.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        if (dist < player.size/2 + p.radius) {
            if (p.type === 'coin') {
                coins++;
                score += CONFIG.coinValue;
                spawnFloatingText(p.x, p.y, `+${CONFIG.coinValue}`, '#ffa502');
                playSound('coin');
                vibrate(30);
                saveData(); // Save coins immediately
            } else if (p.type === 'shield') {
                if (!shield && !player.shieldActive) {
                    shield = true;
                    player.shieldActive = true;
                    player.shieldTimer = CONFIG.shieldDuration;
                    saveData();
                    updateDefenseHUD();
                    playSound('powerup');
                    vibrate(50);
                }
            }
            pickups.splice(i, 1);
            continue;
        }
        
        if (p.y - p.radius > vh) {
            pickups.splice(i, 1);
        }
    }
    
    // Update Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.y -= 50 * dt;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
    }
    
    updateHUD();
}

// --- ROCKET DRAWING HELPERS ---

/**
 * drawRocketFlame — animated engine exhaust underneath the rocket.
 * Uses a simple gradient triangle that flickers in length.
 */
function drawRocketFlame() {
    const px = player.x;
    const py = player.y + player.hoverOffset;
    const w  = player.rocketWidth;
    const h  = player.rocketHeight;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(player.tilt);

    // Flame sits just below the rocket body
    const flameBaseY  = h * 0.40;                    // bottom edge of body
    const flameLength = (12 + Math.random() * 6) * player.flameFlicker;
    const flameHalfW  = w * 0.22;

    // Gradient: bright yellow → orange → transparent
    const grad = ctx.createLinearGradient(0, flameBaseY, 0, flameBaseY + flameLength);
    grad.addColorStop(0,   '#ffa502');
    grad.addColorStop(0.4, '#ff6348');
    grad.addColorStop(1,   'rgba(255, 99, 72, 0)');

    ctx.fillStyle = grad;
    ctx.shadowColor = '#ff6348';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(-flameHalfW, flameBaseY);
    ctx.lineTo( flameHalfW, flameBaseY);
    ctx.lineTo(0, flameBaseY + flameLength);
    ctx.closePath();
    ctx.fill();

    // Inner brighter core
    const coreLen = flameLength * 0.55;
    const coreW   = flameHalfW * 0.5;
    const coreGrad = ctx.createLinearGradient(0, flameBaseY, 0, flameBaseY + coreLen);
    coreGrad.addColorStop(0,   '#fffbe6');
    coreGrad.addColorStop(0.5, '#ffd32a');
    coreGrad.addColorStop(1,   'rgba(255, 211, 42, 0)');

    ctx.fillStyle = coreGrad;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(-coreW, flameBaseY);
    ctx.lineTo( coreW, flameBaseY);
    ctx.lineTo(0, flameBaseY + coreLen);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

/**
 * drawRocket — the main rocket body, drawn from canvas shapes.
 * Origin is the player's centre (player.x, player.y).
 * All coordinates are relative, so rotation (tilt) and hover offset just work.
 *
 * Layout (from top to bottom, y negative = up):
 *   Nose cone   : -h/2  to  -h/4
 *   Body        : -h/4  to  +h*0.4
 *   Side fins   : around +h*0.2  to  +h*0.4
 *   Window      : small circle on upper body
 */
function drawRocket() {
    const px = player.x;
    const py = player.y + player.hoverOffset;
    const w  = player.rocketWidth;
    const h  = player.rocketHeight;
    const halfW = w / 2;
    const palette = getRocketPalette(selectedRocket);

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(player.tilt);

    // --- Nose Cone (pointed top) ---
    ctx.fillStyle = palette.nose;
    ctx.shadowColor = palette.glow;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.lineTo( halfW * 0.55, -h * 0.18);
    ctx.lineTo(-halfW * 0.55, -h * 0.18);
    ctx.closePath();
    ctx.fill();

    const bodyTop    = -h * 0.22;
    const bodyBottom =  h * 0.40;
    const bodyHalfW  =  halfW * 0.55;

    ctx.fillStyle = palette.body;
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(-bodyHalfW, bodyTop);
    ctx.lineTo( bodyHalfW, bodyTop);
    ctx.lineTo( bodyHalfW * 0.85, bodyBottom);
    ctx.lineTo(-bodyHalfW * 0.85, bodyBottom);
    ctx.closePath();
    ctx.fill();

    const stripeTop = h * 0.08;
    const stripeBot = h * 0.18;
    ctx.fillStyle = palette.accent;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(-bodyHalfW + 1, stripeTop);
    ctx.lineTo( bodyHalfW - 1, stripeTop);
    ctx.lineTo((bodyHalfW - 1) * 0.92, stripeBot);
    ctx.lineTo(-(bodyHalfW - 1) * 0.92, stripeBot);
    ctx.closePath();
    ctx.fill();

    const winY = -h * 0.05;
    const winR = w * 0.1;
    ctx.beginPath();
    ctx.arc(0, winY, winR + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#a4b0be';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, winY, winR, 0, Math.PI * 2);
    ctx.fillStyle = palette.window;
    ctx.shadowColor = palette.window;
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-winR * 0.3, winY - winR * 0.3, winR * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.shadowBlur = 0;
    ctx.fill();

    const finTop    = h * 0.18;
    const finBottom = h * 0.44;

    ctx.fillStyle = palette.fin;
    ctx.shadowColor = palette.fin;
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(-bodyHalfW * 0.85, finTop);
    ctx.lineTo(-halfW * 1.1,      finBottom);
    ctx.lineTo(-bodyHalfW * 0.85,  finBottom);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo( bodyHalfW * 0.85, finTop);
    ctx.lineTo( halfW * 1.1,      finBottom);
    ctx.lineTo( bodyHalfW * 0.85,  finBottom);
    ctx.closePath();
    ctx.fill();

    const nozW = bodyHalfW * 0.5;
    const nozH = 4;
    ctx.fillStyle = '#57606f';
    ctx.shadowBlur = 0;
    ctx.fillRect(-nozW, h * 0.38, nozW * 2, nozH);

    ctx.restore();
}

/**
 * drawShield — pulsing translucent blue aura around the rocket.
 */
function drawShield() {
    const px = player.x;
    const py = player.y + player.hoverOffset;
    const radius = player.rocketHeight * 0.55 + 6;

    // Subtle pulsing via time-based sine
    const pulse = 1 + Math.sin(performance.now() / 200) * 0.08;
    const r = radius * pulse;

    ctx.save();

    // Outer glow ring
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(30, 144, 255, 0.7)';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#1e90ff';
    ctx.shadowBlur = 14;
    ctx.stroke();

    // Inner translucent fill
    ctx.beginPath();
    ctx.arc(px, py, r - 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(30, 144, 255, 0.08)';
    ctx.shadowBlur = 0;
    ctx.fill();

    ctx.restore();
}

function drawRockyAsteroid(x, y, width, height, glowColor = '#ff4d4d') {
    const left = x;
    const right = x + width;
    const top = y;
    const bottom = y + height;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(left + width * 0.10, top);
    ctx.lineTo(right - width * 0.12, top + height * 0.08);
    ctx.lineTo(right, top + height * 0.22);
    ctx.lineTo(right - width * 0.08, top + height * 0.62);
    ctx.lineTo(right - width * 0.20, bottom);
    ctx.lineTo(left + width * 0.26, bottom);
    ctx.lineTo(left, bottom - height * 0.18);
    ctx.lineTo(left + width * 0.05, top + height * 0.14);
    ctx.closePath();

    ctx.fillStyle = '#c1272d';
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 12;
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(87, 14, 17, 0.5)';
    ctx.beginPath();
    ctx.arc(left + width * 0.30, top + height * 0.30, Math.min(width, height) * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(left + width * 0.68, top + height * 0.58, Math.min(width, height) * 0.13, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ff7b7b';
    ctx.beginPath();
    ctx.arc(left + width * 0.68, top + height * 0.25, Math.min(width, height) * 0.09, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function drawMeteor(x, y, width, height) {
    const cx = x + width / 2;
    const cy = y + height / 2;
    const radius = Math.min(width, height) / 2;
    const points = [
        [0, -1], [0.26, -0.86], [0.7, -0.95], [1, -0.45], [0.95, 0.1], [1, 0.55],
        [0.72, 0.96], [0.34, 1], [0.05, 0.9], [-0.28, 1], [-0.72, 0.92], [-1, 0.52],
        [-0.95, 0.05], [-1, -0.4], [-0.72, -0.88], [-0.28, -1]
    ];

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((Math.sin((x + y) * 0.08) * Math.PI) / 18);
    ctx.beginPath();
    ctx.moveTo(points[0][0] * radius, points[0][1] * radius);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0] * radius, points[i][1] * radius);
    }
    ctx.closePath();

    const grad = ctx.createRadialGradient(-radius * 0.25, -radius * 0.25, radius * 0.1, 0, 0, radius);
    grad.addColorStop(0, '#ffd2a6');
    grad.addColorStop(0.2, '#ff7f50');
    grad.addColorStop(0.6, '#d9232d');
    grad.addColorStop(1, '#7d0d15');

    ctx.fillStyle = grad;
    ctx.shadowColor = '#ff5a36';
    ctx.shadowBlur = 12;
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(70, 10, 16, 0.6)';
    ctx.beginPath();
    ctx.arc(-radius * 0.25, radius * 0.08, radius * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(radius * 0.35, -radius * 0.15, radius * 0.18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 238, 214, 0.45)';
    ctx.beginPath();
    ctx.arc(-radius * 0.45, -radius * 0.3, radius * 0.18, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function drawWallSection(x, y, width, height) {
    drawRockyAsteroid(x, y, width, height, '#ff5d5d');
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 222, 180, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + width * 0.08, y + height * 0.18);
    ctx.lineTo(x + width * 0.88, y + height * 0.18);
    ctx.stroke();
    ctx.restore();
}

function drawPlanet(type, x, y, radius) {
    const planetGrad = ctx.createRadialGradient(x - radius * 0.4, y - radius * 0.4, radius * 0.15, x, y, radius);

    if (type === 'earth') {
        planetGrad.addColorStop(0, '#7ee7ff');
        planetGrad.addColorStop(0.4, '#3bb4ff');
        planetGrad.addColorStop(0.7, '#1b7a6b');
        planetGrad.addColorStop(1, '#0c3d6f');
    } else if (type === 'venus') {
        planetGrad.addColorStop(0, '#ffe4a3');
        planetGrad.addColorStop(0.5, '#f4b942');
        planetGrad.addColorStop(1, '#c77d07');
    } else if (type === 'jupiter') {
        planetGrad.addColorStop(0, '#f3d9b0');
        planetGrad.addColorStop(0.4, '#d9a66a');
        planetGrad.addColorStop(0.7, '#a66e4f');
        planetGrad.addColorStop(1, '#4f352d');
    } else if (type === 'mars') {
        planetGrad.addColorStop(0, '#ffba8c');
        planetGrad.addColorStop(0.5, '#db5c2d');
        planetGrad.addColorStop(1, '#7a2617');
    } else {
        planetGrad.addColorStop(0, '#f9ebc1');
        planetGrad.addColorStop(0.5, '#d9b866');
        planetGrad.addColorStop(0.8, '#b8893d');
        planetGrad.addColorStop(1, '#6d4d1e');
    }

    ctx.fillStyle = planetGrad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (type === 'jupiter') {
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 2;
        for (let i = -2; i <= 2; i++) {
            ctx.beginPath();
            ctx.ellipse(x, y + i * 4, radius * 0.8, radius * 0.18, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    if (type === 'saturn') {
        ctx.strokeStyle = 'rgba(255, 235, 179, 0.7)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(x, y, radius * 1.8, radius * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
    }

    if (type === 'earth') {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.arc(x + radius * 0.08, y - radius * 0.2, radius * 0.28, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawSpaceBackdrop() {
    const stars = [
        { x: 0.08, y: 0.11, r: 1.6 }, { x: 0.16, y: 0.26, r: 1.3 }, { x: 0.28, y: 0.07, r: 2 },
        { x: 0.34, y: 0.32, r: 1.3 }, { x: 0.46, y: 0.15, r: 1.5 }, { x: 0.57, y: 0.22, r: 2.2 },
        { x: 0.68, y: 0.09, r: 1.4 }, { x: 0.74, y: 0.32, r: 1.8 }, { x: 0.82, y: 0.18, r: 1.2 },
        { x: 0.92, y: 0.12, r: 1.6 }, { x: 0.12, y: 0.46, r: 1.2 }, { x: 0.22, y: 0.52, r: 1.8 },
        { x: 0.38, y: 0.44, r: 1.4 }, { x: 0.49, y: 0.58, r: 1.7 }, { x: 0.63, y: 0.48, r: 1.6 },
        { x: 0.71, y: 0.62, r: 2.1 }, { x: 0.86, y: 0.54, r: 1.3 }, { x: 0.94, y: 0.42, r: 1.8 },
        { x: 0.06, y: 0.67, r: 1.4 }, { x: 0.18, y: 0.74, r: 1.6 }, { x: 0.35, y: 0.8, r: 1.9 },
        { x: 0.53, y: 0.7, r: 1.5 }, { x: 0.66, y: 0.82, r: 2.3 }, { x: 0.87, y: 0.72, r: 1.9 }
    ];

    const galaxies = [
        { x: 0.18, y: 0.18, r: 80, color: 'rgba(145, 112, 255, 0.12)' },
        { x: 0.72, y: 0.14, r: 72, color: 'rgba(79, 160, 255, 0.10)' },
        { x: 0.52, y: 0.7, r: 64, color: 'rgba(118, 162, 255, 0.08)' }
    ];

    const planets = [
        { type: 'earth', x: 0.2, y: 0.22, r: 30 },
        { type: 'venus', x: 0.79, y: 0.18, r: 22 },
        { type: 'jupiter', x: 0.54, y: 0.28, r: 42 },
        { type: 'mars', x: 0.66, y: 0.64, r: 18 },
        { type: 'saturn', x: 0.33, y: 0.78, r: 20 }
    ];

    stars.forEach((star) => {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath();
        ctx.arc(star.x * vw, star.y * vh, star.r, 0, Math.PI * 2);
        ctx.fill();
    });

    galaxies.forEach((galaxy) => {
        const g = ctx.createRadialGradient(galaxy.x * vw, galaxy.y * vh, 10, galaxy.x * vw, galaxy.y * vh, galaxy.r);
        g.addColorStop(0, 'rgba(255,255,255,0.26)');
        g.addColorStop(0.18, galaxy.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(galaxy.x * vw, galaxy.y * vh, galaxy.r, 0, Math.PI * 2);
        ctx.fill();
    });

    planets.forEach((planet) => {
        drawPlanet(planet.type, planet.x * vw, planet.y * vh, planet.r);
    });
}

// --- DRAW LOOP ---
// --- DRAW LOOP ---
function draw() {
    // Clear Background
    ctx.fillStyle = '#0f1016';
    ctx.fillRect(0, 0, vw, vh);
    drawSpaceBackdrop();
    
    if (gameState === STATES.MENU || gameState === STATES.HOW_TO_PLAY || gameState === STATES.SETTINGS) {
        return; // UI overlays handle this state
    }
    
    // Draw Pickups
    for (const p of pickups) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        if (p.type === 'coin') {
            ctx.fillStyle = '#ffa502';
            ctx.shadowColor = '#ffa502';
        } else {
            ctx.fillStyle = '#1e90ff';
            ctx.shadowColor = '#1e90ff';
        }
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.closePath();
    }

    drawBullets();
    
    // Draw Obstacles
    ctx.shadowBlur = 0;
    for (const obs of obstacles) {
        if (obs.type === 'meteor') {
            drawMeteor(obs.x, obs.y, obs.width, obs.height);
        } else if (obs.type === 'wall') {
            drawWallSection(obs.x, obs.y, obs.width, obs.height);
        } else if (obs.type === 'moving') {
            drawRockyAsteroid(obs.x, obs.y, obs.width, obs.height, '#ff5d5d');
        } else {
            drawRockyAsteroid(obs.x, obs.y, obs.width, obs.height, '#ff4757');
        }
    }
    
    // --- Draw Player (Rocket) ---
    drawRocketFlame();
    drawRocket();
    if (player.shieldActive) drawShield();
    
    // Draw Particles (Floating text)
    ctx.shadowBlur = 0;
    ctx.font = 'bold 20px Outfit, sans-serif';
    ctx.textAlign = 'center';
    for (const p of particles) {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1.0;
}

// --- MAIN LOOP ---
function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    
    // Cap dt to prevent massive jumps if tab is inactive
    if (dt > 0.1) dt = 0.1;
    
    update(dt);
    draw();
    
    requestAnimationFrame(loop);
}

// --- UI AND STATE MANAGEMENT ---

function hideAllScreens() {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('btn-pause').classList.add('hidden');
    document.getElementById('btn-fire').classList.add('hidden');
    const mobileControls = document.querySelector('.mobile-controls');
    if (mobileControls) mobileControls.classList.add('hidden');
    mobileMovement.left = false;
    mobileMovement.right = false;
    const leftButton = document.getElementById('leftBtn') || document.getElementById('btn-mobile-left');
    const rightButton = document.getElementById('rightBtn') || document.getElementById('btn-mobile-right');
    if (leftButton) leftButton.classList.remove('is-pressed');
    if (rightButton) rightButton.classList.remove('is-pressed');
    stopMoving();
}

function showScreen(id) {
    hideAllScreens();
    document.getElementById(id).classList.remove('hidden');
}

function updateHUD() {
    document.getElementById('hud-score').textContent = Math.floor(score);
    document.getElementById('hud-best').textContent = Math.floor(Math.max(score, bestScore));
    document.getElementById('hud-coins').textContent = coins;
    document.getElementById('hud-ammo').textContent = ammo;
}

function startGame() {
    initAudio();
    playSound('click');
    gameState = STATES.PLAYING;
    resetGame();
    hideAllScreens();
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('btn-pause').classList.remove('hidden');
    document.getElementById('btn-fire').classList.remove('hidden');
    const mobileControls = document.querySelector('.mobile-controls');
    if (mobileControls) mobileControls.classList.remove('hidden');
    lastTime = performance.now();
}

function pauseGame() {
    playSound('click');
    gameState = STATES.PAUSED;
    document.getElementById('btn-fire').classList.add('hidden');
    mobileMovement.left = false;
    mobileMovement.right = false;
    const leftButton = document.getElementById('leftBtn') || document.getElementById('btn-mobile-left');
    const rightButton = document.getElementById('rightBtn') || document.getElementById('btn-mobile-right');
    if (leftButton) leftButton.classList.remove('is-pressed');
    if (rightButton) rightButton.classList.remove('is-pressed');
    stopMoving();
    showScreen('pause-screen');
}

function resumeGame() {
    playSound('click');
    gameState = STATES.PLAYING;
    hideAllScreens();
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('btn-pause').classList.remove('hidden');
    document.getElementById('btn-fire').classList.remove('hidden');
    const mobileControls = document.querySelector('.mobile-controls');
    if (mobileControls) mobileControls.classList.remove('hidden');
    lastTime = performance.now();
}

function continueWithDefense() {
    gameState = STATES.PLAYING;
    extraLifeRewardInFlight = false;
    player.x = vw / 2;
    player.y = vh - 100;
    player.tilt = 0;
    player.invulnerableTimer = 2;
    obstacles = obstacles.filter((obs) => obs.y < vh + 200);
    hideAllScreens();
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('btn-pause').classList.remove('hidden');
    document.getElementById('btn-fire').classList.remove('hidden');
    const mobileControls = document.querySelector('.mobile-controls');
    if (mobileControls) mobileControls.classList.remove('hidden');
    updateDefenseHUD();
    lastTime = performance.now();
}

function grantExtraLife() {
    // Development reward callback for the rewarded-ad integration point.
    if (gameState !== STATES.GAME_OVER || extraLife > 0 || extraLifeRewardInFlight) {
        return;
    }
    extraLifeRewardInFlight = true;
    extraLife = 1;
    saveData();
    updateDefenseHUD();
    continueWithDefense();
}

window.grantExtraLife = grantExtraLife;

function gameOver() {
    gameState = STATES.GAME_OVER;
    playSound('hit');
    vibrate(300);
    mobileMovement.left = false;
    mobileMovement.right = false;
    const leftButton = document.getElementById('leftBtn') || document.getElementById('btn-mobile-left');
    const rightButton = document.getElementById('rightBtn') || document.getElementById('btn-mobile-right');
    if (leftButton) leftButton.classList.remove('is-pressed');
    if (rightButton) rightButton.classList.remove('is-pressed');
    stopMoving();
    
    if (score > bestScore) {
        bestScore = Math.floor(score);
    }
    saveData();
    
    document.getElementById('go-score').textContent = Math.floor(score);
    document.getElementById('go-best').textContent = bestScore;
    document.getElementById('go-coins').textContent = coins;
    const reviveButton = document.getElementById('btn-revive');
    if (reviveButton) {
        reviveButton.textContent = extraLife > 0 ? 'EXTRA LIFE READY' : 'WATCH AD';
    }
    
    document.getElementById('btn-fire').classList.add('hidden');
    showScreen('game-over-screen');
}

function goHome() {
    playSound('click');
    gameState = STATES.MENU;
    hideAllScreens();
    showScreen('start-screen');
}

function updateSettingsUI() {
    document.querySelector('#btn-toggle-sound .toggle-status').textContent = soundEnabled ? 'ON' : 'OFF';
    document.querySelector('#btn-toggle-vibration .toggle-status').textContent = vibrationEnabled ? 'ON' : 'OFF';
}

// --- EVENT LISTENERS ---

// Start Screen
document.getElementById('btn-play').addEventListener('click', startGame);
document.getElementById('btn-shop').addEventListener('click', () => {
    playSound('click');
    openShop();
});
document.getElementById('btn-how-to').addEventListener('click', () => {
    playSound('click');
    gameState = STATES.HOW_TO_PLAY;
    showScreen('how-to-screen');
});
document.getElementById('btn-settings').addEventListener('click', () => {
    playSound('click');
    gameState = STATES.SETTINGS;
    showScreen('settings-screen');
});

// Shop

document.getElementById('btn-upgrade-ammo').addEventListener('click', () => {
    playSound('click');
    upgradeAmmoStorage();
});
document.getElementById('btn-buy-ammo').addEventListener('click', () => {
    playSound('click');
    buyAmmo();
});
document.getElementById('btn-shop-back').addEventListener('click', () => {
    playSound('click');
    goHome();
});

// How To Play
document.getElementById('btn-how-to-back').addEventListener('click', goHome);

// Settings
document.getElementById('btn-settings-back').addEventListener('click', () => {
    saveData();
    goHome();
});
document.getElementById('btn-toggle-sound').addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    updateSettingsUI();
    playSound('click');
});
document.getElementById('btn-toggle-vibration').addEventListener('click', () => {
    vibrationEnabled = !vibrationEnabled;
    updateSettingsUI();
    playSound('click');
    vibrate(50);
});

// Pause
document.getElementById('btn-pause').addEventListener('click', pauseGame);
document.getElementById('btn-resume').addEventListener('click', resumeGame);
document.getElementById('btn-restart-pause').addEventListener('click', startGame);
document.getElementById('btn-home-pause').addEventListener('click', goHome);

// Game Over
document.getElementById('btn-play-again').addEventListener('click', startGame);
document.getElementById('btn-home-go').addEventListener('click', goHome);
document.getElementById('btn-revive').addEventListener('click', () => {
    playSound('click');
    if (extraLife > 0 || extraLifeRewardInFlight || gameState !== STATES.GAME_OVER) {
        return;
    }
    // Development integration point. Replace this with the real rewarded-ad callback when available.
    grantExtraLife();
});

document.getElementById('btn-fire').addEventListener('click', () => {
    fireBullet();
});

// --- INITIALIZE ---
loadData();
updateShopUI();
showScreen('start-screen');
requestAnimationFrame(loop);
