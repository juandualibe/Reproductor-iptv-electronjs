// ===== VARIABLES GLOBALES =====
const { ipcRenderer } = require('electron');

let channels = [];
let filteredChannels = [];
let categories = new Map();
let favorites = new Set();
let currentChannel = null;
let currentCategory = 'all';
let currentView = 'grid';

// Variables para el nuevo reproductor
let player = null;
let connectionAttempts = 0;
const MAX_ATTEMPTS = 3;

// Variables para virtualización y rendimiento
let visibleChannels = [];
let channelsPerPage = 50;
let currentPage = 0;
let totalPages = 0;

// ===== NUEVAS VARIABLES PARA EPG =====
let epgData = null;
let currentProgram = null;
let epgUpdateInterval = null;

// Elementos del DOM
const elements = {
    categoriesList: document.getElementById('categoriesList'),
    channelsContainer: document.getElementById('channelsContainer'),
    searchInput: document.getElementById('searchInput'),
    videoPlayer: document.getElementById('videoPlayer'),
    videoOverlay: document.getElementById('videoOverlay'),
    currentChannelName: document.getElementById('currentChannelName'),
    currentCategoryTitle: document.getElementById('currentCategoryTitle'),
    addPlaylistModal: document.getElementById('addPlaylistModal'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    nowPlaying: document.getElementById('nowPlaying'),
    channelLogo: document.getElementById('channelLogo'),
    channelTitle: document.getElementById('channelTitle'),
    channelCategory: document.getElementById('channelCategory'),
    favoriteBtn: document.getElementById('favoriteBtn'),
    playlistUrl: document.getElementById('playlistUrl'),
    playlistName: document.getElementById('playlistName'),
    loadBtn: document.getElementById('loadBtn'),
    loadingText: document.getElementById('loadingText'),
    allCount: document.getElementById('allCount'),
    favCount: document.getElementById('favCount'),
    vlcBtn: document.getElementById('vlcBtn'),
    copyBtn: document.getElementById('copyBtn'),
    epgUrl: document.getElementById('epgUrl')
};

// ===== INICIALIZACIÓN =====
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 IPTV Player iniciando...');
    loadFavorites();
    setupEventListeners();
    initializePlayer();
    
    // Cargar datos guardados si existen
    const savedChannels = localStorage.getItem('iptv_channels');
    if (savedChannels) {
        try {
            channels = JSON.parse(savedChannels);
            processChannels();
            console.log(`✅ Cargados ${channels.length} canales desde localStorage`);
            
            // Cargar EPG guardado si existe
            loadSavedEPG();
        } catch (error) {
            console.error('❌ Error cargando canales guardados:', error);
        }
    } else {
        // Si no hay canales, verificar si hay EPG solo
        loadSavedEPG();
    }
});

// ===== INICIALIZAR VIDEO.JS =====
function initializePlayer() {
    try {
        if (typeof videojs !== 'undefined') {
            player = videojs('videoPlayer', {
                controls: true,
                fluid: true,
                responsive: true,
                preload: 'auto',
                html5: {
                    hls: {
                        enableLowInitialPlaylist: true,
                        smoothQualityChange: true,
                        overrideNative: true
                    }
                },
                sources: []
            });

            player.ready(() => {
                console.log('✅ Video.js reproductor listo');
            });

            player.on('loadstart', () => {
                console.log('🎬 Cargando video...');
                updateConnectionStatus('Conectando...', 'loading');
            });

            player.on('canplay', () => {
                console.log('✅ Video listo para reproducir');
                elements.videoOverlay.style.display = 'none';
                updateConnectionStatus('Conectado', 'success');
                connectionAttempts = 0;
            });

            player.on('error', (error) => {
                console.error('❌ Error en el reproductor:', error);
                handleVideoError();
            });

            player.on('play', () => {
                updateConnectionStatus('Reproduciendo', 'success');
            });

            player.on('pause', () => {
                updateConnectionStatus('Pausado', 'warning');
            });

        } else {
            console.warn('⚠️ Video.js no disponible, usando reproductor básico');
            fallbackToBasicPlayer();
        }
    } catch (error) {
        console.error('❌ Error inicializando reproductor:', error);
        fallbackToBasicPlayer();
    }
}

// ===== FUNCIÓN DE DEBUG =====
function debugChannel(channel, index) {
    console.log(`🔍 Canal ${index}:`, {
        name: channel.name,
        nameLength: channel.name?.length,
        hasSpecialChars: /[^\x00-\x7F]/.test(channel.name || ''),
        group: channel.group,
        logo: channel.logo?.substring(0, 50) + '...',
        url: channel.url?.substring(0, 50) + '...'
    });
}

// ===== CONFIGURACIÓN DE EVENT LISTENERS OPTIMIZADA =====
function setupEventListeners() {
    // Remover listeners anteriores si existen
    if (elements.searchInput._searchHandler) {
        elements.searchInput.removeEventListener('input', elements.searchInput._searchHandler);
    }
    
    // Crear nuevo handler con debounce mejorado
    const searchHandler = debounce(searchChannels, 300);
    elements.searchInput._searchHandler = searchHandler;
    elements.searchInput.addEventListener('input', searchHandler);
    
    // ===== NUEVO: Fix para bloqueo de teclado =====
    // Forzar re-enfoque periódico
    elements.searchInput.addEventListener('focus', () => {
        console.log('🔍 Campo de búsqueda enfocado');
        elements.searchInput.setAttribute('tabindex', '0');
    });
    
    elements.searchInput.addEventListener('blur', () => {
        console.log('👻 Campo de búsqueda desenfocado');
    });
    
    // Re-habilitar input si se detecta bloqueo
    setInterval(() => {
        if (document.activeElement !== elements.searchInput && 
            !document.querySelector('.modal.show') && 
            !document.getElementById('urlModal')) {
            
            // Verificar si el input está "muerto"
            const testValue = elements.searchInput.value;
            elements.searchInput.blur();
            setTimeout(() => {
                elements.searchInput.focus();
                elements.searchInput.value = testValue;
            }, 10);
        }
    }, 30000); // Cada 30 segundos
    
    // Teclas de acceso rápido mejoradas
    document.removeEventListener('keydown', handleKeyboard);
    document.addEventListener('keydown', handleKeyboardImproved);
}

function handleKeyboardImproved(event) {
    // Si hay modal abierto, solo manejar ESC
    if (document.querySelector('.modal.show') || document.getElementById('urlModal')) {
        if (event.key === 'Escape') {
            hideAddPlaylistModal();
            hideManagementModal();
            hideExportModal();
            closeUrlModal();
        }
        return;
    }
    
    // Si el foco está en un input, permitir tipeo normal
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
        return;
    }
    
    switch (event.key) {
        case ' ':
            event.preventDefault();
            if (player && typeof player.paused === 'function') {
                if (player.paused()) {
                    player.play();
                } else {
                    player.pause();
                }
            } else if (elements.videoPlayer.paused) {
                elements.videoPlayer.play();
            } else {
                elements.videoPlayer.pause();
            }
            break;
        case 'f':
        case 'F':
            toggleFullscreen();
            break;
        case '/':
            event.preventDefault();
            elements.searchInput.focus();
            elements.searchInput.select();
            break;
        case 'Escape':
            elements.searchInput.blur();
            break;
    }
}

// ===== FUNCIONES DE CONTROL DE VENTANA =====
async function minimizeWindow() {
    try {
        await ipcRenderer.invoke('window-minimize');
    } catch (error) {
        console.error('Error minimizando:', error);
    }
}

async function maximizeWindow() {
    try {
        await ipcRenderer.invoke('window-maximize');
    } catch (error) {
        console.error('Error maximizando:', error);
    }
}

async function closeWindow() {
    try {
        await ipcRenderer.invoke('window-close');
    } catch (error) {
        console.error('Error cerrando:', error);
    }
}

// ===== GESTIÓN DE PLAYLISTS M3U CON EPG =====
function showAddPlaylistModal() {
    elements.addPlaylistModal.classList.add('show');
    elements.playlistUrl.focus();
}

// ===== FUNCIÓN ACTUALIZADA hideAddPlaylistModal =====
function hideAddPlaylistModal() {
    elements.addPlaylistModal.classList.remove('show');
    elements.playlistUrl.value = '';
    elements.playlistName.value = '';
    elements.epgUrl.value = '';
    
    // Limpiar EPG del tab de archivo si existe
    const epgUrlFile = document.getElementById('epgUrlFile');
    if (epgUrlFile) {
        epgUrlFile.value = '';
    }
    
    // Limpiar selección de archivo
    if (typeof clearFileSelection === 'function') {
        clearFileSelection();
    }
    
    // Volver a pestaña URL
    if (typeof switchTab === 'function') {
        switchTab('url');
    }
}

function handlePlaylistUrlKeydown(event) {
    if (event.key === 'Enter') {
        loadPlaylist();
    }
}

async function loadPlaylist() {
    const url = elements.playlistUrl.value.trim();
    const epgUrl = elements.epgUrl.value.trim() || document.getElementById('epgUrlFile').value.trim();
    const name = elements.playlistName.value.trim() || 'Lista M3U';
    
    // ===== NUEVO: Detectar si es carga de archivo o URL =====
    const isFileUpload = currentTab === 'file' && selectedFile;
    
    if (!url && !epgUrl && !isFileUpload) {
        alert('Por favor selecciona un archivo M3U, ingresa una URL, o proporciona un EPG');
        return;
    }
    
    // Si solo hay EPG, cargar EPG únicamente
    if (!url && !isFileUpload && epgUrl) {
        showLoading('Cargando guía de programas (EPG)...');
        elements.loadBtn.disabled = true;
        
        try {
            const success = await loadEPG(epgUrl);
            
            if (success) {
                hideAddPlaylistModal();
                hideLoading();
                showNotification('✅ EPG cargado exitosamente', 'success');
                
                if (currentChannel) {
                    updateCurrentProgram();
                }
            } else {
                hideLoading();
            }
        } catch (error) {
            console.error('❌ Error cargando EPG:', error);
            hideLoading();
            alert(`Error cargando EPG: ${error.message}`);
        } finally {
            elements.loadBtn.disabled = false;
        }
        return;
    }
    
    // Validar URL M3U si se usa URL
    if (url && !url.match(/^https?:\/\/.+/)) {
        alert('La URL debe comenzar con http:// o https://');
        return;
    }
    
    showLoading(isFileUpload ? 'Cargando archivo M3U...' : 'Descargando lista M3U...');
    elements.loadBtn.disabled = true;
    
    try {
        let m3uContent = '';
        
        // ===== NUEVO: Cargar desde archivo o URL =====
        if (isFileUpload) {
            console.log('📁 Cargando desde archivo:', selectedFile.name);
            elements.loadingText.textContent = 'Leyendo archivo...';
            m3uContent = await loadLocalFile(selectedFile);
        } else if (url) {
            console.log('📥 Descargando playlist:', url);
            const result = await ipcRenderer.invoke('load-m3u', url);
            
            if (!result.success) {
                throw new Error(result.error);
            }
            
            m3uContent = result.data;
        }
        
        if (m3uContent) {
            elements.loadingText.textContent = 'Procesando canales...';
            
            const parsedChannels = await parseM3UAsync(m3uContent);
            
            if (parsedChannels.length === 0) {
                throw new Error('No se encontraron canales en la lista M3U');
            }
            
            elements.loadingText.textContent = 'Organizando canales...';
            
            const sourceInfo = isFileUpload ? 
                `archivo local: ${selectedFile.name}` : 
                `URL: ${url}`;
            
            await processChannelsAsync(parsedChannels, name, sourceInfo, epgUrl);
        }
        
        // Cargar EPG si se proporciona
        if (epgUrl) {
            elements.loadingText.textContent = 'Cargando guía de programas (EPG)...';
            await loadEPG(epgUrl);
        }
        
        hideAddPlaylistModal();
        hideLoading();
        
        // Mensaje de éxito dinámico
        let successMessage = '';
        const sourceType = isFileUpload ? 'archivo' : 'URL';
        
        if ((url || isFileUpload) && epgUrl) {
            successMessage = `✅ Lista cargada desde ${sourceType}: ${channels.length} canales + EPG`;
        } else if (url || isFileUpload) {
            successMessage = `✅ Lista cargada desde ${sourceType}: ${channels.length} canales`;
        } else if (epgUrl) {
            successMessage = '✅ EPG actualizado exitosamente';
        }
        
        console.log(successMessage);
        showNotification(successMessage, 'success');
        
    } catch (error) {
        console.error('❌ Error cargando:', error);
        hideLoading();
        alert(`Error: ${error.message}`);
    } finally {
        elements.loadBtn.disabled = false;
    }
}

