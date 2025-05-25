// app.js with improved AR support, map bug fixes, and performance enhancements

// Pure Leaflet + CartoDB Positron minimal tiles
const map = L.map('map').setView([0, 0], 2);
L.tileLayer(
  'https://cartodb-basemaps-a.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}.png',
  { maxZoom: 19, attribution: '© OpenStreetMap contributors © CartoDB' }
).addTo(map);

// Marker cluster group
const markersCluster = L.markerClusterGroup({ maxClusterRadius: 60 }); // Experiment with this value
map.addLayer(markersCluster);

// Location marker
let locationMarker;
map.locate({ setView: true, maxZoom: 16 });
map.on('locationerror', () => {
  alert('Could not get your location. Please ensure location services are enabled and permissions are granted.');
});
map.on('locationfound', (e) => {
  if (locationMarker) map.removeLayer(locationMarker);
  locationMarker = L.circleMarker(e.latlng, { radius: 8, color: '#007bff', fillColor: '#007bff', fillOpacity: 0.7, stroke: false }).addTo(map);
  map.setView(e.latlng, 16);
  fetchNearby(e.latlng.lat, e.latlng.lng, 1000);
});

// Debounced bbox fetch and cache
let fetchTimeout;
const bboxCache = new Map();
map.on('moveend', () => {
  clearTimeout(fetchTimeout);
  fetchTimeout = setTimeout(() => {
    const b = map.getBounds();
    const key = [
      b.getSouth().toFixed(3), b.getWest().toFixed(3),
      b.getNorth().toFixed(3), b.getEast().toFixed(3)
    ].join(',');
    if (bboxCache.has(key)) {
      renderMarkers(bboxCache.get(key));
    } else {
      fetchFountains(b, key);
    }
  }, 500);
});

async function fetchNearby(lat, lon, radius) {
  const query = `[out:json][timeout:15];node["amenity"="drinking_water"](around:<span class="math-inline">\{radius\},</span>{lat},${lon});out center;`;
  try {
    const resp = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
    if (!resp.ok) throw new Error(`Overpass API error: ${resp.status}`);
    const data = await resp.json();
    renderMarkers(data.elements);
  } catch (err) {
    console.error('Overpass radius error', err);
  }
}

async function fetchFountains(bounds, key) {
  const query = `[out:json][timeout:25];(node["amenity"="drinking_water"](<span class="math-inline">\{bounds\.getSouth\(\)\},</span>{bounds.getWest()},<span class="math-inline">\{bounds\.getNorth\(\)\},</span>{bounds.getEast()});way["amenity"="drinking_water"](<span class="math-inline">\{bounds\.getSouth\(\)\},</span>{bounds.getWest()},<span class="math-inline">\{bounds\.getNorth\(\)\},</span>{bounds.getEast()});relation["amenity"="drinking_water"](<span class="math-inline">\{bounds\.getSouth\(\)\},</span>{bounds.getWest()},<span class="math-inline">\{bounds\.getNorth\(\)\},</span>{bounds.getEast()}););out center;`;
  try {
    const resp = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
    if (!resp.ok) throw new Error(`Overpass API error: ${resp.status}`);
    const data = await resp.json();
    bboxCache.set(key, data.elements);
    renderMarkers(data.elements);
  } catch (err) {
    console.error('Overpass bbox error', err);
  }
}

function renderMarkers(elements) {
  markersCluster.clearLayers();
  window._fountains = elements || [];
  (elements || []).forEach((el) => {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) return;
    const name = el.tags?.name || 'Drinking water';
    // Note: data-lat and data-lon are strings here, will be parsed in navigate
    const popupContent = `<strong><span class="math-inline">\{name\}</strong\><br/\><button class\="nav\-button" data\-lat\="</span>{lat}" data-lon="${lon}">Navigate</button>`;
    markersCluster.addLayer(
      L.marker([lat, lon]).bindPopup(popupContent)
    );
  });
}

