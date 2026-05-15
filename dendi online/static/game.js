const socket = io();
const canvas = document.getElementById('nes-canvas');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');
const romUpload = document.getElementById('rom-upload');
const debugConsole = document.getElementById('debug-console');

// UI Elements
const lobby = document.getElementById('lobby');
const lobbyMain = document.getElementById('lobby-main');
const lobbyCreate = document.getElementById('lobby-create');
const lobbyJoin = document.getElementById('lobby-join');
const gameUI = document.getElementById('game-ui');
const generatedCodeSpan = document.getElementById('generated-code');
const roomCodeDisplay = document.getElementById('room-code-display');
const joinCodeInput = document.getElementById('join-code-input');

let room = '';
let localPlayer = 1;
let isRomLoaded = false;
let gameInterval = null;

function log(msg) {
    console.log(msg);
    const div = document.createElement('div');
    div.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
    debugConsole.appendChild(div);
    debugConsole.scrollTop = debugConsole.scrollHeight;
}

let firstFrameLogged = false;
// Initialize JSNES
const nes = new jsnes.NES({
    onFrame: (frameBuffer) => {
        if (!firstFrameLogged) {
            log("Эмулятор начал отрисовку кадров.");
            firstFrameLogged = true;
        }
        const imageData = ctx.getImageData(0, 0, 256, 240);
        const data = imageData.data;
        for (let i = 0; i < 256 * 240; i++) {
            const pixel = frameBuffer[i];
            data[i * 4] = (pixel >> 16) & 0xFF;
            data[i * 4 + 1] = (pixel >> 8) & 0xFF;
            data[i * 4 + 2] = pixel & 0xFF;
            data[i * 4 + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
    }
});

// Lobby Functions
function showCreateRoom() {
    lobbyMain.style.display = 'none';
    lobbyCreate.style.display = 'block';
}

function showJoinRoom() {
    lobbyMain.style.display = 'none';
    lobbyJoin.style.display = 'block';
}

function backToLobby() {
    lobbyMain.style.display = 'block';
    lobbyCreate.style.display = 'none';
    lobbyJoin.style.display = 'none';
}

function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function startAsPlayer1(code) {
    room = code;
    localPlayer = 1;
    socket.emit('join', { room });
    lobby.style.display = 'none';
    gameUI.style.display = 'block';
    log(`Комната создана: ${room}. Вы Игрок 1.`);
}

function joinRoomByCode() {
    const code = joinCodeInput.value.trim();
    if (code.length === 4) {
        room = code;
        localPlayer = 2;
        socket.emit('join', { room }); // Server will auto-send ROM if exists
        lobby.style.display = 'none';
        gameUI.style.display = 'block';
        log(`Вход в комнату: ${room}. Вы Игрок 2.`);
    } else {
        alert("Введите 4-значный код!");
    }
}

function requestSync() {
    log("Запрос ссылки на игру у Игрока 1...");
    socket.emit('request_sync', { room });
}

// Optimized Binary String conversion
function arrayBufferToBinaryString(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i += 8192) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, len)));
    }
    return binary;
}

// ROM Loading
romUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const code = generateRoomCode();
    generatedCodeSpan.innerText = code;
    roomCodeDisplay.style.display = 'block';
    log(`Подготовка комнаты ${code}...`);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('room', code);

    try {
        log("Загрузка игры на сервер...");
        const response = await fetch('/upload', { method: 'POST', body: formData });
        const data = await response.json();
        
        if (data.url) {
            log("Игра загружена на сервер.");
            const reader = new FileReader();
            reader.onload = (event) => {
                const binary = arrayBufferToBinaryString(event.target.result);
                nes.loadROM(binary);
                isRomLoaded = true;
                log("Игра запущена локально.");
                
                startAsPlayer1(code);
                socket.emit('share_rom', { room, url: data.url }); 
                startGameLoop();
            };
            reader.readAsArrayBuffer(file);
        }
    } catch (err) {
        log(`Ошибка загрузки: ${err.message}`);
    }
});