// ===== NUEVAS FUNCIONES EPG =====
async function loadEPG(epgUrl) {
    try {
        console.log('📺 Cargando EPG desde:', epgUrl);
        
        const result = await ipcRenderer.invoke('load-epg', epgUrl);
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        console.log('📋 Parseando datos EPG...');
        epgData = parseEPG(result.data);
        
        // Guardar EPG en localStorage
        localStorage.setItem('iptv_epg_data', JSON.stringify({
            url: epgUrl,
            data: epgData,
            loadedAt: new Date().toISOString()
        }));
        
        console.log(`✅ EPG procesado: ${Object.keys(epgData).length} canales con programación`);
        
        // Iniciar actualización automática de programas
        startEPGUpdates();
        
        // Mostrar estado EPG y actualizar programa actual
        showEPGStatus(true);
        
        // Si hay canal seleccionado, actualizar inmediatamente
        if (currentChannel) {
            updateCurrentProgram();
        }
        
        console.log('🎯 EPG activado - Programación disponible');
        
        return true;
    } catch (error) {
        console.error('❌ Error cargando EPG:', error);
        showEPGStatus(false);
        showNotification('⚠️ Error cargando EPG: ' + error.message, 'error');
        return false;
    }
}

function parseEPG(xmlData) {
    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlData, 'text/xml');
        
        const channels = {};
        const programmes = xmlDoc.getElementsByTagName('programme');
        
        console.log(`📊 Procesando ${programmes.length} programas...`);
        
        for (let i = 0; i < programmes.length; i++) {
            const programme = programmes[i];
            const channelId = programme.getAttribute('channel');
            const start = programme.getAttribute('start');
            const stop = programme.getAttribute('stop');
            
            const titleElement = programme.getElementsByTagName('title')[0];
            const descElement = programme.getElementsByTagName('desc')[0];
            
            if (!channels[channelId]) {
                channels[channelId] = [];
            }
            
            channels[channelId].push({
                title: titleElement ? titleElement.textContent : 'Sin título',
                description: descElement ? descElement.textContent : '',
                start: parseEPGTime(start),
                stop: parseEPGTime(stop),
                startRaw: start,
                stopRaw: stop
            });
        }
        
        // Ordenar programas por hora de inicio
        Object.keys(channels).forEach(channelId => {
            channels[channelId].sort((a, b) => a.start - b.start);
        });
        
        return channels;
    } catch (error) {
        console.error('❌ Error parseando EPG:', error);
        return {};
    }
}

function parseEPGTime(timeString) {
    if (!timeString) return null;
    
    // Formato típico: 20251008214952 +0000
    const cleanTime = timeString.replace(/\s.*$/, ''); // Remover timezone
    const year = cleanTime.substring(0, 4);
    const month = cleanTime.substring(4, 6);
    const day = cleanTime.substring(6, 8);
    const hour = cleanTime.substring(8, 10);
    const minute = cleanTime.substring(10, 12);
    const second = cleanTime.substring(12, 14);
    
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
}

function loadSavedEPG() {
    const savedEPG = localStorage.getItem('iptv_epg_data');
    if (savedEPG) {
        try {
            const epgInfo = JSON.parse(savedEPG);
            epgData = epgInfo.data;
            
            console.log(`📺 EPG restaurado desde cache (${Object.keys(epgData).length} canales)`);
            
            startEPGUpdates();
            showEPGStatus(true);
        } catch (error) {
            console.error('❌ Error cargando EPG guardado:', error);
        }
    }
}

function startEPGUpdates() {
    // Limpiar intervalo anterior si existe
    if (epgUpdateInterval) {
        clearInterval(epgUpdateInterval);
    }
    
    // Actualizar cada 30 segundos
    epgUpdateInterval = setInterval(() => {
        if (currentChannel) {
            updateCurrentProgram();
        }
    }, 30000);
    
    console.log('⏰ Actualizador EPG iniciado (cada 30 segundos)');
}

function updateCurrentProgram() {
    if (!currentChannel || !epgData) {
        console.log('⚠️ No se puede actualizar programa: canal o EPG faltante');
        return;
    }
    
    const now = new Date();
    console.log(`🔍 Buscando programa para "${currentChannel.name}" a las ${now.toLocaleTimeString()}`);
    
    const program = getCurrentProgram(currentChannel.name, now);
    
    // Limpiar programa anterior
    const existingProgram = elements.nowPlaying.querySelector('.program-info');
    if (existingProgram) {
        existingProgram.remove();
    }
    
    if (program) {
        const programInfo = document.createElement('div');
        programInfo.className = 'program-info';
        
        const timeFormat = { hour: '2-digit', minute: '2-digit', hour12: false };
        const startTime = program.start.toLocaleTimeString('es-ES', timeFormat);
        const stopTime = program.stop.toLocaleTimeString('es-ES', timeFormat);
        
        programInfo.innerHTML = `
            <div class="current-program">
                <strong>🎬 ${escapeHtml(program.title)}</strong>
                <p>${escapeHtml(program.description || 'Sin descripción disponible')}</p>
                <small>⏰ ${startTime} - ${stopTime}</small>
            </div>
        `;
        
        elements.nowPlaying.appendChild(programInfo);
        
        console.log(`✅ Programa encontrado: "${program.title}" (${startTime} - ${stopTime})`);
    } else {
        // Mostrar que no hay programa pero EPG está activo
        const programInfo = document.createElement('div');
        programInfo.className = 'program-info no-program';
        
        programInfo.innerHTML = `
            <div class="current-program">
                <strong>📺 ${escapeHtml(currentChannel.name)}</strong>
                <p>No hay información de programación disponible para este momento</p>
                <small>⏰ ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false })}</small>
            </div>
        `;
        
        elements.nowPlaying.appendChild(programInfo);
        
        console.log(`ℹ️ Sin programa actual para "${currentChannel.name}"`);
        
        // Debug: mostrar IDs disponibles
        console.log('🔍 EPG disponible para:', Object.keys(epgData).slice(0, 10));
    }
}

function getCurrentProgram(channelName, currentTime) {
    if (!epgData) {
        console.log('❌ No hay datos EPG disponibles');
        return null;
    }
    
    // Buscar por varios métodos
    const possibleIds = [
        channelName,
        channelName.toLowerCase(),
        channelName.replace(/\s+/g, ''),
        channelName.replace(/[^a-zA-Z0-9]/g, ''),
        channelName.replace(/\s+/g, '_'),
        channelName.replace(/\s+/g, '-')
    ];
    
    console.log(`🔍 Buscando EPG para canal: "${channelName}"`);
    console.log('🎯 IDs a probar:', possibleIds);
    
    for (const id of possibleIds) {
        if (epgData[id]) {
            console.log(`✅ Encontrado EPG con ID: "${id}"`);
            const programs = epgData[id];
            
            console.log(`📋 ${programs.length} programas disponibles para "${id}"`);
            
            for (const program of programs) {
                if (program.start <= currentTime && program.stop > currentTime) {
                    console.log(`🎯 Programa actual encontrado: "${program.title}"`);
                    return program;
                }
            }
            
            console.log(`⏰ Sin programa en este horario para "${id}"`);
            break; // Si encontramos el canal pero no el programa, no buscar más
        }
    }
    
    console.log(`❌ No se encontró EPG para "${channelName}"`);
    return null;
}

function showEPGStatus(active) {
    // Limpiar estado anterior
    const existingStatus = document.querySelectorAll('.epg-status');
    existingStatus.forEach(status => status.remove());
    
    // Crear nuevo estado
    const statusDiv = document.createElement('div');
    statusDiv.className = `epg-status ${active ? 'active' : ''}`;
    
    if (active) {
        const channelCount = Object.keys(epgData).length;
        statusDiv.innerHTML = `
            <i class="fas fa-circle"></i>
            EPG Activo (${channelCount} canales con programación)
        `;
    } else {
        statusDiv.innerHTML = `
            <i class="fas fa-circle"></i>
            EPG Inactivo
        `;
    }
    
    // Agregar al panel principal
    elements.nowPlaying.appendChild(statusDiv);
    
    console.log(`📺 Estado EPG: ${active ? 'ACTIVO' : 'INACTIVO'}`);
}

// ===== PARSER M3U =====
function parseM3U(content) {
    const lines = content.split('\n').map(line => line.trim()).filter(line => line);
    const parsedChannels = [];
    
    let currentChannel = null;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.startsWith('#EXTINF:')) {
            currentChannel = parseExtinf(line);
        } else if (line.startsWith('http') && currentChannel) {
            currentChannel.url = line;
            currentChannel.id = generateChannelId(currentChannel.name, currentChannel.url);
            
            if (parsedChannels.length < 5) {
                debugChannel(currentChannel, parsedChannels.length);
            }
            
            parsedChannels.push(currentChannel);
            currentChannel = null;
        }
    }
    
    console.log(`📊 Parseados ${parsedChannels.length} canales exitosamente`);
    return parsedChannels;
}