// Navigate handler - attached ONCE via event delegation later
window.navigate = (lat, lon) => { // Expects lat, lon to be numbers
  const isIOS = /iP(hone|od|ad)/.test(navigator.platform);
  const appleUrl = `maps://maps.apple.com/?daddr=<span class="math-inline">\{lat\},</span>{lon}&dirflg=w`;
  const googleUrl = `http://maps.google.com/maps?daddr=<span class="math-inline">\{lat\},</span>{lon}&travelmode=walking`; // Corrected Google Maps URL
  const finalUrl = isIOS ? appleUrl : googleUrl;
  window.open(finalUrl, '_blank');
};

// Attach navigate button listener using event delegation ONCE after map is ready
// Ensure map element is available
if (document.getElementById('map')) {
    document.getElementById('map').addEventListener('click', function(event) {
      let target = event.target;
      // Traverse up the DOM if the click was on an element inside the button
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
        }
      }
    });
}


// AR functionality
const arBtn = document.getElementById('ar-button');
const arView = document.getElementById('ar-view');
const arVideo = document.getElementById('ar-video'); // Corrected ID from camera-video
const arCanvas = document.getElementById('ar-overlay'); // Corrected ID from camera-overlay
const arInfo = document.getElementById('ar-info'); // Corrected ID from distance-info
const exitArBtn = document.getElementById('exit-ar'); // Get exit button

let arStream, deviceOrientationWatcher, animationFrameId;
let currentHeading = 0;

const HFOV_DEGREES = 75;
const MAX_AR_DISTANCE = 1000;

arBtn.addEventListener('click', async () => {
  if (arView.style.display === 'none') {
    try {
      console.log('AR: Attempting to start AR mode.');
      arCanvas.width = window.innerWidth;
      arCanvas.height = window.innerHeight;
      console.log('AR: Canvas resized.');

      console.log('AR: Requesting camera access...');
      arStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      console.log('AR: Camera access granted.');
      arVideo.srcObject = arStream;
      
      console.log('AR: Attempting to play video...');
      await arVideo.play();
      console.log('AR: Video playing.');

      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        console.log('AR: Requesting orientation permission (iOS)...');
        const permissionState = await DeviceOrientationEvent.requestPermission();
        console.log('AR: Orientation permission state:', permissionState);
        if (permissionState !== 'granted') {
          throw new Error('Orientation permission not granted by user.');
        }
      }
      
      console.log('AR: Calling startAR()...');
      startAR(); // This can throw 'Device orientation not supported.'
      console.log('AR: startAR() completed.');

      arView.style.display = 'block';
      exitArBtn.style.display = 'block'; // Show exit button
      console.log('AR: View displayed.');
      document.body.style.overflow = 'hidden';
    } catch (e) {
      console.error('AR initialization error:', e.name, e.message, e);
      alert(`AR mode not available: ${e.message}. Check console for details. Ensure camera and motion sensor access is allowed.`);
      stopAR();
    }
  } else {
    console.log('AR: Stopping AR mode.');
    stopAR();
  }
});

exitArBtn.addEventListener('click', stopAR); // Add event listener for exit button

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
    console.warn("AR: Device orientation data is not 'absolute' and no 'webkitCompassHeading'. Using raw 'alpha'. May be unreliable.");
  }

  if (newHeadingReported) {
    currentHeading = newHeadingValue;
  }
  // currentPitch = event.beta ?? 0; // For future use
}

function startAR() {
  if (window.DeviceOrientationEvent) {
    deviceOrientationWatcher = deviceOrientationHandler;
    // Prefer 'deviceorientationabsolute' if available
    if ('ondeviceorientationabsolute' in window) {
        console.log("AR: Listening to 'deviceorientationabsolute'.");
        window.addEventListener('deviceorientationabsolute', deviceOrientationWatcher, true);
    } else {
        console.log("AR: 'deviceorientationabsolute' not available, falling back to 'deviceorientation'.");
        window.addEventListener('deviceorientation', deviceOrientationWatcher, true);
    }
  } else {
    console.error("AR: Device orientation not supported on this device/browser.");
    throw new Error('Device orientation not supported.');
  }
  
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  arRenderLoop();
  arInfo.textContent = 'Point your camera around...';
}

