// Configuración de Supabase
const SUPABASE_URL = "https://lndkhxkdjmkguorrslaj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxuZGtoeGtkam1rZ3VvcnJzbGFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0ODg2MzIsImV4cCI6MjA5NDA2NDYzMn0.0TdlJOIh5Tk_IJ6QbchhKpC5Pi5iY1cOuXmb8g9p4OY";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- UTILIDADES DE SUPABASE ---

// Registrar usuario
async function signUp(email, password, nombre) {
    try {
        const { data: authData, error: authError } = await supabaseClient.auth.signUp({
            email,
            password,
        });

        if (authError) throw authError;

        if (authData.user) {
            const { error: dbError } = await supabaseClient
                .from('usuario')
                .insert([
                    { 
                        id: authData.user.id, 
                        auth_id: authData.user.id,
                        email: email, 
                        nombre_usuario: nombre, 
                        rol: 'usuario' 
                    }
                ]);

            if (dbError) throw dbError;
            return { data: authData, error: null };
        }
    } catch (error) {
        console.error('Error en registro:', error);
        return { data: null, error };
    }
}

// Iniciar sesión
async function signIn(nombre, password) {
    try {
        // Primero buscamos el email asociado al nombre_usuario
        const { data: userData, error: userError } = await supabaseClient
            .from('usuario')
                .select('email')
                .eq('nombre_usuario', nombre)
                .single();

        if (userError || !userData) throw new Error('Usuario no encontrado');

        const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
            email: userData.email,
            password,
        });

        if (authError) throw authError;

        // Obtener datos completos del usuario
        const { data: fullUserData, error: fullUserError } = await supabaseClient
            .from('usuario')
            .select('*')
            .eq('id', authData.user.id)
            .single();

        if (fullUserError) throw fullUserError;

        return { data: fullUserData, error: null };
    } catch (error) {
        console.error('Error en login:', error);
        return { data: null, error };
    }
}

// Cerrar sesión
async function signOut() {
    const { error } = await supabaseClient.auth.signOut();
    return { error };
}

// Obtener locales
async function fetchLocales() {
    const { data, error } = await supabaseClient
        .from('locales')
        .select('*, reseñas(*)')
        .neq('estado', 'eliminado');
    return { data, error };
}

// Guardar local
async function insertLocal(localData) {
    const { data, error } = await supabaseClient
        .from('locales')
        .insert([localData])
        .select();
    return { data, error };
}