// ===== FUNCIONES DE PROCESAMIENTO ASÍNCRONO =====
async function parseM3UAsync(content) {
    return new Promise((resolve) => {
        console.log('🔄 Iniciando procesamiento asíncrono...');
        
        const lines = content.split('\n').map(line => line.trim()).filter(line => line);
        const parsedChannels = [];
        
        let currentChannel = null;
        let processedLines = 0;
        
        function processChunk() {
            const chunkSize = 100; // Procesar 100 líneas por chunk
            const endIndex = Math.min(processedLines + chunkSize, lines.length);
            
            for (let i = processedLines; i < endIndex; i++) {
                const line = lines[i];
                
                if (line.startsWith('#EXTINF:')) {
                    currentChannel = parseExtinf(line);
                } else if (line.startsWith('http') && currentChannel) {
                    currentChannel.url = line;
                    currentChannel.id = generateChannelId(currentChannel.name, currentChannel.url);
                    
                    if (parsedChannels.length < 5) {
                        debugChannel(currentChannel, parsedChannels.length);
                    }
                    
                    parsedChannels.push(currentChannel);
                    currentChannel = null;
                }
            }
            
            processedLines = endIndex;
            
            // Actualizar progreso
            if (elements.loadingText) {
                const progress = Math.round((processedLines / lines.length) * 100);
                elements.loadingText.textContent = `Procesando canales... ${progress}%`;
            }
            
            if (processedLines < lines.length) {
                // Continuar en el siguiente frame
                setTimeout(processChunk, 0);
            } else {
                // Terminado
                console.log(`📊 Parseados ${parsedChannels.length} canales exitosamente (asíncrono)`);
                resolve(parsedChannels);
            }
        }
        
        // Iniciar procesamiento
        processChunk();
    });
}

async function processChannelsAsync(parsedChannels, name, url, epgUrl) {
    return new Promise((resolve) => {
        console.log('🔄 Procesando canales de forma asíncrona...');
        
        // Agregar metadata a los canales
        parsedChannels.forEach(channel => {
            channel.playlistName = name;
            channel.playlistUrl = url;
        });
        
        // Asignar canales
        channels = parsedChannels;
        
        // Guardar en localStorage en chunks para evitar bloqueos
        setTimeout(() => {
            try {
                localStorage.setItem('iptv_channels', JSON.stringify(channels));
                localStorage.setItem('iptv_playlist_info', JSON.stringify({
                    name: name,
                    url: url,
                    epgUrl: epgUrl,
                    loadedAt: new Date().toISOString(),
                    channelCount: channels.length
                }));
                
                console.log('💾 Datos guardados en localStorage');
            } catch (error) {
                console.warn('⚠️ Error guardando en localStorage:', error);
            }
            
            // Procesar categorías y renderizar
            processChannels();
            resolve();
        }, 0);
    });
}

function parseExtinf(line) {
    const channel = {
        name: '',
        logo: '',
        group: 'General',
        id: '',
        url: ''
    };
    
    try {
        const nameMatch = line.match(/,(.+)$/);
        if (nameMatch) {
            channel.name = nameMatch[1].trim();
            if (channel.name.length === 0) {
                channel.name = 'Canal sin nombre';
            }
        }
        
        const logoMatch = line.match(/tvg-logo="([^"]+)"/);
        if (logoMatch) {
            channel.logo = logoMatch[1];
        }
        
        const groupMatch = line.match(/group-title="([^"]+)"/);
        if (groupMatch) {
            channel.group = groupMatch[1] || 'General';
        }
        
        if (!channel.name || channel.name.trim() === '') {
            channel.name = 'Canal ' + Math.floor(Math.random() * 1000);
        }
        
    } catch (error) {
        console.warn('⚠️ Error parseando canal:', error);
        channel.name = 'Canal con error';
    }
    
    return channel;
}

