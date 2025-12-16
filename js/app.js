(function () {
    // ... (rest of unchanged code above)

    // --- REPLACE THE OLD geocodeBarangayHall FUNCTION WITH THIS ---
    async function geocodeBarangayLocation(provinceName, muniName, brgyName) {
        // Query the barangay directly in OSM Nominatim, without 'Barangay Hall'
        const q = `${brgyName}, ${muniName}, ${provinceName}, Philippines`;
        console.log('Geocoding query:', q); // debug
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
        try {
            const data = await fetchJson(url);
            if (!Array.isArray(data) || data.length === 0) return null;
            const it = data[0];
            const lat = Number(it.lat);
            const lng = Number(it.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            return { lat, lng };
        } catch {
            return null;
        }
    }

    // ... (rest of unchanged code)

    // Replace calls inside submitReport
    // From:
    // const geo = await geocodeBarangayHall(provinceName, muniName, brgyName);
    // To:
    // const geo = await geocodeBarangayLocation(provinceName, muniName, brgyName);
    // ...and update error message accordingly
    // if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) {
    //     showToast('error', 'Location failed', 'Could not locate the selected barangay on the map.');
    //     return;
    // }

    // ... (rest of unchanged code below)
})();