// Multiplayer Sync
socket.on('load_rom', async (data) => {
    if (!isRomLoaded && data.url) {
        log(`Загрузка игры: ${data.url}`);
        try {
            const response = await fetch(data.url);
            if (!response.ok) {
                throw new Error(`Ошибка сервера: ${response.status} ${response.statusText}`);
            }
            const buffer = await response.arrayBuffer();
            log(`Скачано байт: ${buffer.byteLength}`);
            
            if (buffer.byteLength < 100) {
                const text = new TextDecoder().decode(buffer);
                log(`Ошибка: файл слишком мал. Ответ: ${text}`);
                return;
            }

            const binary = arrayBufferToBinaryString(buffer);
            nes.loadROM(binary);
            isRomLoaded = true;
            log("Игра успешно скачана и запущена!");
            startGameLoop();
        } catch (err) {
            log(`Ошибка скачивания игры: ${err.message}`);
        }
    }
});

socket.on('apply_state', (data) => {
    if (isRomLoaded && localPlayer === 2) {
        try {
            nes.fromJSON(data.state);
            if (!window.firstSyncDone) {
                log("Первая синхронизация состояния выполнена!");
                window.firstSyncDone = true;
            }
        } catch (err) {
            log(`Ошибка синхронизации состояния: ${err.message}`);
        }
    }
});

socket.on('request_sync', (data) => {
    if (localPlayer === 1 && isRomLoaded) {
        log("Игрок 2 запросил данные. Синхронизируем состояние...");
        socket.emit('sync_state', { room, state: nes.toJSON() });
    }
});

socket.on('input', (data) => {
    if (isRomLoaded) {
        if (data.type === 'down') {
            nes.buttonDown(data.player, KEY_MAP[data.key]);
        } else {
            nes.buttonUp(data.player, KEY_MAP[data.key]);
        }
    }
});

// Controls Logic
const KEY_MAP = {
    0: jsnes.Controller.BUTTON_UP,
    1: jsnes.Controller.BUTTON_LEFT,
    2: jsnes.Controller.BUTTON_RIGHT,
    3: jsnes.Controller.BUTTON_DOWN,
    4: jsnes.Controller.BUTTON_SELECT,
    5: jsnes.Controller.BUTTON_START,
    6: jsnes.Controller.BUTTON_B,
    7: jsnes.Controller.BUTTON_A
};

function setPlayer(num) {
    localPlayer = num;
    log(`Вы Игрок ${num}`);
    if (num === 2) requestSync();
}

document.querySelectorAll('.btn').forEach(btn => {
    const key = parseInt(btn.dataset.key);
    const handlePress = (e) => {
        e.preventDefault();
        if (!isRomLoaded) return;
        nes.buttonDown(localPlayer, KEY_MAP[key]);
        socket.emit('input', { room, player: localPlayer, key, type: 'down' });
    };
    const handleRelease = (e) => {
        e.preventDefault();
        if (!isRomLoaded) return;
        nes.buttonUp(localPlayer, KEY_MAP[key]);
        socket.emit('input', { room, player: localPlayer, key, type: 'up' });
    };
    btn.addEventListener('touchstart', handlePress);
    btn.addEventListener('touchend', handleRelease);
    btn.addEventListener('mousedown', handlePress);
    btn.addEventListener('mouseup', handleRelease);
});

function startGameLoop() {
    if (gameInterval) clearInterval(gameInterval);
    log("Игра запущена. Ожидание первого кадра...");
    gameInterval = setInterval(() => {
        nes.frame();
        // Player 1 periodically sends state (every 2 seconds to not overload)
        if (localPlayer === 1 && isRomLoaded && Math.random() < 0.008) { 
            const state = nes.toJSON();
            // log(`Отправка состояния (${JSON.stringify(state).length} байт)`);
            socket.emit('sync_state', { room, state: state });
        }
    }, 1000 / 60);
}

// Keyboard
const KB_MAP = { 38: 0, 37: 1, 39: 2, 40: 3, 16: 4, 13: 5, 88: 6, 90: 7 };
window.addEventListener('keydown', (e) => {
    if (isRomLoaded && KB_MAP[e.keyCode] !== undefined) {
        const key = KB_MAP[e.keyCode];
        nes.buttonDown(localPlayer, KEY_MAP[key]);
        socket.emit('input', { room, player: localPlayer, key, type: 'down' });
    }
});
window.addEventListener('keyup', (e) => {
    if (isRomLoaded && KB_MAP[e.keyCode] !== undefined) {
        const key = KB_MAP[e.keyCode];
        nes.buttonUp(localPlayer, KEY_MAP[key]);
        socket.emit('input', { room, player: localPlayer, key, type: 'up' });
    }
});