function generateChannelId(name, url) {
    try {
        const cleanName = name.replace(/[^\x00-\x7F]/g, "");
        const cleanUrl = url.replace(/[^\x00-\x7F]/g, "");
        const combined = cleanName + cleanUrl;
        
        if (combined.length === 0) {
            return 'channel_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        }
        
        return btoa(combined).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
    } catch (error) {
        console.warn('⚠️ Error generando ID, usando fallback:', error);
        return 'channel_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
}

// ===== PROCESAMIENTO DE CANALES =====
function processChannels() {
    if (channels.length === 0) {
        renderEmptyState();
        return;
    }
    
    console.log(`🔄 Procesando ${channels.length} canales...`);
    
    // Limpiar estado anterior
    categories.clear();
    categories.set('all', channels.length);
    categories.set('favorites', favorites.size);
    
    // ===== NUEVO: Procesamiento por chunks para listas grandes =====
    if (channels.length > 1000) {
        console.log('📊 Lista grande detectada, procesando por chunks...');
        processLargeChannelList();
    } else {
        // Procesamiento normal para listas pequeñas
        channels.forEach(channel => {
            const group = channel.group || 'General';
            categories.set(group, (categories.get(group) || 0) + 1);
        });
        
        renderCategories();
        filterChannels();
        updateCounters();
    }
    
    console.log(`📁 Procesadas ${categories.size - 2} categorías`);
}

function processLargeChannelList() {
    let processedCount = 0;
    const chunkSize = 200;
    
    function processChunk() {
        const endIndex = Math.min(processedCount + chunkSize, channels.length);
        
        for (let i = processedCount; i < endIndex; i++) {
            const channel = channels[i];
            const group = channel.group || 'General';
            categories.set(group, (categories.get(group) || 0) + 1);
        }
        
        processedCount = endIndex;
        
        if (processedCount < channels.length) {
            // Continuar en el siguiente frame
            setTimeout(processChunk, 0);
        } else {
            // Terminado, renderizar
            renderCategories();
            filterChannels();
            updateCounters();
        }
    }
    
    processChunk();
}

function renderCategories() {
    const fixedCategories = elements.categoriesList.querySelectorAll('.category-item:nth-child(-n+2)');
    elements.categoriesList.innerHTML = '';
    fixedCategories.forEach(cat => elements.categoriesList.appendChild(cat));
    
    [...categories.keys()]
        .filter(cat => cat !== 'all' && cat !== 'favorites')
        .sort()
        .forEach(category => {
            const categoryElement = createCategoryElement(category, categories.get(category));
            elements.categoriesList.appendChild(categoryElement);
        });
}

function createCategoryElement(category, count) {
    const div = document.createElement('div');
    div.className = 'category-item';
    div.onclick = () => selectCategory(category);
    
    const icon = getCategoryIcon(category);
    
    div.innerHTML = `
        <i class="${icon}"></i>
        <span>${category}</span>
        <span class="channel-count">${count}</span>
    `;
    
    return div;
}

function getCategoryIcon(category) {
    const iconMap = {
        'deportes': 'fas fa-futbol',
        'sports': 'fas fa-futbol',
        'noticias': 'fas fa-newspaper',
        'news': 'fas fa-newspaper',
        'peliculas': 'fas fa-film',
        'movies': 'fas fa-film',
        'entretenimiento': 'fas fa-star',
        'entertainment': 'fas fa-star',
        'infantil': 'fas fa-child',
        'kids': 'fas fa-child',
        'musica': 'fas fa-music',
        'music': 'fas fa-music',
        'documentales': 'fas fa-graduation-cap',
        'documentaries': 'fas fa-graduation-cap'
    };
    
    const normalizedCategory = category.toLowerCase();
    return iconMap[normalizedCategory] || 'fas fa-tv';
}

function selectCategory(category) {
    currentCategory = category;
    
    document.querySelectorAll('.category-item').forEach(item => {
        item.classList.remove('active');
    });
    
    document.querySelector(`[onclick="selectCategory('${category}')"]`)?.classList.add('active');
    
    const title = category === 'all' ? 'Todos los canales' :
                  category === 'favorites' ? 'Favoritos' : category;
    elements.currentCategoryTitle.textContent = title;
    
    filterChannels();
}

function filterChannels() {
    let filtered = channels;
    
    if (currentCategory === 'favorites') {
        filtered = channels.filter(channel => favorites.has(channel.id));
    } else if (currentCategory !== 'all') {
        filtered = channels.filter(channel => channel.group === currentCategory);
    }
    
    const searchTerm = elements.searchInput.value.toLowerCase().trim();
    if (searchTerm) {
        filtered = filtered.filter(channel =>
            channel.name.toLowerCase().includes(searchTerm) ||
            channel.group.toLowerCase().includes(searchTerm)
        );
    }
    
    filteredChannels = filtered;
    currentPage = 0;
    
    renderChannelsOptimized();
}

function searchChannels() {
    filterChannels();
}

function renderChannelsOptimized() {
    if (filteredChannels.length === 0) {
        renderEmptyChannels();
        return;
    }
    
    totalPages = Math.ceil(filteredChannels.length / channelsPerPage);
    const startIndex = currentPage * channelsPerPage;
    const endIndex = Math.min(startIndex + channelsPerPage, filteredChannels.length);
    visibleChannels = filteredChannels.slice(startIndex, endIndex);
    
    elements.channelsContainer.className = `channels-grid ${currentView}-view`;
    
    const channelsHTML = visibleChannels.map(channel => createChannelElement(channel)).join('');
    const paginationHTML = filteredChannels.length > channelsPerPage ? createPaginationControls() : '';
    
    elements.channelsContainer.innerHTML = channelsHTML + paginationHTML;
    
    console.log(`📺 Renderizados ${visibleChannels.length} de ${filteredChannels.length} canales`);
}

function createPaginationControls() {
    return `
        <div class="pagination-controls">
            <button class="btn-secondary ${currentPage === 0 ? 'disabled' : ''}" 
                    onclick="changePage(${currentPage - 1})" 
                    ${currentPage === 0 ? 'disabled' : ''}>
                <i class="fas fa-chevron-left"></i> Anterior
            </button>
            <span class="pagination-info">
                Página ${currentPage + 1} de ${totalPages} (${filteredChannels.length} canales)
            </span>
            <button class="btn-secondary ${currentPage >= totalPages - 1 ? 'disabled' : ''}" 
                    onclick="changePage(${currentPage + 1})"
                    ${currentPage >= totalPages - 1 ? 'disabled' : ''}>
                Siguiente <i class="fas fa-chevron-right"></i>
            </button>
        </div>
    `;
}

function changePage(newPage) {
    if (newPage >= 0 && newPage < totalPages) {
        currentPage = newPage;
        renderChannelsOptimized();
        elements.channelsContainer.scrollTop = 0;
    }
}

function renderChannels() {
    renderChannelsOptimized();
}

function createChannelElement(channel) {
    const isFavorite = favorites.has(channel.id);
    const isActive = currentChannel && currentChannel.id === channel.id;
    
    const defaultLogo = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiBmaWxsPSIjMjEyNjJkIiByeD0iOCIvPgo8dGV4dCB4PSIzMiIgeT0iMzgiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzU4YTZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+VFY8L3RleHQ+Cjwvc3ZnPg==';
    
    let logoSrc = defaultLogo;
    if (channel.logo && channel.logo.trim() !== '') {
        logoSrc = channel.logo;
    }
    
    const channelName = escapeHtml(channel.name || 'Canal sin nombre');
    const channelGroup = escapeHtml(channel.group || 'General');
    
    return `
        <div class="channel-item ${isActive ? 'active' : ''}" onclick="playChannel('${channel.id}')">
            ${isFavorite ? '<i class="fas fa-heart channel-favorite"></i>' : ''}
            <img class="channel-logo" src="${logoSrc}" alt="${channelName}" 
                 onerror="this.src='${defaultLogo}'">
            <div class="channel-info">
                <div class="channel-name" title="${channelName}">${channelName}</div>
                <div class="channel-category">${channelGroup}</div>
            </div>
        </div>
    `;
}

function renderEmptyChannels() {
    const message = currentCategory === 'favorites' ? 
        'No tienes canales favoritos aún' : 
        'No se encontraron canales';
    
    const actionButton = currentCategory === 'favorites' ? '' : 
        '<button class="btn-primary" onclick="showAddPlaylistModal()"><i class="fas fa-plus"></i> Agregar Lista M3U</button>';
    
    elements.channelsContainer.innerHTML = `
        <div class="no-channels">
            <i class="fas fa-tv"></i>
            <h3>${message}</h3>
            <p>Intenta con una búsqueda diferente o selecciona otra categoría</p>
            ${actionButton}
        </div>
    `;
}

function renderEmptyState() {
    // Verificar si hay EPG pero no canales
    const hasEPG = epgData && Object.keys(epgData).length > 0;
    
    if (hasEPG) {
        elements.channelsContainer.innerHTML = `
            <div class="no-channels">
                <i class="fas fa-tv"></i>
                <h3>EPG cargado - Faltan canales</h3>
                <p>Tienes ${Object.keys(epgData).length} canales con programación EPG, pero necesitas cargar una lista M3U para ver los canales</p>
                <button class="btn-primary" onclick="showAddPlaylistModal()">
                    <i class="fas fa-plus"></i> Agregar Lista M3U
                </button>
            </div>
        `;
    } else {
        elements.channelsContainer.innerHTML = `
            <div class="no-channels">
                <i class="fas fa-tv"></i>
                <h3>No hay canales cargados</h3>
                <p>Agrega una lista M3U para comenzar</p>
                <button class="btn-primary" onclick="showAddPlaylistModal()">
                    <i class="fas fa-plus"></i> Agregar Lista M3U
                </button>
            </div>
        `;
    }
    
    const fixedCategories = elements.categoriesList.querySelectorAll('.category-item:nth-child(-n+2)');
    elements.categoriesList.innerHTML = '';
    fixedCategories.forEach(cat => elements.categoriesList.appendChild(cat));
}

// ===== REPRODUCTOR DE VIDEO MEJORADO CON EPG =====
function playChannel(channelId) {
    const channel = channels.find(ch => ch.id === channelId);
    if (!channel) {
        console.error('❌ Canal no encontrado:', channelId);
        return;
    }
    
    console.log('🎬 Reproduciendo canal:', channel.name);
    console.log('🔗 URL:', channel.url);
    
    currentChannel = channel;
    connectionAttempts = 0;
    
    updateChannelSelection();
    updatePlayerInfo();
    
    // ===== NUEVO: Detectar URLs placeholder =====
    const isPlaceholderUrl = 
        channel.url.includes('TODO') || 
        channel.url.includes('ejemplo.com') || 
        channel.url.startsWith('#') ||
        channel.url.includes('placeholder') ||
        !channel.url.startsWith('http');
    
    if (isPlaceholderUrl) {
        console.log('⚠️ URL placeholder detectada:', channel.url);
        showPlaceholderInfo(channel);
        elements.nowPlaying.style.display = 'block';
        updateCurrentProgram(); // Mostrar EPG aunque no reproduzca
        return;
    }
    
    // Solo continuar si es URL real
    elements.videoOverlay.style.display = 'flex';
    updateConnectionStatus('Conectando al stream...', 'loading');
    
    if (player && typeof player.src === 'function') {
        try {
            player.src({
                src: channel.url,
                type: detectStreamType(channel.url)
            });
            
            player.load();
            
            setTimeout(() => {
                player.play().catch(e => {
                    console.warn('⚠️ Auto-play falló, requiere interacción del usuario');
                    updateConnectionStatus('Click para reproducir', 'warning');
                });
            }, 500);
            
        } catch (error) {
            console.error('❌ Error configurando Video.js:', error);
            fallbackPlayChannel(channel);
        }
    } else {
        fallbackPlayChannel(channel);
    }
    
    elements.nowPlaying.style.display = 'block';
    
    if (elements.vlcBtn) elements.vlcBtn.style.display = 'block';
    if (elements.copyBtn) elements.copyBtn.style.display = 'block';
    
    // Actualizar programa EPG
    updateCurrentProgram();
}

function detectStreamType(url) {
    const urlLower = url.toLowerCase();
    
    if (urlLower.includes('.m3u8')) {
        return 'application/x-mpegURL';
    } else if (urlLower.includes('.mpd')) {
        return 'application/dash+xml';
    } else if (urlLower.includes('.ts')) {
        return 'video/MP2T';
    } else if (urlLower.includes('.mp4')) {
        return 'video/mp4';
    } else {
        return 'application/x-mpegURL';
    }
}

function fallbackPlayChannel(channel) {
    console.log('📺 Usando reproductor básico para:', channel.name);
    
    const basicPlayer = document.getElementById('videoPlayer');
    if (basicPlayer && basicPlayer.tagName === 'VIDEO') {
        basicPlayer.src = channel.url;
        basicPlayer.load();
        
        basicPlayer.play().catch(e => {
            console.warn('⚠️ Reproductor básico falló:', e);
            showStreamInfo(channel);
        });
    }
}

function fallbackToBasicPlayer() {
    console.warn('⚠️ Video.js no disponible, usando reproductor básico');
}

function handleVideoError() {
    connectionAttempts++;
    
    if (connectionAttempts < MAX_ATTEMPTS) {
        console.log(`🔄 Reintentando conexión (${connectionAttempts}/${MAX_ATTEMPTS})...`);
        updateConnectionStatus(`Reintentando (${connectionAttempts}/${MAX_ATTEMPTS})...`, 'warning');
        
        setTimeout(() => {
            if (currentChannel) {
                playChannel(currentChannel.id);
            }
        }, 2000);
    } else {
        console.error('❌ Máximo de reintentos alcanzado');
        showStreamInfo(currentChannel);
    }
}

function showStreamInfo(channel) {
    if (!channel) return;
    
    elements.videoOverlay.innerHTML = `
        <div class="video-placeholder">
            <i class="fas fa-exclamation-triangle" style="color: var(--accent-warning);"></i>
            <h3>Stream no disponible</h3>
            <p>El canal "${channel.name}" no se puede reproducir directamente</p>
            <div class="stream-options">
                <button class="btn-primary" onclick="copyStreamUrl()">
                    <i class="fas fa-copy"></i> Copiar URL
                </button>
                <button class="btn-primary" onclick="openInVLC()">
                    <i class="fas fa-external-link-alt"></i> Abrir en VLC
                </button>
                <button class="btn-secondary" onclick="retryCurrentChannel()">
                    <i class="fas fa-redo"></i> Reintentar
                </button>
            </div>
        </div>
    `;
    elements.videoOverlay.style.display = 'flex';
}

function showPlaceholderInfo(channel) {
    elements.videoOverlay.innerHTML = `
        <div class="video-placeholder">
            <i class="fas fa-exclamation-circle" style="color: var(--accent-warning);"></i>
            <h3>URL Placeholder</h3>
            <p>El canal "${channel.name}" necesita una URL real de stream</p>
            <div class="placeholder-url" style="
                background: var(--bg-primary);
                padding: 8px 12px;
                border-radius: 4px;
                margin: 12px 0;
                border-left: 3px solid var(--accent-warning);
                font-family: monospace;
                font-size: 11px;
                color: var(--text-muted);
                word-break: break-all;
            ">
                ${channel.url}
            </div>
            <div class="stream-options">
                <button class="btn-primary" onclick="promptForRealUrl('${channel.id}')">
                    <i class="fas fa-edit"></i> Agregar URL Real
                </button>
                <button class="btn-secondary" onclick="copyPlaceholderUrl('${channel.id}')">
                    <i class="fas fa-copy"></i> Copiar Placeholder
                </button>
                <button class="btn-secondary" onclick="searchChannelUrl('${encodeURIComponent(channel.name)}')">
                    <i class="fas fa-search"></i> Buscar Stream
                </button>
            </div>
            ${channel.originalEpgId ? `
                <div style="margin-top: 12px; font-size: 10px; color: var(--text-muted);">
                    ID EPG: ${channel.originalEpgId}
                </div>
            ` : ''}
        </div>
    `;
    elements.videoOverlay.style.display = 'flex';
    
    // Mostrar controles aunque no reproduzca
    if (elements.vlcBtn) elements.vlcBtn.style.display = 'block';
    if (elements.copyBtn) elements.copyBtn.style.display = 'block';
}

function promptForRealUrl(channelId) {
    const channel = channels.find(ch => ch.id === channelId);
    if (!channel) return;
    
    // Crear modal para ingresar URL
    const modalHtml = `
        <div id="urlModal" style="
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 4000;
            backdrop-filter: blur(4px);
        ">
            <div style="
                background: var(--bg-secondary);
                border: 1px solid var(--border-primary);
                border-radius: 12px;
                width: 500px;
                max-width: 90vw;
                box-shadow: var(--shadow-lg);
                padding: 0;
            ">
                <div style="
                    padding: 20px 24px 16px;
                    border-bottom: 1px solid var(--border-primary);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                ">
                    <h3 style="
                        font-size: 18px;
                        font-weight: 600;
                        color: var(--text-primary);
                        margin: 0;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    ">
                        <i class="fas fa-edit"></i> Agregar URL Real
                    </h3>
                    <button onclick="closeUrlModal()" style="
                        width: 32px;
                        height: 32px;
                        border: none;
                        background: transparent;
                        color: var(--text-muted);
                        border-radius: 4px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    ">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div style="padding: 20px 24px;">
                    <div style="margin-bottom: 16px;">
                        <strong style="color: var(--text-primary);">Canal:</strong>
                        <span style="color: var(--text-secondary); margin-left: 8px;">${channel.name}</span>
                    </div>
                    
                    <div style="margin-bottom: 16px;">
                        <label style="
                            display: block;
                            font-size: 13px;
                            font-weight: 500;
                            margin-bottom: 6px;
                            color: var(--text-secondary);
                        ">URL del Stream:</label>
                        <input type="text" id="newUrlInput" placeholder="http://servidor.com/canal.m3u8" style="
                            width: 100%;
                            padding: 12px;
                            background: var(--bg-primary);
                            border: 2px solid var(--border-primary);
                            border-radius: 6px;
                            color: var(--text-primary);
                            font-size: 14px;
                            font-family: monospace;
                            box-sizing: border-box;
                        ">
                        <small style="
                            display: block;
                            font-size: 11px;
                            color: var(--text-muted);
                            margin-top: 4px;
                            font-style: italic;
                        ">Ejemplos: http://ejemplo.com/stream.m3u8 o rtmp://servidor.com/live/canal</small>
                    </div>
                    
                    <div style="
                        background: var(--bg-tertiary);
                        padding: 12px;
                        border-radius: 6px;
                        margin-bottom: 16px;
                        border-left: 3px solid var(--accent-warning);
                    ">
                        <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">URL Actual (Placeholder):</div>
                        <div style="
                            font-family: monospace;
                            font-size: 10px;
                            color: var(--text-secondary);
                            word-break: break-all;
                            background: var(--bg-primary);
                            padding: 6px;
                            border-radius: 3px;
                        ">${channel.url}</div>
                    </div>
                </div>
                
                <div style="
                    padding: 16px 24px 20px;
                    display: flex;
                    gap: 12px;
                    justify-content: flex-end;
                ">
                    <button onclick="closeUrlModal()" class="btn-secondary">
                        <i class="fas fa-times"></i> Cancelar
                    </button>
                    <button onclick="saveNewUrl('${channelId}')" class="btn-primary">
                        <i class="fas fa-save"></i> Guardar y Reproducir
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Enfocar el input
    setTimeout(() => {
        const input = document.getElementById('newUrlInput');
        if (input) {
            input.focus();
            // Permitir Enter para guardar
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    saveNewUrl(channelId);
                }
            });
        }
    }, 100);
}

function closeUrlModal() {
    const modal = document.getElementById('urlModal');
    if (modal) {
        modal.remove();
    }
}

function saveNewUrl(channelId) {
    const input = document.getElementById('newUrlInput');
    const newUrl = input ? input.value.trim() : '';
    
    if (!newUrl) {
        alert('⚠️ Por favor ingresa una URL');
        return;
    }
    
    if (!newUrl.startsWith('http') && !newUrl.startsWith('rtmp')) {
        alert('⚠️ La URL debe comenzar con http://, https:// o rtmp://');
        return;
    }
    
    const channel = channels.find(ch => ch.id === channelId);
    if (!channel) {
        alert('❌ Canal no encontrado');
        return;
    }
    
    // Actualizar URL
    const oldUrl = channel.url;
    channel.url = newUrl;
    
    // Guardar cambios
    localStorage.setItem('iptv_channels', JSON.stringify(channels));
    
    console.log(`✅ URL actualizada para ${channel.name}:`);
    console.log(`   Anterior: ${oldUrl}`);
    console.log(`   Nueva: ${newUrl}`);
    
    // Cerrar modal
    closeUrlModal();
    
    showNotification(`✅ URL actualizada para ${channel.name}`, 'success');
    
    // Reintentar reproducción automáticamente
    setTimeout(() => {
        console.log('🔄 Reintentando reproducción con nueva URL...');
        playChannel(channelId);
    }, 500);
}

function copyPlaceholderUrl(channelId) {
    const channel = channels.find(ch => ch.id === channelId);
    if (!channel) return;
    
    const textToCopy = `Canal: ${channel.name}\nID EPG: ${channel.originalEpgId || 'N/A'}\nURL Placeholder: ${channel.url}`;
    
    navigator.clipboard.writeText(textToCopy).then(() => {
        showNotification('✅ Información del canal copiada', 'success');
    }).catch(() => {
        // Fallback
        const textArea = document.createElement('textarea');
        textArea.value = textToCopy;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showNotification('✅ Información copiada', 'success');
    });
}

function searchChannelUrl(channelName) {
    const searchUrl = `https://www.google.com/search?q=${channelName}+stream+m3u8+iptv`;
    window.open(searchUrl, '_blank');
    showNotification('🔍 Búsqueda abierta en nueva ventana', 'info');
}

function updateConnectionStatus(message, type = 'info') {
    const statusEl = document.getElementById('connectionStatus');
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.className = `connection-status ${type}`;
    }
}

function copyStreamUrl() {
    if (!currentChannel) return;
    
    navigator.clipboard.writeText(currentChannel.url).then(() => {
        showNotification('✅ URL copiada al portapapeles', 'success');
    }).catch(() => {
        const textArea = document.createElement('textarea');
        textArea.value = currentChannel.url;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showNotification('✅ URL copiada', 'success');
    });
}

function openInVLC() {
    if (!currentChannel) return;
    
    const vlcUrl = `vlc://${currentChannel.url}`;
    window.open(vlcUrl, '_blank');
    
    showNotification('🎬 Abriendo en VLC...', 'info');
}

function retryCurrentChannel() {
    if (currentChannel) {
        connectionAttempts = 0;
        playChannel(currentChannel.id);
    }
}

function updateChannelSelection() {
    document.querySelectorAll('.channel-item').forEach(item => {
        item.classList.remove('active');
    });
    
    document.querySelector(`[onclick="playChannel('${currentChannel.id}')"]`)?.classList.add('active');
}

function updatePlayerInfo() {
    if (!currentChannel) return;
    
    elements.currentChannelName.textContent = currentChannel.name;
    elements.channelTitle.textContent = currentChannel.name;
    elements.channelCategory.textContent = currentChannel.group;
    
    const streamUrlEl = document.getElementById('streamUrl');
    if (streamUrlEl) {
        const truncatedUrl = currentChannel.url.length > 50 ? 
            currentChannel.url.substring(0, 50) + '...' : 
            currentChannel.url;
        streamUrlEl.textContent = truncatedUrl;
    }
    
    const logoSrc = currentChannel.logo || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQ4IiBoZWlnaHQ9IjQ4IiBmaWxsPSIjMjEyNjJkIiByeD0iOCIvPgo8dGV4dCB4PSIyNCIgeT0iMjgiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNiIgZmlsbD0iIzU4YTZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+VFY8L3RleHQ+Cjwvc3ZnPg==';
    elements.channelLogo.src = logoSrc;
    
    updateFavoriteButton();
}

function toggleFavorite() {
    if (!currentChannel) return;
    
    const channelId = currentChannel.id;
    
    if (favorites.has(channelId)) {
        favorites.delete(channelId);
        console.log('💔 Removido de favoritos:', currentChannel.name);
    } else {
        favorites.add(channelId);
        console.log('❤️ Agregado a favoritos:', currentChannel.name);
    }
    
    saveFavorites();
    updateFavoriteButton();
    updateCounters();
    
    if (currentCategory === 'favorites') {
        filterChannels();
    }
}

function updateFavoriteButton() {
    if (!currentChannel) return;
    
    const isFavorite = favorites.has(currentChannel.id);
    const icon = elements.favoriteBtn.querySelector('i');
    
    if (isFavorite) {
        icon.className = 'fas fa-heart';
        elements.favoriteBtn.classList.add('active');
        elements.favoriteBtn.title = 'Quitar de favoritos';
    } else {
        icon.className = 'far fa-heart';
        elements.favoriteBtn.classList.remove('active');
        elements.favoriteBtn.title = 'Agregar a favoritos';
    }
}

function saveFavorites() {
    localStorage.setItem('iptv_favorites', JSON.stringify([...favorites]));
}

function loadFavorites() {
    const saved = localStorage.getItem('iptv_favorites');
    if (saved) {
        try {
            const favArray = JSON.parse(saved);
            favorites = new Set(favArray);
            console.log(`❤️ Cargados ${favorites.size} favoritos`);
        } catch (error) {
            console.error('❌ Error cargando favoritos:', error);
        }
    }
}

function setView(view) {
    currentView = view;
    
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    document.querySelector(`[onclick="setView('${view}')"]`).classList.add('active');
    
    renderChannels();
    
    console.log('👁️ Vista cambiada a:', view);
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        elements.videoPlayer.requestFullscreen().catch(err => {
            console.error('❌ Error entrando a pantalla completa:', err);
        });
    } else {
        document.exitFullscreen();
    }
}