// Guardar favorito
async function toggleFavorito(userId, localId, isFav) {
    if (isFav) {
        const { error } = await supabaseClient
            .from('favoritos')
            .insert([{ usuario_id: userId, local_id: localId }]);
        return { error };
    } else {
        const { error } = await supabaseClient
            .from('favoritos')
            .delete()
            .match({ usuario_id: userId, local_id: localId });
        return { error };
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Variables globales
    let map;
    let userMarker;
    let isFirstLocation = true;
    const statusBox = document.getElementById('location-status');
    const locateBtn = document.getElementById('locate-btn');

    // Elementos del Panel
    const sidePanel = document.getElementById('side-panel');
    const panelTitle = document.getElementById('panel-title');
    const panelContent = document.getElementById('panel-content');
    const closePanelBtn = document.getElementById('close-panel');
    const sidebarItems = document.querySelectorAll('.sidebar-item');
    let searchHistory = []; // Almacenar historial en memoria
    let locations = []; // Almacenar ubicaciones agregadas
    let tempMarker; // Marcador temporal para agregar ubicación
    let searchPulseMarker; // Marcador de pulso para búsquedas
    let currentUser = null; // Simulación de usuario (null = no autenticado)

    let currentPanelKey = '';

    // Contenido dinámico para el panel
    const panelData = {
        search: {
            title: 'Buscar',
            content: `
                <div class="search-box">
                    <input type="text" id="search-input" placeholder="Dirección, ciudad o lugar..." class="panel-input" autocomplete="off" spellcheck="false">
                    <div id="search-clear" class="search-clear-btn" style="display: none;">×</div>
                    <div id="search-trigger" class="search-icon-trigger">
                        <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    </div>
                </div>
                <div id="search-history" class="search-history"></div>
                <div id="search-results" class="search-results"></div>
                <p class="panel-hint">Presiona Enter para buscar.</p>
            `
        },
        saved: {
            title: 'Guardados',
            content: '<p class="panel-empty">Inicia sesión para ver tus lugares guardados.</p>'
        },
        profile: {
            title: 'Usuario',
            content: `
                <div class="profile-section" id="profile-view">
                    <!-- El contenido se generará dinámicamente según el estado de auth -->
                </div>
            `
        },
        authRequired: {
            title: 'Acceso Requerido',
            content: `
                <div class="login-section">
                    <p class="panel-empty" style="margin-top: 0; margin-bottom: 20px;">Tienes que iniciar sesión para poder agregar una ubicación</p>
                    <button class="panel-btn" id="go-to-login-from-auth">Iniciar sesión</button>
                </div>
            `
        },
        login: {
            title: 'Iniciar Sesión',
            content: `
                <div class="login-section">
                    <div class="login-form">
                        <input type="text" id="login-name" placeholder="Nombre" class="panel-input login-input" autocomplete="off">
                        <input type="password" id="login-pass" placeholder="Contraseña" class="panel-input login-input">
                        <button class="panel-btn login-btn" id="login-submit">Ingresar</button>
                    </div>
                    <div class="login-footer">
                        <p class="footer-link">¿Olvidaste tu contraseña?</p>
                        <p class="footer-text">¿No tienes cuenta? <span class="footer-link highlight" id="go-to-register-link">Regístrate acá</span></p>
                    </div>
                </div>
            `
        },
        register: {
            title: 'Registrarse',
            content: `
                <div class="login-section">
                    <div class="login-form">
                        <input type="text" id="reg-name" placeholder="Nombre" class="panel-input login-input" autocomplete="off">
                        <input type="text" id="reg-email" placeholder="Correo" class="panel-input login-input" autocomplete="off">
                        <input type="password" id="reg-pass" placeholder="Contraseña" class="panel-input login-input">
                        <input type="password" id="reg-pass-confirm" placeholder="Repetir Contraseña" class="panel-input login-input">
                        <p id="reg-error" class="error-text" style="display:none; color: #ff385c; font-size: 0.8rem; margin-top: -10px;"></p>
                        <button class="panel-btn login-btn" id="register-btn">Registrarse</button>
                    </div>
                    <div class="login-footer">
                        <p class="footer-text">¿Ya tienes cuenta? <span class="footer-link highlight" id="go-to-login-link">Ingresa acá</span></p>
                    </div>
                </div>
            `
        },
        add: {
            title: 'Agregar Ubicación',
            content: `
                <div class="add-location-form">
                    <div class="form-group">
                        <label class="form-label">Nombre del local *</label>
                        <input type="text" id="loc-name" placeholder="Nombre del hostal o local" class="panel-input" autocomplete="off">
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Foto de la fachada *</label>
                        <div class="photo-options">
                            <button class="photo-opt-btn" id="btn-camera">
                                <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                                <span>Tomar foto</span>
                            </button>
                            <button class="photo-opt-btn" id="btn-gallery">
                                <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                                <span>Subir foto</span>
                            </button>
                        </div>
                        <input type="file" id="loc-photo" accept="image/*" style="display: none;">
                        
                        <div id="camera-container" class="camera-container" style="display: none;">
                            <video id="camera-video" autoplay playsinline></video>
                            <button class="capture-btn" id="btn-capture"></button>
                            <button class="close-camera-btn" id="btn-close-camera">×</button>
                        </div>

                        <div id="photo-preview" class="photo-preview" style="display: none;">
                            <!-- La imagen seleccionada o capturada aparecerá aquí -->
                        </div>
                    </div>

                    <div class="form-group">
                        <label class="form-label">Ubicación exacta *</label>
                        <div class="search-box">
                            <input type="text" id="loc-search" placeholder="Buscar dirección o marcar en el mapa" class="panel-input" autocomplete="off" spellcheck="false">
                            <div id="loc-search-clear" class="search-clear-btn" style="display: none;">×</div>
                            <div id="loc-search-trigger" class="search-icon-trigger">
                                <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                            </div>
                        </div>
                        <div id="loc-search-results" class="search-results mini"></div>
                        <p class="panel-hint">Haz clic en el mapa para marcar el punto exacto.</p>
                    </div>

                    <div class="form-divider">
                        <span>Información adicional (opcional)</span>
                    </div>

                    <div class="form-group">
                        <label class="form-label">Calificación</label>
                        <div class="star-rating" id="loc-rating">
                            <span data-value="1">★</span>
                            <span data-value="2">★</span>
                            <span data-value="3">★</span>
                            <span data-value="4">★</span>
                            <span data-value="5">★</span>
                        </div>
                    </div>

                    <div class="form-group">
                        <label class="form-label">Comentarios</label>
                        <textarea id="loc-comment" placeholder="Agregar comentario" class="panel-input panel-textarea"></textarea>
                    </div>

                    <div class="form-group">
                        <label class="form-label">Rango de precios</label>
                        <div class="price-selector" id="loc-price">
                            <button class="price-btn" data-value="1">$</button>
                            <button class="price-btn" data-value="2">$$</button>
                            <button class="price-btn" data-value="3">$$$</button>
                            <button class="price-btn" data-value="4">$$$$</button>
                        </div>
                    </div>

                    <button class="panel-btn" id="save-location-btn">Agregar ubicación</button>
                </div>
            `
        },
        details: {
            title: 'Información del Local',
            content: `
                <div id="location-details" class="location-details">
                    <!-- Contenido dinámico al hacer clic en un marcador -->
                </div>
            `
        }
    };

    // Inicializar mapa (por defecto en una ubicación neutral antes de obtener la real)
    function initMap() {
        map = L.map('map', {
            zoomControl: false // Ocultamos los controles por defecto para una UI más limpia
        }).setView([0, 0], 2);

        // Añadir capa de mapa (CartoDB Positron - Estilo Minimalista)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(map);

        // Mover controles de zoom a la derecha abajo
        L.control.zoom({
            position: 'bottomright'
        }).addTo(map);

        // Iniciar seguimiento de ubicación
        startLocationTracking();
    }

    // Mostrar mensaje de estado
    function showStatus(message, duration = 3000) {
        statusBox.textContent = message;
        statusBox.classList.add('visible');
        if (duration > 0) {
            setTimeout(() => {
                statusBox.classList.remove('visible');
            }, duration);
        }
    }

    // Iniciar seguimiento de ubicación en tiempo real
    function startLocationTracking() {
        if (!navigator.geolocation) {
            showStatus('Error: Tu navegador no soporta geolocalización.');
            return;
        }

        // showStatus('Solicitando permiso de ubicación...', 5000); // Comentado para que no aparezca al inicio

        const options = {
            enableHighAccuracy: true,
            maximumAge: 30000,
            timeout: 27000
        };

        const success = (position) => {
            const { latitude, longitude, accuracy } = position.coords;
            const userLatLng = [latitude, longitude];

            updateUserLocation(userLatLng, accuracy);
            
            if (isFirstLocation) {
                map.flyTo(userLatLng, 16, {
                    duration: 2
                });
                isFirstLocation = false;
                // showStatus('¡Ubicación encontrada!'); // Eliminado para que no aparezca el texto
            }
        };

        const error = (err) => {
            console.warn(`ERROR(${err.code}): ${err.message}`);
            if (err.code === 1) {
                showStatus('Permiso denegado. Por favor, activa la ubicación en tu navegador.');
            } else if (err.code === 3) {
                showStatus('Tiempo de espera agotado. Intentando de nuevo...');
                // Reintentar sin alta precisión si falla por timeout
                navigator.geolocation.getCurrentPosition(success, (e) => {
                    showStatus('No se pudo obtener la ubicación precisa.');
                }, { enableHighAccuracy: false, timeout: 5000 });
            } else {
                showStatus('Error al obtener ubicación. Verifica tu GPS.');
            }
        };

        // Iniciar el rastreo continuo
        navigator.geolocation.watchPosition(success, error, options);
    }

    // Actualizar marcador del usuario en el mapa
    function updateUserLocation(latlng, accuracy) {
        // Icono personalizado para el usuario
        const userIcon = L.divIcon({
            className: 'user-marker',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });

        if (userMarker) {
            userMarker.setLatLng(latlng);
        } else {
            userMarker = L.marker(latlng, { icon: userIcon }).addTo(map);
        }
    }

    // Botón para centrar en la ubicación del usuario
    locateBtn.addEventListener('click', () => {
        if (userMarker) {
            map.flyTo(userMarker.getLatLng(), 17, {
                duration: 1.5,
                easeLinearity: 0.25
            });
            showStatus('Centrando ubicación...');
        } else {
            showStatus('Esperando señal GPS...');
        }
    });

    // Eventos para el Panel
    sidebarItems.forEach(item => {
        item.addEventListener('click', () => {
            let panelKey = item.getAttribute('data-panel');
            if (panelKey && panelData[panelKey]) {
                
                // REGLA: Si no está autenticado y quiere agregar ubicación
                if (panelKey === 'add' && !currentUser) {
                    panelKey = 'authRequired';
                }

                currentPanelKey = panelKey; // Guardar la clave actual
                
                // Quitar clase activa de todos y ponerla en el seleccionado
                sidebarItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                // Efecto de transición en el contenido y título
                panelTitle.style.animation = 'none';
                panelContent.style.animation = 'none';
                panelTitle.offsetHeight; // Truco para reiniciar la animación
                panelContent.offsetHeight; 
                panelTitle.style.animation = null;
                panelContent.style.animation = null;
                
                panelTitle.textContent = panelData[panelKey].title;
                panelContent.innerHTML = panelData[panelKey].content;
                sidePanel.classList.add('open');

                // Inicializar eventos específicos del panel cargado
                if (panelKey === 'search') {
                    initSearchEvents();
                } else if (panelKey === 'profile') {
                    initProfileEvents();
                } else if (panelKey === 'add') {
                    initAddLocationEvents();
                } else if (panelKey === 'authRequired') {
                    initAuthRequiredEvents();
                }
            }
        });
    });

    function initAuthRequiredEvents() {
        const loginBtn = document.getElementById('go-to-login-from-auth');
        if (loginBtn) {
            loginBtn.onclick = () => {
                // Buscar el ícono de usuario en la barra lateral y simular clic
                const profileSidebarItem = document.querySelector('.sidebar-item[data-panel="profile"]');
                if (profileSidebarItem) {
                    profileSidebarItem.click();
                } else {
                    // Fallback por si acaso
                    showPanelView('profile');
                    initProfileEvents();
                }
            };
        }
    }

    // Lógica para Agregar Ubicación
    function initAddLocationEvents() {
        const btnCamera = document.getElementById('btn-camera');
        const btnGallery = document.getElementById('btn-gallery');
        const fileInput = document.getElementById('loc-photo');
        const cameraContainer = document.getElementById('camera-container');
        const video = document.getElementById('camera-video');
        const btnCapture = document.getElementById('btn-capture');
        const btnCloseCamera = document.getElementById('btn-close-camera');
        const photoPreview = document.getElementById('photo-preview');
        
        const saveBtn = document.getElementById('save-location-btn');
        const locSearchInput = document.getElementById('loc-search');
        const locSearchResults = document.getElementById('loc-search-results');
        const locSearchClear = document.getElementById('loc-search-clear');
        const starRating = document.getElementById('loc-rating');
        const priceBtns = document.querySelectorAll('.price-btn');
        
        let selectedRating = 0;
        let selectedPrice = 0;
        let selectedCoords = null;
        let photoData = null;
        let stream = null;

        // --- Manejo de la 'X' para limpiar buscador de ubicación ---
        if (locSearchInput && locSearchClear) {
            locSearchInput.addEventListener('input', () => {
                locSearchClear.style.display = locSearchInput.value.length > 0 ? 'flex' : 'none';
            });

            locSearchClear.addEventListener('click', (e) => {
                e.stopPropagation();
                locSearchInput.value = '';
                locSearchClear.style.display = 'none';
                locSearchResults.innerHTML = '';
                locSearchInput.focus();
            });
        }

        // --- Manejo de Fotos ---

        // Opción Galería
        btnGallery.onclick = () => {
            stopCamera();
            fileInput.click();
        };

        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    photoData = event.target.result;
                    showPhotoPreview(photoData);
                };
                reader.readAsDataURL(file);
            }
        };

        // Opción Cámara
        btnCamera.onclick = async () => {
            photoPreview.style.display = 'none';
            cameraContainer.style.display = 'block';
            try {
                stream = await navigator.mediaDevices.getUserMedia({ 
                    video: { facingMode: 'environment' }, 
                    audio: false 
                });
                video.srcObject = stream;
            } catch (err) {
                console.error("Error al acceder a la cámara: ", err);
                alert("No se pudo acceder a la cámara. Asegúrate de dar los permisos necesarios.");
                cameraContainer.style.display = 'none';
            }
        };

        btnCapture.onclick = () => {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const context = canvas.getContext('2d');
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            photoData = canvas.toDataURL('image/jpeg');
            showPhotoPreview(photoData);
            stopCamera();
        };

        btnCloseCamera.onclick = () => stopCamera();

        function stopCamera() {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
                stream = null;
            }
            cameraContainer.style.display = 'none';
        }

        function showPhotoPreview(data) {
            photoPreview.innerHTML = `<img src="${data}" alt="Preview">`;
            photoPreview.style.display = 'flex';
        }

        // Manejo de Calificación
        starRating.querySelectorAll('span').forEach(star => {
            star.onclick = () => {
                selectedRating = parseInt(star.dataset.value);
                starRating.querySelectorAll('span').forEach(s => {
                    s.classList.toggle('active', parseInt(s.dataset.value) <= selectedRating);
                });
            };
        });

        // Manejo de Precios
        priceBtns.forEach(btn => {
            btn.onclick = () => {
                selectedPrice = parseInt(btn.dataset.value);
                priceBtns.forEach(b => b.classList.toggle('active', b === btn));
            };
        });

        // Búsqueda de dirección en el formulario
        let locDebounce;
        const performLocSearch = async () => {
            const query = locSearchInput.value.trim();
            if (query.length < 3) return;
            
            try {
                locSearchResults.innerHTML = '<p class="panel-hint" style="padding: 10px;">Buscando...</p>';
                const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
                const data = await resp.json();
                locSearchResults.innerHTML = '';
                
                if (data.length > 0) {
                    data.forEach(item => {
                        const div = document.createElement('div');
                        div.className = 'result-item';
                        div.textContent = item.display_name;
                        div.onclick = () => {
                            const lat = parseFloat(item.lat);
                            const lon = parseFloat(item.lon);
                            selectedCoords = { lat, lon, address: item.display_name };
                            locSearchInput.value = item.display_name;
                            locSearchResults.innerHTML = '';
                            updateTempMarker(lat, lon);
                            map.flyTo([lat, lon], 17);
                        };
                        locSearchResults.appendChild(div);
                    });
                } else {
                    locSearchResults.innerHTML = '<p class="panel-hint" style="padding: 10px;">No se encontraron resultados.</p>';
                }
            } catch (e) { 
                console.error(e);
                locSearchResults.innerHTML = '<p class="panel-hint" style="padding: 10px;">Error al buscar.</p>';
            }
        };

        locSearchInput.oninput = () => {
            clearTimeout(locDebounce);
            locDebounce = setTimeout(performLocSearch, 800);
        };

        const locSearchTrigger = document.getElementById('loc-search-trigger');
        if (locSearchTrigger) {
            locSearchTrigger.onclick = (e) => {
                e.stopPropagation();
                clearTimeout(locDebounce);
                performLocSearch();
            };
        }

        locSearchInput.onkeypress = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(locDebounce);
                performLocSearch();
            }
        };

        // Marcado manual en el mapa
        const onMapClick = (e) => {
            if (currentPanelKey === 'add') {
                const { lat, lng } = e.latlng;
                selectedCoords = { lat, lon: lng, address: 'Ubicación marcada en el mapa' };
                updateTempMarker(lat, lng);
            }
        };
        map.on('click', onMapClick);

        function updateTempMarker(lat, lon) {
            if (tempMarker) {
                tempMarker.setLatLng([lat, lon]);
            } else {
                const icon = L.divIcon({
                    className: 'custom-div-icon',
                    html: `<div class="marker-pin marker-pending"></div>`,
                    iconSize: [30, 42],
                    iconAnchor: [15, 42]
                });
                tempMarker = L.marker([lat, lon], { icon }).addTo(map);
            }
        }

    // Guardar Ubicación
    saveBtn.onclick = async () => {
        const name = document.getElementById('loc-name').value.trim();
        const comment = document.getElementById('loc-comment').value.trim();

        if (!name || !photoData || !selectedCoords) {
            alert('Por favor, completa todos los campos obligatorios (*).');
            return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Guardando...';

        const localData = {
            nombre: name,
            direccion: selectedCoords.address,
            latitud: selectedCoords.lat,
            longitud: selectedCoords.lon,
            foto_url: photoData, // Aquí idealmente subirías a Storage, pero por ahora guardamos base64
            rango_precio: selectedPrice,
            estado: 'pendiente',
            confirmaciones: 0,
            usuario_id: currentUser ? currentUser.id : null
        };

        const { data, error } = await insertLocal(localData);

        if (error) {
            alert('Error al guardar: ' + error.message);
            saveBtn.disabled = false;
            saveBtn.textContent = 'Agregar ubicación';
            return;
        }

        const savedLoc = data[0];

        // Guardar reseña inicial si hay comentario o rating
        if (comment || selectedRating > 0) {
            await supabaseClient.from('reseñas').insert([{
                local_id: savedLoc.id,
                usuario_id: currentUser.id,
                calificacion: selectedRating,
                comentario: comment
            }]);
        }

        addLocationToMap(savedLoc);
        
        // Limpiar y cerrar
        if (tempMarker) {
            map.removeLayer(tempMarker);
            tempMarker = null;
        }
        map.off('click', onMapClick);
        sidePanel.classList.remove('open');
        sidebarItems.forEach(i => i.classList.remove('active'));
        alert('¡Ubicación agregada con éxito! Está pendiente de validación.');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Agregar ubicación';
    };
    }

    function addLocationToMap(loc) {
        const iconClass = loc.estado === 'pendiente' ? 'marker-pin marker-pending' : 'marker-pin';
        const icon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div class="${iconClass}"></div>`,
            iconSize: [30, 42],
            iconAnchor: [15, 42]
        });

        const marker = L.marker([loc.latitud, loc.longitud], { icon }).addTo(map);
        marker.on('click', () => {
            showLocationDetails(loc, marker);
        });
    }

    async function showLocationDetails(loc, marker) {
        showPanelView('details');
        const container = document.getElementById('location-details');
        
        // Obtener calificación promedio (si no viene ya en el objeto)
        let rating = 0;
        if (loc.reseñas && loc.reseñas.length > 0) {
            rating = Math.round(loc.reseñas.reduce((acc, r) => acc + r.calificacion, 0) / loc.reseñas.length);
        }

        const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
        const prices = '$'.repeat(loc.rango_precio);
        
        // Información de Administrador
        let adminInfo = '';
        if (currentUser && currentUser.rol === 'admin') {
            adminInfo = `
                <div class="admin-info-badge">
                    <p><strong>Admin Panel</strong></p>
                    <p>ID: ${loc.id}</p>
                    <p>Estado: ${loc.estado}</p>
                    <p>Votos: ${loc.confirmaciones}</p>
                </div>
            `;
        }

        container.innerHTML = `
            ${adminInfo}
            <img src="${loc.foto_url}" class="detail-img" alt="${loc.nombre}">
            <h3 class="detail-title">${loc.nombre}</h3>
            <div class="detail-info-row">
                <span class="detail-rating">${stars}</span>
                <span class="detail-price">${prices}</span>
            </div>
            <p class="detail-address">${loc.direccion}</p>
            <button class="copy-btn" id="copy-address">Copiar dirección</button>
            
            <div class="form-divider"><span>Comentarios</span></div>
            <div id="reviews-container" class="reviews-list">
                ${loc.reseñas && loc.reseñas.length > 0 ? 
                    loc.reseñas.map(r => `<p class="detail-address"><strong>${r.calificacion}★</strong>: ${r.comentario}</p>`).join('') : 
                    '<p class="detail-address">Sin comentarios.</p>'}
            </div>

            <div class="validation-section">
                <p class="validation-title">Estado: <strong>${(loc.estado || 'pendiente').toUpperCase()}</strong></p>
                ${loc.estado === 'pendiente' ? `
                    <p class="validation-title">Ayuda a validar este lugar:</p>
                    <div class="validation-btns">
                        <button class="val-btn confirm-btn" id="vote-confirm">Confirmar (${loc.confirmaciones || 0}/5)</button>
                        <button class="val-btn false-btn" id="vote-false">Reportar inexistencia</button>
                    </div>
                ` : '<p class="validation-title" style="color: #27ae60;">Ubicación Validada por la Comunidad</p>'}
            </div>
            <div id="report-form-container" style="display: none; margin-top: 15px;">
                <textarea id="report-reason" placeholder="Describe por qué reportas este lugar..." class="panel-input panel-textarea" style="font-size: 0.85rem; height: 80px;"></textarea>
                <button class="panel-btn" id="submit-report-btn" style="margin-top: 10px; background: #ff385c;">Enviar solicitud de revisión</button>
            </div>
        `;

        document.getElementById('copy-address').onclick = () => {
            navigator.clipboard.writeText(loc.direccion);
            alert('Dirección copiada al portapapeles');
        };

        if (loc.estado === 'pendiente') {
            document.getElementById('vote-confirm').onclick = () => handleVote(loc, 'confirm', marker);
            
            const voteFalseBtn = document.getElementById('vote-false');
            const reportForm = document.getElementById('report-form-container');
            const submitReportBtn = document.getElementById('submit-report-btn');

            voteFalseBtn.onclick = () => {
                reportForm.style.display = 'block';
                voteFalseBtn.parentElement.style.display = 'none';
            };

            submitReportBtn.onclick = () => {
                const reason = document.getElementById('report-reason').value.trim();
                if (!reason) {
                    alert('Por favor, escribe el motivo de tu reporte.');
                    return;
                }
                handleVote(loc, 'false', marker, reason);
            };
        }
    }

    async function handleVote(loc, type, marker, reason = '') {
        if (!currentUser) {
            alert('Inicia sesión para votar.');
            return;
        }

        if (type === 'confirm') {
            // Verificar si ya votó
            const { data: existing } = await supabaseClient
                .from('confirmaciones')
                .select('*')
                .match({ usuario_id: currentUser.id, local_id: loc.id });

            if (existing && existing.length > 0) {
                alert('Ya has confirmado este lugar.');
                return;
            }

            const { error } = await supabaseClient
                .from('confirmaciones')
                .insert([{ usuario_id: currentUser.id, local_id: loc.id }]);

            if (!error) {
                const newCount = (loc.confirmaciones || 0) + 1;
                const updates = { confirmaciones: newCount };
                if (newCount >= 5) updates.estado = 'verificado';

                await supabaseClient.from('locales').update(updates).eq('id', loc.id);
                loc.confirmaciones = newCount;
                if (newCount >= 5) loc.estado = 'verificado';
                alert('¡Gracias por confirmar!');
            }
        } else {
            // Reporte
            const { error } = await supabaseClient
                .from('reportes')
                .insert([{ usuario_id: currentUser.id, local_id: loc.id, motivo: reason }]);

            if (!error) {
                alert('Reporte enviado correctamente.');
            }
        }
        showLocationDetails(loc, marker); // Refrescar vista
    }

    function updateMarkerIcon(loc, marker) {
        const icon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div class="marker-pin"></div>`,
            iconSize: [30, 42],
            iconAnchor: [15, 42]
        });
        marker.setIcon(icon);
    }

    // Lógica de Perfil / Navegación interna
    function initProfileEvents() {
        const profileView = document.getElementById('profile-view');
        
        if (!currentUser) {
            profileView.innerHTML = `
                <h3 class="profile-welcome">Bienvenido a Quick Inn</h3>
                <div class="profile-actions">
                    <button class="panel-btn profile-btn" id="go-to-login">Ingresar</button>
                    <button class="panel-btn profile-btn-outline" id="go-to-register">Registrarse</button>
                </div>
            `;
            
            document.getElementById('go-to-login').onclick = () => {
                showPanelView('login');
                initLoginEvents();
            };
            
            document.getElementById('go-to-register').onclick = () => {
                showPanelView('register');
                initRegisterEvents();
            };
        } else {
            profileView.innerHTML = `
                <h3 class="profile-welcome">Hola, ${currentUser.nombre_usuario}</h3>
                <p class="panel-hint">${currentUser.rol === 'admin' ? 'Modo Administrador' : 'Usuario Registrado'}</p>
                <div class="profile-actions" style="margin-top: 30px;">
                    <button class="panel-btn profile-btn-outline" id="logout-btn">Cerrar Sesión</button>
                </div>
            `;
            
            document.getElementById('logout-btn').onclick = async () => {
                await signOut();
                currentUser = null;
                initProfileEvents();
            };
        }
    }

    function initLoginEvents() {
        const goToRegisterLink = document.getElementById('go-to-register-link');
        const loginSubmit = document.getElementById('login-submit');
        
        if (goToRegisterLink) {
            goToRegisterLink.addEventListener('click', () => {
                showPanelView('register');
                initRegisterEvents();
            });
        }

        if (loginSubmit) {
            loginSubmit.onclick = async () => {
                const name = document.getElementById('login-name').value.trim();
                const pass = document.getElementById('login-pass').value;

                if (!name || !pass) {
                    alert('Por favor, completa todos los campos.');
                    return;
                }

                loginSubmit.disabled = true;
                loginSubmit.textContent = 'Ingresando...';

                const { data, error } = await signIn(name, pass);

                if (error) {
                    alert('Error: ' + error.message);
                    loginSubmit.disabled = false;
                    loginSubmit.textContent = 'Ingresar';
                    return;
                }

                currentUser = data;
                showPanelView('profile');
                initProfileEvents();
                alert(`Bienvenido, ${currentUser.nombre_usuario}`);
            };
        }
    }

    function initRegisterEvents() {
        const goToLoginLink = document.getElementById('go-to-login-link');
        const registerBtn = document.getElementById('register-btn');
        const passInput = document.getElementById('reg-pass');
        const confirmPassInput = document.getElementById('reg-pass-confirm');
        const errorMsg = document.getElementById('reg-error');

        if (goToLoginLink) {
            goToLoginLink.addEventListener('click', () => {
                showPanelView('login');
                initLoginEvents();
            });
        }

        if (registerBtn) {
            registerBtn.addEventListener('click', async () => {
                const name = document.getElementById('reg-name').value.trim();
                const email = document.getElementById('reg-email').value.trim();
                const pass = passInput.value;
                const confirmPass = confirmPassInput.value;

                if (name === '' || email === '' || pass === '' || confirmPass === '') {
                    errorMsg.textContent = 'Por favor, completa todos los campos.';
                    errorMsg.style.display = 'block';
                } else if (pass !== confirmPass) {
                    errorMsg.textContent = 'Las contraseñas no coinciden.';
                    errorMsg.style.display = 'block';
                    confirmPassInput.style.borderColor = '#ff385c';
                } else {
                    registerBtn.disabled = true;
                    registerBtn.textContent = 'Registrando...';

                    const { error } = await signUp(email, pass, name);

                    if (error) {
                        alert('Error en registro: ' + error.message);
                        registerBtn.disabled = false;
                        registerBtn.textContent = 'Registrarse';
                    } else {
                        alert('¡Registro exitoso! Por favor, inicia sesión.');
                        showPanelView('login');
                        initLoginEvents();
                    }
                }
            });

            // Limpiar error al escribir
            [passInput, confirmPassInput].forEach(input => {
                input.addEventListener('input', () => {
                    errorMsg.style.display = 'none';
                    confirmPassInput.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                });
            });
        }
    }

    // Función auxiliar para cambiar el contenido del panel dinámicamente
    function showPanelView(key) {
        if (!panelData[key]) return;
        currentPanelKey = key; // Actualizar clave actual
        
        // Efecto de transición
        panelTitle.style.animation = 'none';
        panelContent.style.animation = 'none';
        panelTitle.offsetHeight;
        panelContent.offsetHeight;
        panelTitle.style.animation = null;
        panelContent.style.animation = null;

        panelTitle.textContent = panelData[key].title;
        panelContent.innerHTML = panelData[key].content;
    }

    // Lógica de Búsqueda
    function initSearchEvents() {
        const searchInput = document.getElementById('search-input');
        const searchTrigger = document.getElementById('search-trigger');
        const searchClear = document.getElementById('search-clear');
        const resultsContainer = document.getElementById('search-results');
        const historyContainer = document.getElementById('search-history');
        let debounceTimer;

        // Mostrar historial al cargar el panel
        renderHistory();

        // --- Manejo de la 'X' para limpiar buscador principal ---
        if (searchInput && searchClear) {
            // Mostrar/Ocultar al escribir
            searchInput.addEventListener('input', () => {
                searchClear.style.display = searchInput.value.length > 0 ? 'flex' : 'none';
            });

            // Acción de limpiar
            searchClear.addEventListener('click', (e) => {
                e.stopPropagation();
                searchInput.value = '';
                searchClear.style.display = 'none';
                resultsContainer.innerHTML = '';
                searchInput.focus();
            });
        }

        function renderHistory() {
            if (!historyContainer) return;
            historyContainer.innerHTML = '';
            searchHistory.forEach(item => {
                const div = document.createElement('div');
                div.className = 'history-item';
                div.textContent = item.name.length > 40 ? item.name.substring(0, 37) + '...' : item.name;
                div.onclick = () => {
                    map.flyTo([item.lat, item.lon], 16);
                    sidePanel.classList.remove('open');
                    sidebarItems.forEach(i => i.classList.remove('active'));
                };
                historyContainer.appendChild(div);
            });
        }

        function addToHistory(name, lat, lon) {
            // Evitar duplicados consecutivos
            if (searchHistory.length > 0 && searchHistory[0].name === name) return;
            
            // Añadir al inicio
            searchHistory.unshift({ name, lat, lon });
            
            // Limitar a 3 elementos
            if (searchHistory.length > 3) {
                searchHistory.pop();
            }
            renderHistory();
        }

        const performSearch = async (isAuto = false) => {
            const query = searchInput.value.trim();
            
            if (query.length < 3) {
                resultsContainer.innerHTML = '';
                return;
            }

            if (!isAuto) {
                resultsContainer.innerHTML = '<p class="panel-empty">Buscando...</p>';
            }

            try {
                // Usar la API de Nominatim (OpenStreetMap)
                const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
                const data = await response.json();

                if (data.length === 0) {
                    if (!isAuto) resultsContainer.innerHTML = '<p class="panel-empty">No se encontraron resultados.</p>';
                } else {
                    resultsContainer.innerHTML = ''; // Limpiar antes de mostrar nuevos
                    
                    // Si el usuario presionó Enter o Lupa (no es auto), ir al primer resultado
                    if (!isAuto && data.length > 0) {
                        const first = data[0];
                        goToSearchResult(first.display_name, parseFloat(first.lat), parseFloat(first.lon));
                        return;
                    }

                    data.forEach(result => {
                        const div = document.createElement('div');
                        div.className = 'result-item';
                        div.textContent = result.display_name;
                        div.onclick = () => {
                            goToSearchResult(result.display_name, parseFloat(result.lat), parseFloat(result.lon));
                        };
                        resultsContainer.appendChild(div);
                    });
                }
            } catch (error) {
                console.error('Error en la búsqueda:', error);
                if (!isAuto) resultsContainer.innerHTML = '<p class="panel-empty">Error de conexión.</p>';
            }
        };

        const goToSearchResult = async (name, lat, lon) => {
            // Añadir al historial
            addToHistory(name, lat, lon);

            // Guardar en Supabase si hay usuario
            if (currentUser) {
                await supabaseClient.from('historial_busqueda').insert([{
                    usuario_id: currentUser.id,
                    termino: name,
                    latitud_buscada: lat,
                    longitud_buscada: lon
                }]);
            }
            
            // Efecto de pulso
            showSearchPulse(lat, lon);
            
            map.flyTo([lat, lon], 16, {
                duration: 2
            });
            
            // Cerrar panel en móviles si es necesario, o solo limpiar clases
            if (window.innerWidth <= 768) {
                sidePanel.classList.remove('open');
                sidebarItems.forEach(i => i.classList.remove('active'));
            }
        };

        const showSearchPulse = (lat, lon) => {
            if (searchPulseMarker) {
                map.removeLayer(searchPulseMarker);
            }

            const pulseIcon = L.divIcon({
                className: 'search-pulse-marker',
                html: '<div class="pulse-ring"></div>',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });

            searchPulseMarker = L.marker([lat, lon], { icon: pulseIcon }).addTo(map);

            // El marcador ya no se elimina automáticamente para que el lugar quede marcado
        };

        // Evento input para búsqueda en tiempo real con debounce
        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => performSearch(true), 500);
        });

        searchTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            clearTimeout(debounceTimer);
            performSearch(false);
        });

        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(debounceTimer);
                performSearch(false);
            }
        });
    }

    closePanelBtn.addEventListener('click', () => {
        if (currentPanelKey === 'login' || currentPanelKey === 'register' || currentPanelKey === 'authRequired') {
            showPanelView('profile');
            initProfileEvents();
        } else {
            sidePanel.classList.remove('open');
            // Quitar clase activa al cerrar el panel
            sidebarItems.forEach(i => i.classList.remove('active'));
            currentPanelKey = '';
        }
    });

    // Iniciar aplicación
    initMap();
    loadInitialData();

    async function loadInitialData() {
        const { data, error } = await fetchLocales();
        if (!error && data) {
            data.forEach(loc => addLocationToMap(loc));
        }

        // Verificar sesión activa
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            const { data: userData } = await supabaseClient
                .from('usuario')
                .select('*')
                .eq('id', session.user.id)
                .single();
            if (userData) currentUser = userData;
        }
    }
});
