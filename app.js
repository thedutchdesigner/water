// app.js with improved AR support, map bug fixes, and performance enhancements

// Pure Leaflet + CartoDB Positron minimal tiles
const map = L.map('map').setView([0, 0], 2);
L.tileLayer(
  'https://cartodb-basemaps-a.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}.png',
  { maxZoom: 19, attribution: '© OpenStreetMap contributors © CartoDB' }
).addTo(map);

// Marker cluster group with improved settings
const markersCluster = L.markerClusterGroup({ 
  maxClusterRadius: 60,
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: true,
  maxClusterRadius: function(zoom) {
    // Dynamic cluster radius based on zoom level
    return zoom < 10 ? 80 : zoom < 15 ? 60 : 40;
  }
});
map.addLayer(markersCluster);

// Location marker
let locationMarker;
let userLocation = null;

// Improved location handling
function initializeLocation() {
  map.locate({ 
    setView: true, 
    maxZoom: 16, 
    timeout: 10000,
    enableHighAccuracy: true 
  });
}

map.on('locationerror', (e) => {
  console.warn('Location error:', e.message);
  alert('Could not get your location. Please ensure location services are enabled and permissions are granted.');
  // Fallback to a default location or let user manually set location
});

map.on('locationfound', (e) => {
  if (locationMarker) map.removeLayer(locationMarker);
  locationMarker = L.circleMarker(e.latlng, { 
    radius: 8, 
    color: '#007bff', 
    fillColor: '#007bff', 
    fillOpacity: 0.7, 
    stroke: false 
  }).addTo(map);
  
  userLocation = e.latlng;
  map.setView(e.latlng, 16);
  fetchNearby(e.latlng.lat, e.latlng.lng, 1000);
});

// Debounced bbox fetch and cache with improved error handling
let fetchTimeout;
const bboxCache = new Map();
const CACHE_EXPIRE_TIME = 5 * 60 * 1000; // 5 minutes

map.on('moveend', () => {
  clearTimeout(fetchTimeout);
  fetchTimeout = setTimeout(() => {
    const b = map.getBounds();
    const key = [
      b.getSouth().toFixed(3), b.getWest().toFixed(3),
      b.getNorth().toFixed(3), b.getEast().toFixed(3)
    ].join(',');
    
    const cached = bboxCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_EXPIRE_TIME) {
      renderMarkers(cached.data);
    } else {
      fetchFountains(b, key);
    }
  }, 500);
});