function handleKeyboard(event) {
    if (event.target.tagName === 'INPUT') return;
    
    switch (event.key) {
        case ' ':
            event.preventDefault();
            if (player && typeof player.paused === 'function') {
                if (player.paused()) {
                    player.play();
                } else {
                    player.pause();
                }
            } else if (elements.videoPlayer.paused) {
                elements.videoPlayer.play();
            } else {
                elements.videoPlayer.pause();
            }
            break;
        case 'f':
        case 'F':
            toggleFullscreen();
            break;
        case 'Escape':
            if (elements.addPlaylistModal.classList.contains('show')) {
                hideAddPlaylistModal();
            }
            break;
        case '/':
            event.preventDefault();
            elements.searchInput.focus();
            break;
    }
}

function showLoading(text = 'Cargando...') {
    elements.loadingText.textContent = text;
    elements.loadingOverlay.classList.add('show');
}

function hideLoading() {
    elements.loadingOverlay.classList.remove('show');
}

function updateCounters() {
    elements.allCount.textContent = channels.length;
    elements.favCount.textContent = favorites.size;
    
    categories.forEach((count, category) => {
        const element = document.querySelector(`[onclick="selectCategory('${category}')"] .channel-count`);
        if (element) {
            element.textContent = count;
        }
    });
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 16px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        color: var(--text-primary);
        z-index: 4000;
        animation: slideInRight 0.3s ease-out;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function escapeHtml(text) {
    if (!text) return '';
    
    try {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    } catch (error) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;');
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ===== GESTIÓN DE LISTAS =====
function showRemoveOptions() {
    const modal = document.getElementById('managementModal');
    const body = document.getElementById('managementBody');
    
    // Obtener información de las listas
    const playlistInfo = localStorage.getItem('iptv_playlist_info');
    const epgInfo = localStorage.getItem('iptv_epg_data');
    const channelsCount = channels.length;
    const favoritesCount = favorites.size;
    
    let content = '';
    
    if (channelsCount === 0 && !epgInfo) {
        content = `
            <div class="no-data">
                <i class="fas fa-inbox" style="font-size: 48px; color: var(--text-muted); margin-bottom: 16px;"></i>
                <h3 style="color: var(--text-secondary); margin-bottom: 8px;">No hay datos cargados</h3>
                <p style="color: var(--text-muted);">No tienes listas M3U ni EPG cargados</p>
            </div>
        `;
    } else if (channelsCount === 0 && epgInfo) {
        // Caso especial cuando solo hay EPG
        const epg = JSON.parse(epgInfo);
        const epgLoadedDate = new Date(epg.loadedAt).toLocaleString();
        const epgChannelsCount = Object.keys(epg.data).length;
        
        content = `
            <div class="playlist-info" style="border-left-color: var(--accent-warning);">
                <h4><i class="fas fa-tv"></i> Solo EPG Cargado</h4>
                <div class="playlist-stats">
                    <div class="stat-item">
                        <span>Canales con EPG:</span>
                        <span class="stat-value">${epgChannelsCount}</span>
                    </div>
                    <div class="stat-item">
                        <span>Cargado:</span>
                        <span class="stat-value">${epgLoadedDate}</span>
                    </div>
                </div>
                <div class="playlist-urls">
                    <div class="url-item">
                        <i class="fas fa-tv"></i>
                        <span>${epg.url}</span>
                    </div>
                </div>
            </div>
            
            <div class="info-box warning">
                <i class="fas fa-info-circle"></i>
                <div>
                    <h4>⚠️ Solo tienes EPG cargado</h4>
                    <p>El EPG contiene información de programación, pero necesitas una <strong>lista M3U</strong> para ver los canales.</p>
                    <p>🎯 <strong>Recomendación:</strong> Carga una lista M3U que coincida con este EPG para ver la programación completa.</p>
                </div>
            </div>
            
            <div class="quick-actions">
                <button class="btn-primary" onclick="hideManagementModal(); showAddPlaylistModal();">
                    <i class="fas fa-plus"></i> Agregar Lista M3U
                </button>
            </div>
            
            <div class="danger-zone">
                <h4><i class="fas fa-exclamation-triangle"></i> Eliminar EPG</h4>
                <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
                    Eliminar la información de programación cargada.
                </p>
                <div class="danger-actions">
                    <button class="btn-danger" onclick="removeEPG()">
                        <i class="fas fa-trash"></i> Eliminar EPG
                    </button>
                </div>
            </div>
        `;
    } else {
        // Información de la playlist
        if (playlistInfo && channelsCount > 0) {
            const info = JSON.parse(playlistInfo);
            const loadedDate = new Date(info.loadedAt).toLocaleString();
            
            content += `
                <div class="playlist-info">
                    <h4><i class="fas fa-list"></i> Lista M3U Actual</h4>
                    <div class="playlist-stats">
                        <div class="stat-item">
                            <span>Nombre:</span>
                            <span class="stat-value">${escapeHtml(info.name)}</span>
                        </div>
                        <div class="stat-item">
                            <span>Canales:</span>
                            <span class="stat-value">${channelsCount}</span>
                        </div>
                        <div class="stat-item">
                            <span>Favoritos:</span>
                            <span class="stat-value">${favoritesCount}</span>
                        </div>
                        <div class="stat-item">
                            <span>Cargada:</span>
                            <span class="stat-value">${loadedDate}</span>
                        </div>
                    </div>
                    <div class="playlist-urls">
                        <div class="url-item">
                            <i class="fas fa-link"></i>
                            <span>${info.url}</span>
                        </div>
                    </div>
                </div>
            `;
        }
        
        // Información del EPG
        if (epgInfo) {
            const epg = JSON.parse(epgInfo);
            const epgLoadedDate = new Date(epg.loadedAt).toLocaleString();
            const epgChannelsCount = Object.keys(epg.data).length;
            
            content += `
                <div class="playlist-info">
                    <h4><i class="fas fa-tv"></i> EPG Actual</h4>
                    <div class="playlist-stats">
                        <div class="stat-item">
                            <span>Canales con EPG:</span>
                            <span class="stat-value">${epgChannelsCount}</span>
                        </div>
                        <div class="stat-item">
                            <span>Cargado:</span>
                            <span class="stat-value">${epgLoadedDate}</span>
                        </div>
                    </div>
                    <div class="playlist-urls">
                        <div class="url-item">
                            <i class="fas fa-tv"></i>
                            <span>${epg.url}</span>
                        </div>
                    </div>
                </div>
            `;
        }
        
        // Zona de peligro
        content += `
            <div class="danger-zone">
                <h4><i class="fas fa-exclamation-triangle"></i> Zona de Peligro</h4>
                <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
                    Estas acciones son permanentes y no se pueden deshacer.
                </p>
                <div class="danger-actions">
        `;
        
        if (epgInfo) {
            content += `
                <button class="btn-danger secondary" onclick="removeEPG()">
                    <i class="fas fa-tv"></i> Eliminar EPG
                </button>
            `;
        }
        
        if (channelsCount > 0) {
            content += `
                <button class="btn-danger secondary" onclick="removeChannels()">
                    <i class="fas fa-list"></i> Eliminar Canales
                </button>
            `;
        }
        
        if (channelsCount > 0 || epgInfo) {
            content += `
                <button class="btn-danger" onclick="removeAll()">
                    <i class="fas fa-trash"></i> Eliminar Todo
                </button>
            `;
        }
        
        content += `
                </div>
            </div>
        `;
    }
    
    body.innerHTML = content;
    modal.classList.add('show');
}

function hideManagementModal() {
    document.getElementById('managementModal').classList.remove('show');
}

function removeEPG() {
    if (confirm('¿Estás seguro de que quieres eliminar la guía EPG?\n\nEsto eliminará toda la información de programación pero mantendrá tus canales.')) {
        // Limpiar EPG
        epgData = null;
        localStorage.removeItem('iptv_epg_data');
        
        // Detener actualizaciones
        if (epgUpdateInterval) {
            clearInterval(epgUpdateInterval);
            epgUpdateInterval = null;
        }
        
        // Limpiar interfaz
        const programInfo = elements.nowPlaying.querySelector('.program-info');
        if (programInfo) {
            programInfo.remove();
        }
        
        const epgStatus = document.querySelectorAll('.epg-status');
        epgStatus.forEach(status => status.remove());
        
        hideManagementModal();
        showNotification('✅ EPG eliminado correctamente', 'success');
        
        console.log('🗑️ EPG eliminado');
    }
}

function removeChannels() {
    if (confirm('¿Estás seguro de que quieres eliminar todos los canales?\n\nEsto eliminará:\n• Todos los canales cargados\n• Tus favoritos\n• La información de la playlist\n\nEl EPG se mantendrá si lo tienes cargado.')) {
        // Limpiar canales
        channels = [];
        filteredChannels = [];
        categories.clear();
        favorites.clear();
        currentChannel = null;
        
        // Limpiar localStorage
        localStorage.removeItem('iptv_channels');
        localStorage.removeItem('iptv_playlist_info');
        localStorage.removeItem('iptv_favorites');
        
        // Actualizar interfaz
        processChannels();
        updateCounters();
        
        // Limpiar reproductor
        elements.nowPlaying.style.display = 'none';
        elements.currentChannelName.textContent = 'Selecciona un canal';
        
        if (elements.vlcBtn) elements.vlcBtn.style.display = 'none';
        if (elements.copyBtn) elements.copyBtn.style.display = 'none';
        
        hideManagementModal();
        showNotification('✅ Canales eliminados correctamente', 'success');
        
        console.log('🗑️ Canales eliminados');
    }
}

function removeAll() {
    if (confirm('¿Estás seguro de que quieres eliminar TODO?\n\nEsto eliminará:\n• Todos los canales\n• Toda la información EPG\n• Todos tus favoritos\n• Toda la configuración\n\n¡Esta acción NO se puede deshacer!')) {
        // Limpiar todo
        channels = [];
        filteredChannels = [];
        categories.clear();
        favorites.clear();
        currentChannel = null;
        epgData = null;
        
        // Detener actualizaciones EPG
        if (epgUpdateInterval) {
            clearInterval(epgUpdateInterval);
            epgUpdateInterval = null;
        }
        
        // Limpiar localStorage completamente
        localStorage.removeItem('iptv_channels');
        localStorage.removeItem('iptv_playlist_info');
        localStorage.removeItem('iptv_favorites');
        localStorage.removeItem('iptv_epg_data');
        
        // Actualizar interfaz
        processChannels();
        updateCounters();
        
        // Limpiar reproductor
        elements.nowPlaying.style.display = 'none';
        elements.currentChannelName.textContent = 'Selecciona un canal';
        
        if (elements.vlcBtn) elements.vlcBtn.style.display = 'none';
        if (elements.copyBtn) elements.copyBtn.style.display = 'none';
        
        // Limpiar información EPG
        const programInfo = elements.nowPlaying.querySelector('.program-info');
        if (programInfo) {
            programInfo.remove();
        }
        
        const epgStatus = document.querySelectorAll('.epg-status');
        epgStatus.forEach(status => status.remove());
        
        hideManagementModal();
        showNotification('✅ Todo eliminado correctamente - App reiniciada', 'success');
        
        console.log('🗑️ Aplicación limpia completamente');
    }
}

// ===== CSS ADICIONAL PARA NOTIFICACIONES Y EPG =====
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    
    .notification.success {
        border-left: 4px solid var(--accent-success);
    }
    
    .notification.error {
        border-left: 4px solid var(--accent-danger);
    }
    
    /* EPG Styles */
    .program-info {
        margin-top: 12px;
        padding: 12px;
        background: var(--bg-primary);
        border-radius: 6px;
        border-left: 3px solid var(--accent-primary);
        animation: fadeInUp 0.3s ease-out;
    }
    
    .current-program strong {
        color: var(--text-primary);
        font-size: 13px;
        display: block;
        margin-bottom: 4px;
        line-height: 1.2;
    }
    
    .current-program p {
        color: var(--text-secondary);
        font-size: 11px;
        line-height: 1.3;
        margin-bottom: 4px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    
    .current-program small {
        color: var(--text-muted);
        font-size: 10px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 4px;
    }
    
    .epg-status {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 10px;
        color: var(--text-muted);
        margin-top: 8px;
        padding: 2px 6px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.05);
    }
    
    .epg-status.active {
        color: var(--accent-success);
        background: rgba(35, 134, 54, 0.1);
    }
    
    .epg-status i {
        font-size: 8px;
        animation: pulse 2s infinite;
    }
    
    @keyframes pulse {
        0%, 100% {
            opacity: 1;
        }
        50% {
            opacity: 0.5;
        }
    }
    
    .input-group label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 500;
        margin-bottom: 6px;
        color: var(--text-secondary);
    }
    
    .input-group label i {
        color: var(--accent-primary);
        width: 12px;
    }
    
    .required {
        color: var(--accent-danger);
        font-weight: 600;
    }
    
    .input-help {
        display: block;
        font-size: 11px;
        color: var(--text-muted);
        margin-top: 4px;
        font-style: italic;
    }
    
    /* Estilos para gestión mejorada */
    .info-box {
        padding: 16px;
        border-radius: 8px;
        margin: 16px 0;
        display: flex;
        gap: 12px;
        align-items: flex-start;
    }
    
    .info-box.warning {
        background: rgba(217, 153, 34, 0.1);
        border: 1px solid rgba(217, 153, 34, 0.3);
        color: var(--text-primary);
    }
    
    .info-box i {
        color: var(--accent-warning);
        font-size: 18px;
        margin-top: 2px;
        flex-shrink: 0;
    }
    
    .info-box h4 {
        margin: 0 0 8px 0;
        font-size: 14px;
        color: var(--text-primary);
    }
    
    .info-box p {
        margin: 0 0 8px 0;
        font-size: 12px;
        color: var(--text-secondary);
        line-height: 1.4;
    }
    
    .info-box p:last-child {
        margin-bottom: 0;
    }
    
    .quick-actions {
        display: flex;
        gap: 8px;
        margin: 16px 0;
    }
    
    .no-data {
        text-align: center;
        padding: 40px 20px;
        color: var(--text-muted);
    }
    
    .program-info:hover {
        background: var(--bg-hover);
        transform: translateY(-1px);
        box-shadow: var(--shadow-sm);
    }
    
    .program-info.no-program {
        border-left-color: var(--border-muted);
        opacity: 0.7;
    }
    
    .program-info.live {
        border-left-color: var(--accent-danger);
    }
    
    .program-info.live::before {
        content: "🔴 EN VIVO";
        font-size: 9px;
        color: var(--accent-danger);
        font-weight: 600;
        margin-bottom: 4px;
        display: block;
    }
`;
document.head.appendChild(style);

// ===== FUNCIONES DE EXPORTACIÓN =====
function showExportOptions() {
    const modal = document.getElementById('exportModal');
    const body = document.getElementById('exportBody');
    
    const hasChannels = channels.length > 0;
    const hasEPG = epgData && Object.keys(epgData).length > 0;
    
    if (!hasChannels && !hasEPG) {
        alert('No hay datos para exportar. Carga una lista M3U o EPG primero.');
        return;
    }
    
    let content = '';
    
    // Estadísticas cuando hay canales
    if (hasChannels) {
        const totalChannels = channels.length;
        const totalFavorites = favorites.size;
        const categoriesCount = categories.size - 2;
        
        content += `
            <div class="export-stats">
                <h4><i class="fas fa-chart-bar"></i> Estadísticas de la Lista</h4>
                <div class="stats-grid">
                    <div class="stat-item">
                        <span>Total de canales:</span>
                        <span class="stat-value">${totalChannels}</span>
                    </div>
                    <div class="stat-item">
                        <span>Favoritos:</span>
                        <span class="stat-value">${totalFavorites}</span>
                    </div>
                    <div class="stat-item">
                        <span>Categorías:</span>
                        <span class="stat-value">${categoriesCount}</span>
                    </div>
                    <div class="stat-item">
                        <span>Con EPG:</span>
                        <span class="stat-value">${hasEPG ? 'Sí' : 'No'}</span>
                    </div>
                </div>
            </div>
            
            <div class="export-option" onclick="exportFullM3U()">
                <h4><i class="fas fa-list"></i> Exportar Lista Completa</h4>
                <p>Descarga todos los ${totalChannels} canales en formato M3U8</p>
            </div>
            
            <div class="export-option" onclick="exportFavoritesM3U()">
                <h4><i class="fas fa-heart"></i> Exportar Solo Favoritos</h4>
                <p>Descarga únicamente tus ${totalFavorites} canales favoritos</p>
            </div>
            
            <div class="export-option" onclick="exportByCategory()">
                <h4><i class="fas fa-filter"></i> Exportar por Categoría</h4>
                <p>Elige una categoría específica para exportar</p>
            </div>
            
            <div class="export-option" onclick="copyM3UToClipboard()">
                <h4><i class="fas fa-copy"></i> Copiar al Portapapeles</h4>
                <p>Copia el contenido M3U completo al portapapeles</p>
            </div>
        `;
    }
    
    // ===== NUEVO: Opciones cuando solo hay EPG =====
    if (hasEPG && !hasChannels) {
        const epgChannelsCount = Object.keys(epgData).length;
        
        content += `
            <div class="export-stats">
                <h4><i class="fas fa-tv"></i> Datos EPG Disponibles</h4>
                <div class="stats-grid">
                    <div class="stat-item">
                        <span>Canales con programación:</span>
                        <span class="stat-value">${epgChannelsCount}</span>
                    </div>
                    <div class="stat-item">
                        <span>Estado:</span>
                        <span class="stat-value">Solo EPG</span>
                    </div>
                </div>
            </div>
            
            <div class="info-box warning">
                <i class="fas fa-info-circle"></i>
                <div>
                    <h4>💡 Generar M3U desde EPG</h4>
                    <p>Tienes ${epgChannelsCount} canales con información de programación.</p>
                    <p>Puedes generar una lista M3U básica con los nombres de los canales del EPG (las URLs tendrás que completarlas manualmente).</p>
                </div>
            </div>
            
            <div class="export-option" onclick="generateM3UFromEPG()">
                <h4><i class="fas fa-magic"></i> Generar M3U desde EPG</h4>
                <p>Crea una lista M3U con los ${epgChannelsCount} canales del EPG (URLs como placeholder)</p>
            </div>
            
            <div class="export-option" onclick="exportEPGChannelList()">
                <h4><i class="fas fa-list-alt"></i> Exportar Lista de Canales</h4>
                <p>Descarga una lista TXT con todos los nombres de canales del EPG</p>
            </div>
        `;
    }
    
    body.innerHTML = content;
    modal.classList.add('show');
}

function hideExportModal() {
    document.getElementById('exportModal').classList.remove('show');
}

function generateM3U(channelsToExport, filename = 'lista_iptv') {
    let m3uContent = '#EXTM3U\n';
    
    channelsToExport.forEach(channel => {
        // Construir línea #EXTINF
        let extinf = '#EXTINF:-1';
        
        // Agregar logo si existe
        if (channel.logo && channel.logo.trim() !== '') {
            extinf += ` tvg-logo="${channel.logo}"`;
        }
        
        // Agregar grupo
        if (channel.group && channel.group.trim() !== '') {
            extinf += ` group-title="${channel.group}"`;
        }
        
        // Agregar nombre del canal
        extinf += `,${channel.name}\n`;
        
        // Agregar URL
        m3uContent += extinf + channel.url + '\n';
    });
    
    return m3uContent;
}

function downloadM3U(content, filename) {
    const blob = new Blob([content], { type: 'application/x-mpegurl' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.m3u`;
    a.style.display = 'none';
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    URL.revokeObjectURL(url);
    
    showNotification(`✅ ${filename}.m3u descargado`, 'success');
}

