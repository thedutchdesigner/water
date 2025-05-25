// app.js with major performance optimizations

// Pure Leaflet + CartoDB Positron minimal tiles
const map = L.map('map').setView([0, 0], 2);
L.tileLayer(
  'https://cartodb-basemaps-a.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}.png',
  { maxZoom: 19, attribution: '© OpenStreetMap contributors © CartoDB' }
).addTo(map);

// PERFORMANCE: Optimized marker cluster with static settings
const markersCluster = L.markerClusterGroup({ 
  maxClusterRadius: 50, // Static value - no dynamic calculation
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: true,
  disableClusteringAtZoom: 18, // Disable clustering at high zoom
  chunkedLoading: true, // Enable chunked loading for better performance
  chunkProgress: function(processed, total) {
    // Optional: show loading progress for large datasets
    if (processed === total) {
      hideLoadingIndicator();
    }
  }
});
map.addLayer(markersCluster);

// Location marker
let locationMarker;
let userLocation = null;

// PERFORMANCE: Request management
let currentFetchController = null;
let lastFetchBounds = null;
const MIN_ZOOM_FOR_FETCH = 10; // Don't fetch at very low zoom levels

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

// PERFORMANCE: Optimized debounced fetch with zoom-based delays and request cancellation
let fetchTimeout;
const bboxCache = new Map();
const CACHE_EXPIRE_TIME = 10 * 60 * 1000; // 10 minutes (longer cache)
const MAX_CACHE_ENTRIES = 50; // Limit cache size

// PERFORMANCE: Adaptive delay based on zoom level
function getDelayForZoom(zoom) {
  if (zoom < 12) return 2000; // 2 second delay for low zoom
  if (zoom < 15) return 1000; // 1 second delay for medium zoom
  return 500; // 500ms delay for high zoom
}

// PERFORMANCE: Check if bounds significantly overlap to avoid redundant requests
function boundsOverlapSignificantly(bounds1, bounds2) {
  if (!bounds1 || !bounds2) return false;
  
  const area1 = (bounds1.getNorth() - bounds1.getSouth()) * (bounds1.getEast() - bounds1.getWest());
  const area2 = (bounds2.getNorth() - bounds2.getSouth()) * (bounds2.getEast() - bounds2.getWest());
  
  // If new bounds are much larger, don't consider it overlapping
  if (area2 > area1 * 4) return false;
  
  const intersection = L.latLngBounds([
    [Math.max(bounds1.getSouth(), bounds2.getSouth()), Math.max(bounds1.getWest(), bounds2.getWest())],
    [Math.min(bounds1.getNorth(), bounds2.getNorth()), Math.min(bounds1.getEast(), bounds2.getEast())]
  ]);
  
  if (!intersection.isValid()) return false;
  
  const intersectionArea = (intersection.getNorth() - intersection.getSouth()) * 
                          (intersection.getEast() - intersection.getWest());
  
  // If intersection covers more than 70% of the smaller area, consider it overlapping
  return intersectionArea > Math.min(area1, area2) * 0.7;
}

map.on('moveend', () => {
  const currentZoom = map.getZoom();
  
  // PERFORMANCE: Skip fetching at very low zoom levels
  if (currentZoom < MIN_ZOOM_FOR_FETCH) {
    clearTimeout(fetchTimeout);
    return;
  }
  
  clearTimeout(fetchTimeout);
  const delay = getDelayForZoom(currentZoom);
  
  fetchTimeout = setTimeout(() => {
    const bounds = map.getBounds();
    
    // PERFORMANCE: Check if we need to fetch based on bounds overlap
    if (boundsOverlapSignificantly(lastFetchBounds, bounds)) {
      return; // Skip if bounds overlap significantly
    }
    
    // PERFORMANCE: Coarser cache key granularity (1 decimal place instead of 3)
    const key = [
      bounds.getSouth().toFixed(1), bounds.getWest().toFixed(1),
      bounds.getNorth().toFixed(1), bounds.getEast().toFixed(1)
    ].join(',');
    
    const cached = bboxCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_EXPIRE_TIME) {
      renderMarkers(cached.data);
      return;
    }
    
    // PERFORMANCE: Limit fetch area at low zoom levels
    const area = (bounds.getNorth() - bounds.getSouth()) * (bounds.getEast() - bounds.getWest());
    if (area > 100) { // Very large area - reduce precision or skip
      console.log('Area too large for efficient fetching, using cached data only');
      return;
    }
    
    fetchFountains(bounds, key);
    lastFetchBounds = bounds;
  }, delay);
});

// PERFORMANCE: Optimized nearby fetch with controller
async function fetchNearby(lat, lon, radius) {
  // Cancel any existing request
  if (currentFetchController) {
    currentFetchController.abort();
  }
  
  currentFetchController = new AbortController();
  
  const query = `[out:json][timeout:10];node["amenity"="drinking_water"](around:${radius},${lat},${lon});out center;`;
  
  try {
    showLoadingIndicator();
    const resp = await fetch('https://overpass-api.de/api/interpreter', { 
      method: 'POST', 
      body: query,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      signal: currentFetchController.signal
    });
    
    if (!resp.ok) throw new Error(`Overpass API error: ${resp.status}`);
    const data = await resp.json();
    renderMarkers(data.elements);
    
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('Fetch cancelled');
      return;
    }
    console.error('Overpass radius error', err);
    showNotification('Failed to load nearby water sources. Please try again.', 'error');
  } finally {
    hideLoadingIndicator();
    currentFetchController = null;
  }
}