function stopAR() {
  arView.style.display = 'none';
  exitArBtn.style.display = 'none'; // Hide exit button
  document.body.style.overflow = '';

  if (arStream) {
    arStream.getTracks().forEach(track => track.stop());
    arStream = null;
    console.log("AR: Camera stream stopped.");
  }
  if (deviceOrientationWatcher) {
    if ('ondeviceorientationabsolute' in window) {
        window.removeEventListener('deviceorientationabsolute', deviceOrientationWatcher);
    } else {
        window.removeEventListener('deviceorientation', deviceOrientationWatcher);
    }
    deviceOrientationWatcher = null;
    console.log("AR: Device orientation watcher removed.");
  }
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
    console.log("AR: Animation frame loop stopped.");
  }
  const ctx = arCanvas.getContext('2d');
  ctx.clearRect(0, 0, arCanvas.width, arCanvas.height);
  arInfo.textContent = 'Finding nearest fountains...';
}

function arRenderLoop() {
  drawAR(currentHeading);
  animationFrameId = requestAnimationFrame(arRenderLoop);
}

function drawAR(heading) {
  const ctx = arCanvas.getContext('2d');
  ctx.clearRect(0, 0, arCanvas.width, arCanvas.height);

  const fountains = window._fountains || [];
  if (!locationMarker) {
    arInfo.textContent = 'User location not available.';
    return;
  }
  const userPos = locationMarker.getLatLng();

  let arFountains = fountains
    .map(f => {
      const lat = f.lat ?? f.center?.lat;
      const lon = f.lon ?? f.center?.lon;
      if (lat == null || lon == null) return null;

      const fountainPos = L.latLng(lat, lon);
      const dist = userPos.distanceTo(fountainPos);
      if (dist > MAX_AR_DISTANCE) return null;

      const y = Math.sin(L.Util.degToRad(lon - userPos.lng)) * Math.cos(L.Util.degToRad(lat));
      const x = Math.cos(L.Util.degToRad(userPos.lat)) * Math.sin(L.Util.degToRad(lat)) -
                Math.sin(L.Util.degToRad(userPos.lat)) * Math.cos(L.Util.degToRad(lat)) * Math.cos(L.Util.degToRad(lon - userPos.lng));
      let bearing = (L.Util.radToDeg(Math.atan2(y, x)) + 360) % 360;

      let relativeAngle = bearing - heading;
      while (relativeAngle <= -180) relativeAngle += 360;
      while (relativeAngle > 180) relativeAngle -= 360;
      
      return { name: f.tags?.name || 'Drinking water', dist, relativeAngle, id: f.id, lat, lon };
    })
    .filter(f => f !== null && Math.abs(f.relativeAngle) <= HFOV_DEGREES / 2)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3);

  const canvasCenterX = arCanvas.width / 2;
  const canvasBottomY = arCanvas.height - 50;
  const projectionMaxY = arCanvas.height * 0.4;

  arFountains.forEach((f) => {
    const screenX = canvasCenterX + (f.relativeAngle / (HFOV_DEGREES / 2)) * (canvasCenterX * 0.9);
    const yRatio = Math.max(0, Math.min(1, 1 - (f.dist / MAX_AR_DISTANCE)));
    const screenY = canvasBottomY - (yRatio * (canvasBottomY - projectionMaxY));
    const iconRadius = 8 + (6 * yRatio);

    ctx.fillStyle = 'rgba(0, 123, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(screenX, screenY, iconRadius, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = 'white';
    ctx.font = `bold ${10 + (4 * yRatio)}px Arial`;
    ctx.textAlign = 'center';
    ctx.shadowColor = "black";
    ctx.shadowBlur = 3;
    ctx.fillText(`${Math.round(f.dist)}m`, screenX, screenY + iconRadius + 12 + (2 * yRatio));
    ctx.shadowBlur = 0;
  });

  if (arFountains.length > 0) {
    const nearestVisible = arFountains[0];
    arInfo.textContent = `${Math.round(nearestVisible.dist)}m to ${nearestVisible.name}.`;
  } else {
    const allLoadedFountains = (window
