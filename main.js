const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const axios = require('axios');
const zlib = require('zlib');

// ===== CONFIGURACIÓN PARA PRODUCCIÓN =====
const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false // Necesario para streams IPTV
    },
    frame: false, // Sin frame para controles personalizados
    backgroundColor: '#1a1a1a',
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'), // Icono para la app
    titleBarStyle: 'hidden', // Para controles personalizados
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      allowRunningInsecureContent: true, // Para streams HTTP
      experimentalFeatures: true
    }
  });

  // Cargar la aplicación
  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    console.log('🚀 Ventana principal lista');
    
    // Solo mostrar DevTools en desarrollo
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

  // Manejar cierre
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // ===== NUEVO: Configuración adicional para producción =====
  
  // Prevenir navegación externa
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.origin !== 'file://') {
      event.preventDefault();
    }
  });

  // Prevenir ventanas nuevas no deseadas
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Permitir solo URLs específicas (streams, etc.)
    if (url.startsWith('http') || url.startsWith('vlc://')) {
      require('electron').shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

// ===== EVENTOS DE APLICACIÓN =====
app.whenReady().then(() => {
  createWindow();
  
  // ===== CONFIGURACIÓN DE SEGURIDAD PARA PRODUCCIÓN =====
  app.on('web-contents-created', (event, contents) => {
    // Deshabilitar navegación no deseada
    contents.on('will-navigate', (event, navigationUrl) => {
      const parsedUrl = new URL(navigationUrl);
      if (parsedUrl.origin !== 'file://') {
        event.preventDefault();
      }
    });
  });
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ===== IPC HANDLERS OPTIMIZADOS =====

// Handler para M3U con mejor manejo de errores
ipcMain.handle('load-m3u', async (event, url) => {
  try {
    console.log('📥 Descargando M3U desde:', url);
    
    const response = await axios.get(url, {
      timeout: 20000, // Aumentado para conexiones lentas
      headers: {
        'User-Agent': 'IPTV-Player-Pro/1.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/vnd.apple.mpegurl, application/x-mpegurl, text/plain, */*',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive'
      },
      maxRedirects: 10, // Más redirects para algunos proveedores
      validateStatus: function (status) {
        return status >= 200 && status < 300; // Solo códigos de éxito
      }
    });
    
    console.log('✅ M3U descargado exitosamente');
    console.log(`📊 Tamaño: ${response.data.length} caracteres`);
    
    return { success: true, data: response.data };
  } catch (error) {
    const errorMsg = error.response?.status 
      ? `HTTP ${error.response.status}: ${error.response.statusText}`
      : error.code === 'ECONNABORTED' 
        ? 'Timeout de conexión'
        : error.message;
    
    console.error('❌ Error descargando M3U:', errorMsg);
    return { 
      success: false, 
      error: `Error descargando lista: ${errorMsg}` 
    };
  }
});

// Handler para EPG optimizado
ipcMain.handle('load-epg', async (event, url) => {
  try {
    console.log('📺 Descargando EPG desde:', url);
    
    const response = await axios.get(url, {
      timeout: 45000, // Más tiempo para EPG grandes
      headers: {
        'User-Agent': 'IPTV-Player-Pro/1.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/xml, text/xml, application/gzip, */*',
        'Accept-Encoding': 'gzip, deflate'
      },
      responseType: 'arraybuffer', // Para datos binarios
      maxRedirects: 10,
      validateStatus: function (status) {
        return status >= 200 && status < 300;
      }
    });
    
    let xmlData = response.data;
    
    // Descomprimir si es necesario
    if (url.endsWith('.gz') || response.headers['content-encoding'] === 'gzip') {
      console.log('🗜️ Descomprimiendo archivo EPG...');
      try {
        xmlData = zlib.gunzipSync(Buffer.from(xmlData));
      } catch (decompressError) {
        console.warn('⚠️ Error descomprimiendo, intentando como texto plano...');
        xmlData = response.data;
      }
    }
    
    // Convertir a string
    const xmlString = xmlData.toString('utf-8');
    
    console.log('✅ EPG descargado y procesado exitosamente');
    console.log(`📊 Tamaño EPG: ${xmlString.length} caracteres`);
    
    return { success: true, data: xmlString };
  } catch (error) {
    const errorMsg = error.response?.status 
      ? `HTTP ${error.response.status}: ${error.response.statusText}`
      : error.code === 'ECONNABORTED' 
        ? 'Timeout de conexión EPG'
        : error.message;
    
    console.error('❌ Error descargando EPG:', errorMsg);
    return { 
      success: false, 
      error: `Error descargando EPG: ${errorMsg}` 
    };
  }
});

// ===== CONTROLES DE VENTANA =====
ipcMain.handle('window-minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
    console.log('🔽 Ventana minimizada');
  }
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.restore();
      console.log('🔲 Ventana restaurada');
    } else {
      mainWindow.maximize();
      console.log('🔳 Ventana maximizada');
    }
  }
});

ipcMain.handle('window-close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    console.log('❌ Cerrando aplicación...');
    mainWindow.close();
  }
});

// ===== INFORMACIÓN DE INICIO =====
console.log('✅ Main process iniciado con soporte EPG');
console.log(`🏗️  Modo: ${isDev ? 'DESARROLLO' : 'PRODUCCIÓN'}`);
console.log(`📍 Directorio: ${__dirname}`);
console.log(`⚡ Electron: ${process.versions.electron}`);
console.log(`🟢 Node: ${process.versions.node}`);

// ===== MANEJO DE ERRORES GLOBALES =====
process.on('uncaughtException', (error) => {
  console.error('💥 Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Promesa rechazada:', reason);
});