function exportFullM3U() {
    const content = generateM3U(channels, 'lista_completa_iptv');
    downloadM3U(content, 'lista_completa_iptv');
    hideExportModal();
}

function exportFavoritesM3U() {
    if (favorites.size === 0) {
        alert('No tienes canales favoritos para exportar');
        return;
    }
    
    const favoriteChannels = channels.filter(channel => favorites.has(channel.id));
    const content = generateM3U(favoriteChannels, 'favoritos_iptv');
    downloadM3U(content, 'favoritos_iptv');
    hideExportModal();
}

function exportByCategory() {
    hideExportModal();
    
    // Crear lista de categorías (excluyendo 'all' y 'favorites')
    const availableCategories = [...categories.keys()]
        .filter(cat => cat !== 'all' && cat !== 'favorites')
        .sort();
    
    if (availableCategories.length === 0) {
        alert('No hay categorías disponibles para exportar');
        return;
    }
    
    // Crear selector de categoría
    let categoryOptions = availableCategories
        .map(cat => `<option value="${cat}">${cat} (${categories.get(cat)} canales)</option>`)
        .join('');
    
    const categorySelector = `
        <div style="
            position: fixed; 
            top: 50%; 
            left: 50%; 
            transform: translate(-50%, -50%);
            background: var(--bg-secondary);
            padding: 24px;
            border-radius: 12px;
            border: 1px solid var(--border-primary);
            box-shadow: var(--shadow-lg);
            z-index: 3000;
            min-width: 300px;
        ">
            <h3 style="margin-bottom: 16px; color: var(--text-primary);">
                <i class="fas fa-filter"></i> Seleccionar Categoría
            </h3>
            <select id="categorySelect" style="
                width: 100%;
                padding: 8px;
                background: var(--bg-primary);
                border: 1px solid var(--border-primary);
                border-radius: 4px;
                color: var(--text-primary);
                margin-bottom: 16px;
            ">
                ${categoryOptions}
            </select>
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button onclick="this.parentElement.parentElement.remove()" class="btn-secondary">
                    Cancelar
                </button>
                <button onclick="exportSelectedCategory()" class="btn-primary">
                    <i class="fas fa-download"></i> Exportar
                </button>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', categorySelector);
}

function exportSelectedCategory() {
    const select = document.getElementById('categorySelect');
    const selectedCategory = select.value;
    
    const categoryChannels = channels.filter(channel => channel.group === selectedCategory);
    const content = generateM3U(categoryChannels, `categoria_${selectedCategory.toLowerCase()}_iptv`);
    downloadM3U(content, `categoria_${selectedCategory.toLowerCase()}_iptv`);
    
    // Remover el selector
    select.closest('div').remove();
}

function copyM3UToClipboard() {
    const content = generateM3U(channels);
    
    navigator.clipboard.writeText(content).then(() => {
        showNotification('✅ Lista M3U copiada al portapapeles', 'success');
        hideExportModal();
    }).catch(() => {
        // Fallback para navegadores que no soportan clipboard API
        const textArea = document.createElement('textarea');
        textArea.value = content;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        
        showNotification('✅ Lista M3U copiada al portapapeles', 'success');
        hideExportModal();
    });
}

// ===== NUEVAS FUNCIONES PARA EPG =====
function generateM3UFromEPG() {
    if (!epgData || Object.keys(epgData).length === 0) {
        alert('No hay datos EPG disponibles');
        return;
    }
    
    console.log('🎯 Generando canales desde EPG...');
    
    // Generar canales desde EPG
    const generatedChannels = [];
    
    Object.keys(epgData).forEach((channelId, index) => {
        // Limpiar el ID del canal para hacerlo más legible
        const cleanName = channelId
            .replace(/[_-]/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase())
            .trim();
        
        const finalName = cleanName || `Canal ${index + 1}`;
        
        // Crear canal con estructura compatible
        const channel = {
            id: generateChannelId(finalName, `placeholder_${channelId}`),
            name: finalName,
            logo: '', // Sin logo por defecto
            group: 'EPG', // Agrupar todos como "EPG"
            url: `# TODO: Agregar URL real para ${finalName}`,
            playlistName: 'Generado desde EPG',
            playlistUrl: 'local://epg-generated',
            originalEpgId: channelId // Mantener referencia al EPG
        };
        
        generatedChannels.push(channel);
    });
    
    // Preguntar al usuario qué hacer
    const userChoice = confirm(
        `Se generarán ${generatedChannels.length} canales desde el EPG.\n\n` +
        `¿Quieres cargarlos directamente en la app?\n\n` +
        `- OK: Cargar en la app (recomendado)\n` +
        `- Cancelar: Descargar archivo M3U`
    );
    
    if (userChoice) {
        // ===== CARGAR DIRECTAMENTE EN LA APP =====
        console.log('📺 Cargando canales EPG en la app...');
        
        // Limpiar canales existentes si el usuario confirma
        const replaceExisting = channels.length > 0 ? 
            confirm('¿Reemplazar los canales actuales con los del EPG?') : true;
        
        if (replaceExisting || channels.length === 0) {
            // Reemplazar canales
            channels = generatedChannels;
        } else {
            // Agregar a los existentes
            channels = [...channels, ...generatedChannels];
        }
        
        // Guardar en localStorage
        localStorage.setItem('iptv_channels', JSON.stringify(channels));
        localStorage.setItem('iptv_playlist_info', JSON.stringify({
            name: 'Generado desde EPG',
            url: 'local://epg-generated',
            epgUrl: localStorage.getItem('iptv_epg_data') ? JSON.parse(localStorage.getItem('iptv_epg_data')).url : '',
            loadedAt: new Date().toISOString(),
            channelCount: channels.length
        }));
        
        // Actualizar interfaz
        processChannels();
        updateCounters();
        
        hideExportModal();
        showNotification(`✅ ${generatedChannels.length} canales EPG cargados en la app`, 'success');
        
        // Mostrar instrucciones
        setTimeout(() => {
            alert(
                `📺 Canales EPG cargados exitosamente!\n\n` +
                `Ahora tienes ${channels.length} canales en la categoría "EPG".\n\n` +
                `⚠️ IMPORTANTE: Los canales tienen URLs placeholder.\n` +
                `Para reproducir, necesitas:\n` +
                `1. Hacer clic en un canal\n` +
                `2. Copiar la URL placeholder\n` +
                `3. Reemplazarla con la URL real del stream\n\n` +
                `💡 O exporta el M3U, completa las URLs y vuelve a cargarlo.`
            );
        }, 1000);
        
    } else {
        // ===== DESCARGAR ARCHIVO M3U =====
        let m3uContent = '#EXTM3U\n';
        m3uContent += '# Lista generada desde EPG - URLs necesitan ser completadas\n';
        m3uContent += `# Generada el ${new Date().toLocaleString()}\n`;
        m3uContent += '# Total de canales: ' + generatedChannels.length + '\n\n';
        
        generatedChannels.forEach(channel => {
            m3uContent += `#EXTINF:-1 tvg-id="${channel.originalEpgId}" group-title="${channel.group}",${channel.name}\n`;
            m3uContent += `# TODO: Agregar URL real del stream para ${channel.name}\n`;
            m3uContent += `http://ejemplo.com/stream/${channel.originalEpgId}\n\n`;
        });
        
        downloadM3U(m3uContent, 'canales_desde_epg');
        hideExportModal();
        showNotification('✅ M3U descargado - Completa las URLs y vuelve a cargarlo', 'success');
    }
}