// Fixed template strings and improved error handling
async function fetchNearby(lat, lon, radius) {
  const query = `[out:json][timeout:15];node["amenity"="drinking_water"](around:${radius},${lat},${lon});out center;`;
  try {
    const resp = await fetch('https://overpass-api.de/api/interpreter', { 
      method: 'POST', 
      body: query,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    if (!resp.ok) throw new Error(`Overpass API error: ${resp.status}`);
    const data = await resp.json();
    renderMarkers(data.elements);
  } catch (err) {
    console.error('Overpass radius error', err);
    showNotification('Failed to load nearby water sources. Please try again.', 'error');
  }
}

async function fetchFountains(bounds, key) {
  const query = `[out:json][timeout:25];(node["amenity"="drinking_water"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});way["amenity"="drinking_water"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});relation["amenity"="drinking_water"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}););out center;`;
  
  try {
    const resp = await fetch('https://overpass-api.de/api/interpreter', { 
      method: 'POST', 
      body: query,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    if (!resp.ok) throw new Error(`Overpass API error: ${resp.status}`);
    const data = await resp.json();
    bboxCache.set(key, { data: data.elements, timestamp: Date.now() });
    renderMarkers(data.elements);
  } catch (err) {
    console.error('Overpass bbox error', err);
    showNotification('Failed to load water sources in this area. Please try again.', 'error');
  }
}

// Improved marker rendering with better popup content
function renderMarkers(elements) {
  markersCluster.clearLayers();
  window._fountains = elements || [];
  
  (elements || []).forEach((el) => {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) return;
    
    const name = el.tags?.name || 'Drinking water';
    const operator = el.tags?.operator ? `<br><small>Operator: ${el.tags.operator}</small>` : '';
    const access = el.tags?.access ? `<br><small>Access: ${el.tags.access}</small>` : '';
    
    // Calculate distance if user location is available
    let distanceInfo = '';
    if (userLocation) {
      const distance = userLocation.distanceTo([lat, lon]);
      distanceInfo = `<br><small>Distance: ${Math.round(distance)}m</small>`;
    }
    
    const popupContent = `
      <div class="fountain-popup">
        <strong>${name}</strong>
        ${operator}
        ${access}
        ${distanceInfo}
        <br/>
        <button class="nav-button" data-lat="${lat}" data-lon="${lon}">Navigate</button>
      </div>
    `;
    
    markersCluster.addLayer(
      L.marker([lat, lon]).bindPopup(popupContent)
    );
  });
}

// Navigate handler with improved URL generation
window.navigate = (lat, lon) => {
  const isIOS = /iP(hone|od|ad)/.test(navigator.platform);
  const isAndroid = /Android/.test(navigator.userAgent);
  
  let finalUrl;
  if (isIOS) {
    finalUrl = `maps://maps.apple.com/?daddr=${lat},${lon}&dirflg=w`;
  } else if (isAndroid) {
    finalUrl = `google.navigation:q=${lat},${lon}&mode=w`;
  } else {
    finalUrl = `https://maps.google.com/maps?daddr=${lat},${lon}&travelmode=walking`;
  }
  
  window.open(finalUrl, '_blank');
};

// Improved event delegation with better error handling
if (document.getElementById('map')) {
  document.getElementById('map').addEventListener('click', function(event) {
    let target = event.target;
    while (target && target !== this && !target.classList.contains('nav-button')) {
      target = target.parentNode;
    }
    if (target && target.classList.contains('nav-button')) {
      const latStr = target.getAttribute('data-lat');
      const lonStr = target.getAttribute('data-lon');
      if (latStr && lonStr) {
        navigate(parseFloat(latStr), parseFloat(lonStr));
      } else {
        console.error("Navigate button clicked without lat/lon data attributes.");
        showNotification('Navigation data not available', 'error');
      }
    }
  });
}

// Notification system
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: ${type === 'error' ? '#f44336' : '#2196F3'};
    color: white;
    padding: 12px 24px;
    border-radius: 4px;
    z-index: 10003;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  `;
  
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.remove();
  }, 5000);
}

// AR functionality with improved error handling
const arBtn = document.getElementById('ar-button');
const arView = document.getElementById('ar-view');
const arVideo = document.getElementById('ar-video');
const arCanvas = document.getElementById('ar-overlay');
const arInfo = document.getElementById('ar-info');
const exitArBtn = document.getElementById('exit-ar');

let arStream, deviceOrientationWatcher, animationFrameId;
let currentHeading = 0;
let isARActive = false;

const HFOV_DEGREES = 75;
const MAX_AR_DISTANCE = 1000;

arBtn.addEventListener('click', async () => {
  if (!isARActive) {
    await startARMode();
  } else {
    stopAR();
  }
});

exitArBtn.addEventListener('click', stopAR);

async function startARMode() {
  try {
    console.log('AR: Attempting to start AR mode.');
    
    // Check for required APIs
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera access not supported on this device/browser.');
    }

    arCanvas.width = window.innerWidth;
    arCanvas.height = window.innerHeight;

    console.log('AR: Requesting camera access...');
    arStream = await navigator.mediaDevices.getUserMedia({ 
      video: { 
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }, 
      audio: false 
    });
    
    arVideo.srcObject = arStream;
    await arVideo.play();

    // Request orientation permissions on iOS
    if (typeof DeviceOrientationEvent !== 'undefined' && 
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      const permissionState = await DeviceOrientationEvent.requestPermission();
      if (permissionState !== 'granted') {
        throw new Error('Orientation permission not granted by user.');
      }
    }
    
    startAR();
    isARActive = true;
    arView.style.display = 'block';
    exitArBtn.style.display = 'block';
    document.body.style.overflow = 'hidden';
    
    showNotification('AR mode activated. Point your camera around to find water sources.', 'info');
    
  } catch (e) {
    console.error('AR initialization error:', e);
    showNotification(`AR mode not available: ${e.message}`, 'error');
    stopAR();
  }
}

function deviceOrientationHandler(event) {
  let newHeadingReported = false;
  let newHeadingValue = currentHeading;

  if (event.absolute === true && event.alpha !== null && event.alpha !== undefined) {
    newHeadingValue = event.alpha;
    newHeadingReported = true;
  } else if (event.webkitCompassHeading !== null && event.webkitCompassHeading !== undefined) {
    newHeadingValue = event.webkitCompassHeading;
    newHeadingReported = true;
    if (event.absolute === false) {
      console.warn("AR: Using webkitCompassHeading, but event.absolute is false. Heading might drift.");
    }
  } else if (event.alpha !== null && event.alpha !== undefined) {
    newHeadingValue = event.alpha;
    newHeadingReported = true;
    console.warn("AR: Device orientation data is not 'absolute'. May be unreliable.");
  }

  if (newHeadingReported) {
    currentHeading = newHeadingValue;
  }
}

function startAR() {
  if (!window.DeviceOrientationEvent) {
    throw new Error('Device orientation not supported.');
  }

  deviceOrientationWatcher = deviceOrientationHandler;
  
  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', deviceOrientationWatcher, true);
  } else {
    window.addEventListener('deviceorientation', deviceOrientationWatcher, true);
  }
  
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  arRenderLoop();
  arInfo.textContent = 'Point your camera around to find water sources...';
}

function stopAR() {
  isARActive = false;
  arView.style.display = 'none';
  exitArBtn.style.display = 'none';
  document.body.style.overflow = '';

  if (arStream) {
    arStream.getTracks().forEach(track => track.stop());
    arStream = null;
  }
  
  if (deviceOrientationWatcher) {
    if ('ondeviceorientationabsolute' in window) {
      window.removeEventListener('deviceorientationabsolute', deviceOrientationWatcher);
    } else {
      window.removeEventListener('deviceorientation', deviceOrientationWatcher);
    }
    deviceOrientationWatcher = null;
  }
  
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  
  const ctx = arCanvas.getContext('2d');
  ctx.clearRect(0, 0, arCanvas.width, arCanvas.height);
  arInfo.textContent = 'Finding nearest fountains...';
}

function arRenderLoop() {
  if (!isARActive) return;
  drawAR(currentHeading);
  animationFrameId = requestAnimationFrame(arRenderLoop);
}

function drawAR(heading) {
  const ctx = arCanvas.getContext('2d');
  ctx.clearRect(0, 0, arCanvas.width, arCanvas.height);

  const fountains = window._fountains || [];
  if (!userLocation) {
    arInfo.textContent = 'User location not available.';
    return;
  }

  let arFountains = fountains
    .map(f => {
      const lat = f.lat ?? f.center?.lat;
      const lon = f.lon ?? f.center?.lon;
      if (lat == null || lon == null) return null;

      const fountainPos = L.latLng(lat, lon);
      const dist = userLocation.distanceTo(fountainPos);
      if (dist > MAX_AR_DISTANCE) return null;

      // Calculate bearing using more precise formula
      const dLon = L.Util.degToRad(lon - userLocation.lng);
      const lat1 = L.Util.degToRad(userLocation.lat);
      const lat2 = L.Util.degToRad(lat);
      
      const y = Math.sin(dLon) * Math.cos(lat2);
      const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
      let bearing = (L.Util.radToDeg(Math.atan2(y, x)) + 360) % 360;

      let relativeAngle = bearing - heading;
      while (relativeAngle <= -180) relativeAngle += 360;
      while (relativeAngle > 180) relativeAngle -= 360;
      
      return { 
        name: f.tags?.name || 'Drinking water', 
        dist, 
        relativeAngle, 
        id: f.id, 
        lat, 
        lon 
      };
    })
    .filter(f => f !== null && Math.abs(f.relativeAngle) <= HFOV_DEGREES / 2)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5); // Show up to 5 fountains

  const canvasCenterX = arCanvas.width / 2;
  const canvasBottomY = arCanvas.height - 80;
  const projectionMaxY = arCanvas.height * 0.3;

  arFountains.forEach((f, index) => {
    const screenX = canvasCenterX + (f.relativeAngle / (HFOV_DEGREES / 2)) * (canvasCenterX * 0.9);
    const yRatio = Math.max(0, Math.min(1, 1 - (f.dist / MAX_AR_DISTANCE)));
    const screenY = canvasBottomY - (yRatio * (canvasBottomY - projectionMaxY));
    const iconRadius = 10 + (8 * yRatio);

    // Draw fountain icon
    ctx.fillStyle = `rgba(0, 123, 255, ${0.7 + 0.3 * yRatio})`;
    ctx.beginPath();
    ctx.arc(screenX, screenY, iconRadius, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw distance text
    ctx.fillStyle = 'white';
    ctx.font = `bold ${12 + (4 * yRatio)}px Arial`;
    ctx.textAlign = 'center';
    ctx.shadowColor = "black";
    ctx.shadowBlur = 4;
    ctx.fillText(`${Math.round(f.dist)}m`, screenX, screenY + iconRadius + 16 + (3 * yRatio));
    
    // Draw name for closest fountain
    if (index === 0 && f.name !== 'Drinking water') {
      ctx.font = `${10 + (2 * yRatio)}px Arial`;
      ctx.fillText(f.name, screenX, screenY + iconRadius + 32 + (3 * yRatio));
    }
    
    ctx.shadowBlur = 0;
  });

  // Update info display
  if (arFountains.length > 0) {
    const nearest = arFountains[0];
    arInfo.textContent = `${Math.round(nearest.dist)}m to ${nearest.name}`;
  } else {
    const totalFountains = (window._fountains || []).length;
    if (totalFountains > 0) {
      arInfo.textContent = `${totalFountains} water sources found nearby (none in view)`;
    } else {
      arInfo.textContent = 'No water sources found in this area';
    }
  }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
  initializeLocation();
  
  // Add refresh button functionality
  const refreshBtn = document.createElement('button');
  refreshBtn.innerHTML = '🔄';
  refreshBtn.title = 'Refresh location';
  refreshBtn.style.cssText = `
    position: fixed;
    top: 15px;
    left: 15px;
    z-index: 10000;
    background: white;
    border: 1px solid #ccc;
    border-radius: 50%;
    padding: 8px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    cursor: pointer;
    font-size: 1.2em;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  
  refreshBtn.addEventListener('click', () => {
    bboxCache.clear(); // Clear cache to force refresh
    initializeLocation();
  });
  
  document.body.appendChild(refreshBtn);
});

// Handle orientation changes
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    map.invalidateSize();
    if (isARActive) {
      arCanvas.width = window.innerWidth;
      arCanvas.height = window.innerHeight;
    }
  }, 100);
});

// Handle visibility changes to pause/resume AR
document.addEventListener('visibilitychange', () => {
  if (document.hidden && isARActive) {
    // Pause AR when tab is hidden
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  } else if (!document.hidden && isARActive) {
    // Resume AR when tab becomes visible
    arRenderLoop();
  }
});