// PERFORMANCE: Optimized bbox fetch with request cancellation and cache management
async function fetchFountains(bounds, key) {
  // Cancel any existing request
  if (currentFetchController) {
    currentFetchController.abort();
  }
  
  currentFetchController = new AbortController();
  
  // PERFORMANCE: Simplified query - only nodes, shorter timeout
  const query = `[out:json][timeout:15];node["amenity"="drinking_water"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});out;`;
  
  try {
    showLoadingIndicator();
    const resp = await fetch('https://overpass-api.de/api/interpreter', { 
      method: 'POST', 
      body: query,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      signal: currentFetchController.signal
    });
    
    if (!resp.ok) throw new Error(`Overpass API error: ${resp.status}`);
    const data = await resp.json();
    
    // PERFORMANCE: Cache management - limit cache size
    if (bboxCache.size >= MAX_CACHE_ENTRIES) {
      // Remove oldest entries
      const entries = Array.from(bboxCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = entries.slice(0, Math.floor(MAX_CACHE_ENTRIES / 2));
      toRemove.forEach(([key]) => bboxCache.delete(key));
    }
    
    bboxCache.set(key, { data: data.elements, timestamp: Date.now() });
    renderMarkers(data.elements);
    
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('Fetch cancelled');
      return;
    }
    console.error('Overpass bbox error', err);
    showNotification('Failed to load water sources in this area. Please try again.', 'error');
  } finally {
    hideLoadingIndicator();
    currentFetchController = null;
  }
}

// PERFORMANCE: Optimized marker rendering with batching and limits
function renderMarkers(elements) {
  const maxMarkers = getMaxMarkersForZoom(map.getZoom());
  const filteredElements = elements.slice(0, maxMarkers);
  
  // PERFORMANCE: Clear markers efficiently
  markersCluster.clearLayers();
  window._fountains = filteredElements || [];
  
  if (!filteredElements || filteredElements.length === 0) {
    hideLoadingIndicator();
    return;
  }
  
  // PERFORMANCE: Batch marker creation
  const markers = [];
  const batchSize = 100;
  
  function processBatch(startIndex) {
    const endIndex = Math.min(startIndex + batchSize, filteredElements.length);
    
    for (let i = startIndex; i < endIndex; i++) {
      const el = filteredElements[i];
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat == null || lon == null) continue;
      
      const name = el.tags?.name || 'Drinking water';
      const operator = el.tags?.operator ? `<br><small>Operator: ${el.tags.operator}</small>` : '';
      const access = el.tags?.access ? `<br><small>Access: ${el.tags.access}</small>` : '';
      
      // PERFORMANCE: Calculate distance only when needed
      let distanceInfo = '';
      if (userLocation && map.getZoom() > 14) {
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
      
      markers.push(L.marker([lat, lon]).bindPopup(popupContent));
    }
    
    if (endIndex < filteredElements.length) {
      // Process next batch in next frame
      requestAnimationFrame(() => processBatch(endIndex));
    } else {
      // Add all markers at once
      markersCluster.addLayers(markers);
      hideLoadingIndicator();
    }
  }
  
  // Start processing
  processBatch(0);
}

// PERFORMANCE: Limit markers based on zoom level
function getMaxMarkersForZoom(zoom) {
  if (zoom < 12) return 50;
  if (zoom < 15) return 200;
  if (zoom < 17) return 500;
  return 1000;
}

// PERFORMANCE: Loading indicator functions
function showLoadingIndicator() {
  let indicator = document.getElementById('loading-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'loading-indicator';
    indicator.textContent = 'Loading water sources...';
    indicator.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background-color: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 15px 25px;
      border-radius: 8px;
      z-index: 10002;
      font-size: 14px;
    `;
    document.body.appendChild(indicator);
  }
  indicator.style.display = 'block';
}

function hideLoadingIndicator() {
  const indicator = document.getElementById('loading-indicator');
  if (indicator) {
    indicator.style.display = 'none';
  }
}

// Navigate handler (unchanged)
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

// Event delegation (unchanged)
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

// Notification system (unchanged)
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

// AR functionality (unchanged from original)
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
    .slice(0, 5);

  const canvasCenterX = arCanvas.width / 2;
  const canvasBottomY = arCanvas.height - 80;
  const projectionMaxY = arCanvas.height * 0.3;

  arFountains.forEach((f, index) => {
    const screenX = canvasCenterX + (f.relativeAngle / (HFOV_DEGREES / 2)) * (canvasCenterX * 0.9);
    const yRatio = Math.max(0, Math.min(1, 1 - (f.dist / MAX_AR_DISTANCE)));
    const screenY = canvasBottomY - (yRatio * (canvasBottomY - projectionMaxY));
    const iconRadius = 10 + (8 * yRatio);

    ctx.fillStyle = `rgba(0, 123, 255, ${0.7 + 0.3 * yRatio})`;
    ctx.beginPath();
    ctx.arc(screenX, screenY, iconRadius, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = 'white';
    ctx.font = `bold ${12 + (4 * yRatio)}px Arial`;
    ctx.textAlign = 'center';
    ctx.shadowColor = "black";
    ctx.shadowBlur = 4;
    ctx.fillText(`${Math.round(f.dist)}m`, screenX, screenY + iconRadius + 16 + (3 * yRatio));
    
    if (index === 0 && f.name !== 'Drinking water') {
      ctx.font = `${10 + (2 * yRatio)}px Arial`;
      ctx.fillText(f.name, screenX, screenY + iconRadius + 32 + (3 * yRatio));
    }
    
    ctx.shadowBlur = 0;
  });

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
    bboxCache.clear();
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

// Handle visibility changes
document.addEventListener('visibilitychange', () => {
  if (document.hidden && isARActive) {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  } else if (!document.hidden && isARActive) {
    arRenderLoop();
  }
});
