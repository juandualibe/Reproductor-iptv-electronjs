# 📺 IPTV Reproductor

Aplicación **IPTV** desarrollada con **Electron**, que permite reproducir listas M3U (.m3u, .m3u8, .txt), gestionar EPG y organizar canales por categorías.

---

## Características

- 📺 Reproducción de canales IPTV
- 📋 Gestión de listas M3U (URL y archivos locales)
- 📅 Soporte completo para EPG (Guía electrónica de programas)
- ⭐ Sistema de favoritos
- 🔍 Búsqueda de canales
- 📂 Organización por categorías
- 📤 Exportación de listas personalizadas
- 🎬 Integración con VLC

## 🚀 Requisitos previos

Antes de comenzar, asegurate de tener instalado en tu sistema:

- [Node.js](https://nodejs.org/) (recomendado **v18+**)
- [npm](https://www.npmjs.com/) (viene con Node)
- Git (opcional, si clonás desde GitHub)

---

## ⚙️ Instalación y ejecución (desde código fuente)

1. **Clonar el repositorio** 

```bash
git clone https://github.com/juandualibe/Reproductor-iptv-electronjs.git
```

2. **Entrar a la carpeta del proyecto**

```bash
cd iptv-electron-app
```

3. **Instalar dependencias**

```bash
npm install
```

4. **Ejecutar en modo desarrollo**

```bash
npm run dev
```

> `npm run dev` arranca la app en modo desarrollo (verás consola y podés depurar).  
> Para ejecutar normalmente sin el flag `--dev` podés usar `npm start`.

---

## 🧱 Crear un ejecutable (Windows — portable .exe)

Tu `package.json` ya incluye scripts y configuración para generar un ejecutable Windows portable usando **electron-builder**:

```json
"scripts": {
  "start": "electron .",
  "dev": "electron . --dev",
  "pack": "electron-builder --dir",
  "build-win": "electron-builder --win"
},
"build": {
  "appId": "com.juandualibe.iptv-electron-app",
  "productName": "IPTV Electron App",
  "directories": {
    "output": "dist"
  },
  "win": {
    "target": "portable"
  }
}
```

### 🔹 Paso 1 — Ejecutar el build (Windows)

Desde la raíz del proyecto:

```bash
npm run build-win
```

### 🔹 Qué hace este comando

- Ejecuta `electron-builder` para empaquetar tu aplicación.
- Genera artefactos dentro de la carpeta `dist/` definida en `package.json`.

### 🔹 Paso 2 — ¿Dónde encontrar el ejecutable?

Después de ejecutar `npm run build-win`, revisá la carpeta `dist/` en la raíz del proyecto. Ejemplo de contenido esperado:

```
dist/
├─ IPTV Electron App Setup 1.0.0.exe   (o similar, dependiendo de version/name)
└─ win-unpacked/
```

- El archivo `.exe` (ej. `IPTV Electron App 1.0.0.exe`) será **portable** (según tu `target: "portable"`).  
- `win-unpacked/` contiene la app desempaquetada (útil para depuración o pruebas).

### 🔹 Paso 3 — Ejecutar la app generada

- Hacé doble clic en el `.exe` generado dentro de `dist/`.  
- En máquinas Windows funciona como una aplicación portable (no instala servicios ni escribe en Program Files).

---

## Uso

1. **Agregar Lista**: Carga tu lista M3U desde URL o archivo local
2. **EPG**: Agrega guía de programación para ver qué se emite
3. **Navegar**: Explora por categorías o usa la búsqueda
4. **Favoritos**: Marca tus canales preferidos
5. **Exportar**: Crea listas personalizadas

## 📝 Notas y problemas comunes

- **Si estás en Windows:** `npm run build-win` debería funcionar directamente.  
- **Si estás en macOS o Linux y querés crear .exe para Windows:** vas a necesitar herramientas adicionales (`wine`, `mono` u otras) o usar un CI (por ejemplo GitHub Actions) para cross-build.  
- **No subas `dist/` al repo:** los artefactos generados no deben ir al historial. Mantené `dist/` en `.gitignore`.

---

## 🧰 Scripts disponibles

| Comando | Descripción |
|--------:|------------|
| `npm start` | Ejecuta la app con Electron |
| `npm run dev` | Ejecuta en modo desarrollo (`--dev`) |
| `npm run pack` | Empaqueta la app en una carpeta sin crear instalador (`--dir`) |
| `npm run build-win` | Genera ejecutable portable para Windows (usa `electron-builder`) |

---

## 🗂️ Estructura recomendada (resumen)

```
iptv-electron-app/
├─ main.js              # Proceso principal (Electron)
├─ index.html           # Interfaz principal
├─ renderer.js          # Lógica del front-end (tu archivo ~3200 líneas)
├─ styles.css           # Estilos
├─ assets/              # Imágenes, iconos, etc.
├─ package.json         # Configuración + build
├─ node_modules/
└─ dist/                # Generado por electron-builder (no commitear)
```

---


## 🪪 Licencia

Este proyecto está bajo **MIT** — podés usar, modificar y redistribuir según esa licencia.

---