// ===== FUNCIÓN PARA ACTUALIZAR URLs DE CANALES EPG =====
function updateChannelUrl(channelId, newUrl) {
    const channel = channels.find(ch => ch.id === channelId);
    if (channel) {
        channel.url = newUrl;
        localStorage.setItem('iptv_channels', JSON.stringify(channels));
        console.log(`✅ URL actualizada para ${channel.name}: ${newUrl}`);
        return true;
    }
    return false;
}

function exportEPGChannelList() {
    if (!epgData || Object.keys(epgData).length === 0) {
        alert('No hay datos EPG disponibles');
        return;
    }
    
    let listContent = `Lista de Canales desde EPG\n`;
    listContent += `Generada el: ${new Date().toLocaleString()}\n`;
    listContent += `Total de canales: ${Object.keys(epgData).length}\n`;
    listContent += `${'='.repeat(50)}\n\n`;
    
    Object.keys(epgData).forEach((channelId, index) => {
        const cleanName = channelId
            .replace(/[_-]/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase())
            .trim();
        
        const finalName = cleanName || `Canal ${index + 1}`;
        
        listContent += `${index + 1}. ${finalName} (ID: ${channelId})\n`;
        
        // Agregar programa actual si existe
        const now = new Date();
        const programs = epgData[channelId] || [];
        const currentProgram = programs.find(p => p.start <= now && p.stop > now);
        
        if (currentProgram) {
            const timeFormat = { hour: '2-digit', minute: '2-digit', hour12: false };
            const startTime = currentProgram.start.toLocaleTimeString('es-ES', timeFormat);
            const stopTime = currentProgram.stop.toLocaleTimeString('es-ES', timeFormat);
            listContent += `   Ahora: ${currentProgram.title} (${startTime} - ${stopTime})\n`;
        }
        
        listContent += '\n';
    });
    
    const blob = new Blob([listContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lista_canales_epg.txt';
    a.style.display = 'none';
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    URL.revokeObjectURL(url);
    
    hideExportModal();
    showNotification('✅ Lista de canales exportada', 'success');
}

// ===== FUNCIONES PARA CARGA DE ARCHIVOS LOCALES =====
let selectedFile = null;
let currentTab = 'url';

function switchTab(tabName) {
    currentTab = tabName;
    
    // Actualizar botones de pestañas
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[onclick="switchTab('${tabName}')"]`).classList.add('active');
    
    // Actualizar contenido de pestañas
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}Tab`).classList.add('active');
    
    console.log(`📑 Cambiado a pestaña: ${tabName}`);
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    console.log('📁 Archivo seleccionado via input:', file.name, formatFileSize(file.size));
    
    // Validar tipo de archivo
    const validExtensions = ['.m3u', '.m3u8', '.txt'];
    const fileName = file.name.toLowerCase();
    const isValid = validExtensions.some(ext => fileName.endsWith(ext));
    
    if (!isValid) {
        alert('⚠️ Tipo de archivo no válido. Use archivos .m3u, .m3u8 o .txt');
        event.target.value = '';
        return;
    }
    
    // Validar tamaño (máximo 10MB)
    if (file.size > 10 * 1024 * 1024) {
        alert('⚠️ Archivo muy grande. Máximo 10MB permitido.');
        event.target.value = '';
        return;
    }
    
    selectedFile = file;
    showFileInfo(file);
    
    showNotification(`✅ Archivo "${file.name}" seleccionado`, 'success');
}

function showFileInfo(file) {
    const fileInfo = document.getElementById('fileInfo');
    const fileName = document.getElementById('fileName');
    const fileSize = document.getElementById('fileSize');
    const uploadArea = document.querySelector('.file-upload-area');
    
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    
    fileInfo.style.display = 'flex';
    uploadArea.style.display = 'none';
}

function clearFileSelection() {
    selectedFile = null;
    document.getElementById('playlistFile').value = '';
    document.getElementById('fileInfo').style.display = 'none';
    document.querySelector('.file-upload-area').style.display = 'block';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ===== DRAG & DROP PERSONALIZADO =====
function setupDragAndDrop() {
    const modal = document.getElementById('addPlaylistModal');
    const fileTab = document.getElementById('fileTab');
    const uploadArea = document.querySelector('.file-upload-area');
    
    // Prevenir comportamiento por defecto en toda la ventana
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        document.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });
    
    // Agregar indicadores visuales cuando se arrastra sobre el modal
    ['dragenter', 'dragover'].forEach(eventName => {
        modal.addEventListener(eventName, handleDragEnter, false);
        if (uploadArea) {
            uploadArea.addEventListener(eventName, handleDragEnter, false);
        }
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        modal.addEventListener(eventName, handleDragLeave, false);
        if (uploadArea) {
            uploadArea.addEventListener(eventName, handleDragLeave, false);
        }
    });
    
    // Manejar el drop
    modal.addEventListener('drop', handleDrop, false);
    if (uploadArea) {
        uploadArea.addEventListener('drop', handleDrop, false);
    }
    
    console.log('🎯 Drag & Drop configurado');
}

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function handleDragEnter(e) {
    preventDefaults(e);
    
    // Cambiar a pestaña de archivo automáticamente
    if (currentTab !== 'file') {
        switchTab('file');
    }
    
    // Agregar clase visual
    const uploadArea = document.querySelector('.file-upload-area');
    if (uploadArea) {
        uploadArea.classList.add('dragover');
    }
    
    console.log('📁 Archivo siendo arrastrado...');
}

function handleDragLeave(e) {
    preventDefaults(e);
    
    // Solo remover si realmente salimos del área
    const uploadArea = document.querySelector('.file-upload-area');
    if (uploadArea && !uploadArea.contains(e.relatedTarget)) {
        uploadArea.classList.remove('dragover');
    }
}

function handleDrop(e) {
    preventDefaults(e);
    
    const uploadArea = document.querySelector('.file-upload-area');
    if (uploadArea) {
        uploadArea.classList.remove('dragover');
    }
    
    const files = e.dataTransfer.files;
    
    if (files.length > 0) {
        const file = files[0];
        console.log('📦 Archivo soltado:', file.name);
        
        // Validar archivo
        const validExtensions = ['.m3u', '.m3u8', '.txt'];
        const fileName = file.name.toLowerCase();
        const isValid = validExtensions.some(ext => fileName.endsWith(ext));
        
        if (!isValid) {
            alert('⚠️ Tipo de archivo no válido. Use archivos .m3u, .m3u8 o .txt');
            return;
        }
        
        // Validar tamaño (máximo 10MB)
        if (file.size > 10 * 1024 * 1024) {
            alert('⚠️ Archivo muy grande. Máximo 10MB permitido.');
            return;
        }
        
        // Simular selección de archivo
        selectedFile = file;
        showFileInfo(file);
        
        showNotification(`✅ Archivo "${file.name}" listo para cargar`, 'success');
    }
}

// Llamar esta función cuando se abra el modal
function showAddPlaylistModal() {
    elements.addPlaylistModal.classList.add('show');
    elements.playlistUrl.focus();
    
    // ===== NUEVO: Configurar drag & drop =====
    setTimeout(() => {
        setupDragAndDrop();
    }, 100);
}

// ===== FUNCIÓN PARA LEER ARCHIVOS LOCALES =====
async function loadLocalFile(file) {
    return new Promise((resolve, reject) => {
        console.log('📖 Iniciando lectura del archivo:', file.name);
        
        const reader = new FileReader();
        
        reader.onload = function(e) {
            console.log('✅ Archivo leído exitosamente:', file.name);
            console.log('📊 Tamaño del contenido:', e.target.result.length, 'caracteres');
            resolve(e.target.result);
        };
        
        reader.onerror = function(e) {
            console.error('❌ Error leyendo archivo:', e);
            reject(new Error(`Error leyendo el archivo: ${e.target.error?.message || 'Error desconocido'}`));
        };
        
        reader.onprogress = function(e) {
            if (e.lengthComputable) {
                const progress = Math.round((e.loaded / e.total) * 100);
                console.log(`📖 Progreso de lectura: ${progress}%`);
            }
        };
        
        // Leer como texto UTF-8
        reader.readAsText(file, 'UTF-8');
    });
}

// ===== FUNCIÓN PARA FORMATEAR TAMAÑO DE ARCHIVOS =====
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    const size = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
    return `${size} ${sizes[i]}`;
}

console.log('✅ Renderer.js con soporte EPG y gestión de listas cargado completamente');