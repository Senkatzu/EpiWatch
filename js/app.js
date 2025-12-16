(function () {
    const SUPABASE_URL = 'https://sxfcohtvewuadrvnmeka.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZmNvaHR2ZXd1YWRydm5tZWthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU2OTMyMDUsImV4cCI6MjA4MTI2OTIwNX0.5bDoDWt8Yt58B78WcKvLLyzEMJzain68K1Rk77L9QgM';

    const PSGC_BASE_URL = 'https://psgc.cloud/api';

    let supabaseClient = null;
    let supabaseChannel = null;

    let reportList = [];
    let map = null;
    let mapLayers = [];
    let mapMarkersByReportId = {};
    let trendChart = null;

    let currentUserRole = null;
    let currentUsername = null;
    let currentPasswordMasked = '';

    let submitInFlight = false;
    let pendingFocusReportId = null;
    let focusLatestOnNextMapOpen = false;

    const LEGACY_LOCATION_COORDS = {};

    function qs(id) {
        return document.getElementById(id);
    }

    function safeText(value) {
        return String(value == null ? '' : value);
    }

    function setDateInputToToday(id) {
        const el = qs(id);
        if (!el) return;
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        el.value = `${yyyy}-${mm}-${dd}`;
    }

    function ensureToastContainer() {
        let el = qs('toast-container');
        if (!el) {
            el = document.createElement('div');
            el.id = 'toast-container';
            el.className = 'toast-container';
            document.body.appendChild(el);
        }
        return el;
    }

    function toastIcon(type) {
        if (type === 'success') return '✓';
        if (type === 'error') return '!';
        if (type === 'warning') return '⚠';
        return 'i';
    }

    function showToast(type, title, msg) {
        const container = ensureToastContainer();
        const toast = document.createElement('div');
        toast.className = `toast ${type || ''}`;

        const icon = document.createElement('div');
        icon.className = 'toast-icon';
        icon.textContent = toastIcon(type);

        const body = document.createElement('div');
        body.className = 'toast-body';

        const t = document.createElement('div');
        t.className = 'toast-title';
        t.textContent = safeText(title || '');

        const m = document.createElement('div');
        m.className = 'toast-msg';
        m.textContent = safeText(msg || '');

        body.appendChild(t);
        body.appendChild(m);

        toast.appendChild(icon);
        toast.appendChild(body);

        container.appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        const remove = () => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
            }, 220);
        };

        setTimeout(remove, 3200);
        toast.addEventListener('click', remove);
    }

    function closeModal() {
        const root = qs('modal-root');
        if (!root) return;
        root.innerHTML = '';
    }

    function showModal(title, bodyNode, actions) {
        const root = qs('modal-root');
        if (!root) return;
        root.innerHTML = '';

        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';

        const modal = document.createElement('div');
        modal.className = 'modal';

        const header = document.createElement('div');
        header.className = 'modal-header';

        const h = document.createElement('div');
        h.className = 'modal-title';
        h.textContent = safeText(title || '');

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'btn-secondary';
        closeBtn.textContent = 'Close';
        closeBtn.addEventListener('click', closeModal);

        header.appendChild(h);
        header.appendChild(closeBtn);

        const body = document.createElement('div');
        body.className = 'modal-body';
        if (bodyNode) body.appendChild(bodyNode);

        const footer = document.createElement('div');
        footer.className = 'modal-actions';

        (actions || []).forEach(a => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = a.className || 'btn-primary';
            b.textContent = safeText(a.text || 'OK');
            b.addEventListener('click', () => {
                if (a.onClick) a.onClick();
            });
            footer.appendChild(b);
        });

        modal.appendChild(header);
        modal.appendChild(body);
        if ((actions || []).length > 0) modal.appendChild(footer);

        backdrop.appendChild(modal);
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closeModal();
        });

        root.appendChild(backdrop);
    }

    function showConfirm(title, msg, okText, cancelText, danger) {
        return new Promise(resolve => {
            const body = document.createElement('div');
            body.style.display = 'flex';
            body.style.flexDirection = 'column';
            body.style.gap = '10px';

            const p = document.createElement('div');
            p.textContent = safeText(msg);
            body.appendChild(p);

            const onOk = () => {
                closeModal();
                resolve(true);
            };

            const onCancel = () => {
                closeModal();
                resolve(false);
            };

            showModal(title, body, [
                { text: safeText(cancelText || 'Cancel'), className: 'btn-secondary', onClick: onCancel },
                { text: safeText(okText || 'OK'), className: danger ? 'btn-primary' : 'btn-primary', onClick: onOk }
            ]);
        });
    }

    function loadLocalReports() {
        try {
            const raw = localStorage.getItem('epiReports_v4');
            if (!raw) return [];
            const data = JSON.parse(raw);
            return Array.isArray(data) ? data : [];
        } catch {
            return [];
        }
    }

    function saveLocalReports() {
        localStorage.setItem('epiReports_v4', JSON.stringify(reportList));
    }

    function getSelectedOptionText(selectId) {
        const el = qs(selectId);
        if (!el) return '';
        const opt = el.options[el.selectedIndex];
        return opt ? safeText(opt.textContent || opt.innerText || opt.value) : '';
    }

    function clearAndDisableSelect(el, placeholder) {
        if (!el) return;
        el.innerHTML = '';
        const o = document.createElement('option');
        o.value = '';
        o.textContent = safeText(placeholder || 'Select');
        el.appendChild(o);
        el.value = '';
        el.disabled = true;
    }

    async function fetchJson(url) {
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    }

    async function initAddressSelectors() {
        const provinceEl = qs('r-province');
        const muniEl = qs('r-muni');
        const brgyEl = qs('r-brgy');

        if (!provinceEl || !muniEl || !brgyEl) return;

        clearAndDisableSelect(muniEl, 'Select Municipality / City');
        clearAndDisableSelect(brgyEl, 'Select Barangay');

        provinceEl.innerHTML = '<option value="">Select Province</option>';

        try {
            const provinces = await fetchJson(`${PSGC_BASE_URL}/provinces/`);
            provinces
                .slice()
                .sort((a, b) => safeText(a.name).localeCompare(safeText(b.name)))
                .forEach(p => {
                    const o = document.createElement('option');
                    o.value = safeText(p.code || p.id || '');
                    o.textContent = safeText(p.name || '');
                    provinceEl.appendChild(o);
                });
        } catch (e) {
            showToast('warning', 'PSGC unavailable', 'Province list failed to load.');
        }

        provinceEl.addEventListener('change', async () => {
            clearAndDisableSelect(muniEl, 'Select Municipality / City');
            clearAndDisableSelect(brgyEl, 'Select Barangay');

            const code = provinceEl.value;
            if (!code) return;

            try {
                const items = await fetchJson(`${PSGC_BASE_URL}/provinces/${encodeURIComponent(code)}/cities-municipalities/`);
                muniEl.disabled = false;
                muniEl.innerHTML = '<option value="">Select Municipality / City</option>';
                items
                    .slice()
                    .sort((a, b) => safeText(a.name).localeCompare(safeText(b.name)))
                    .forEach(m => {
                        const o = document.createElement('option');
                        o.value = safeText(m.code || m.id || '');
                        o.textContent = safeText(m.name || '');
                        muniEl.appendChild(o);
                    });
            } catch (e) {
                showToast('warning', 'PSGC unavailable', 'Municipality list failed to load.');
            }
        });

        muniEl.addEventListener('change', async () => {
            clearAndDisableSelect(brgyEl, 'Select Barangay');
            const code = muniEl.value;
            if (!code) return;

            try {
                const items = await fetchJson(`${PSGC_BASE_URL}/cities-municipalities/${encodeURIComponent(code)}/barangays/`);
                brgyEl.disabled = false;
                brgyEl.innerHTML = '<option value="">Select Barangay</option>';
                items
                    .slice()
                    .sort((a, b) => safeText(a.name).localeCompare(safeText(b.name)))
                    .forEach(b => {
                        const o = document.createElement('option');
                        o.value = safeText(b.code || b.id || '');
                        o.textContent = safeText(b.name || '');
                        brgyEl.appendChild(o);
                    });
            } catch (e) {
                showToast('warning', 'PSGC unavailable', 'Barangay list failed to load.');
            }
        });
    }

    async function geocodeBarangayHall(provinceName, muniName, brgyName) {
    // Remove 'Barangay Hall,' so we only search the barangay.
    const q = `${brgyName}, ${muniName}, ${provinceName}, Philippines`;
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

    function mulberry32(a) {
        return function () {
            let t = (a += 0x6D2B79F5);
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function jitterLatLngWithinMeters(lat, lng, meters, seed) {
        const rand = mulberry32(Number(seed) || Date.now());
        const radius = meters;
        const u = rand();
        const v = rand();
        const w = radius * Math.sqrt(u);
        const t = 2 * Math.PI * v;
        const dx = w * Math.cos(t);
        const dy = w * Math.sin(t);

        const latRad = (lat * Math.PI) / 180;
        const metersPerDegLat = 111320;
        const metersPerDegLng = 111320 * Math.cos(latRad);

        const dLat = dy / metersPerDegLat;
        const dLng = dx / metersPerDegLng;

        return [lat + dLat, lng + dLng];
    }

    function initMap() {
        if (map) return;
        map = L.map('map-container').setView([12.8797, 121.7740], 6);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    }

    function clearMapLayers() {
        if (!map) return;
        mapLayers.forEach(l => {
            try { map.removeLayer(l); } catch { }
        });
        mapLayers = [];
        mapMarkersByReportId = {};
    }

    function updateMapMarkers() {
        if (!map) return;
        clearMapLayers();

        reportList.forEach(report => {
            const baseLat = typeof report.lat === 'number' ? report.lat : (report.lat ? Number(report.lat) : null);
            const baseLng = typeof report.lng === 'number' ? report.lng : (report.lng ? Number(report.lng) : null);
            let lat = baseLat;
            let lng = baseLng;

            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                const legacy = LEGACY_LOCATION_COORDS[report.loc];
                if (!legacy) return;
                lat = legacy[0];
                lng = legacy[1];
            }

            const jittered = jitterLatLngWithinMeters(lat, lng, 1000, report.id);
            lat = jittered[0];
            lng = jittered[1];

            let color = 'green';
            if (report.status === 'Critical') color = 'red';
            else if (report.status === 'Stable') color = 'orange';

            const halo = L.circle([lat, lng], {
                color,
                fillColor: color,
                fillOpacity: 0.12,
                radius: 500,
                weight: 1,
                opacity: 0.55
            }).addTo(map);

            const dot = L.circleMarker([lat, lng], {
                radius: 7,
                color: '#ffffff',
                weight: 2,
                fillColor: color,
                fillOpacity: 1
            }).addTo(map);

            const locText = report.province && report.municipality && report.barangay
                ? `${report.province} - ${report.municipality} - ${report.barangay}`
                : (report.loc || 'Unknown');

            dot.bindPopup(`<b>${safeText(report.name)}</b><br>Diagnosis: ${safeText(report.diag || '')}<br>Status: ${safeText(report.status)}<br>Loc: ${safeText(locText)}`);

            mapLayers.push(halo);
            mapLayers.push(dot);
            mapMarkersByReportId[report.id] = dot;
        });
    }

    function focusReportOnMap(reportId) {
        if (!map || !reportId) return false;
        const layer = mapMarkersByReportId[reportId];
        if (!layer || !layer.getLatLng) return false;
        const latlng = layer.getLatLng();
        if (!latlng) return false;
        const targetZoom = Math.max(map.getZoom(), 13);
        map.setView(latlng, targetZoom, { animate: true });
        if (layer.openPopup) layer.openPopup();
        return true;
    }

    function refreshUI() {
        renderTable();
        updateDashboard();
        if (map) {
            updateMapMarkers();

            if (focusLatestOnNextMapOpen && pendingFocusReportId) {
                const focused = focusReportOnMap(pendingFocusReportId);
                if (focused) {
                    focusLatestOnNextMapOpen = false;
                    pendingFocusReportId = null;
                }
            }
        }
        updateProfileUI();
    }

    function updateDashboard() {
        const activeCases = reportList.filter(r => r && r.status !== 'Recovered').length;
        const dispActive = qs('disp-active');
        const dispTotal = qs('disp-total');
        if (dispActive) dispActive.textContent = String(activeCases);
        if (dispTotal) dispTotal.textContent = String(reportList.length);

        const criticalReports = reportList.filter(r => r && r.status === 'Critical');
        const criticalLocs = Array.from(new Set(criticalReports.map(r => r.loc || (r.barangay || 'Unknown'))));
        const zoneListEl = qs('zone-list');

        if (zoneListEl) {
            if (criticalLocs.length > 0) {
                zoneListEl.textContent = criticalLocs.join(', ');
                zoneListEl.style.color = '#b91c1c';
            } else {
                zoneListEl.textContent = 'No Critical Zones';
                zoneListEl.style.color = '#166534';
            }
        }

        updateChart();
    }

    function renderTable() {
        const tbody = qs('report-table-body');
        if (!tbody) return;

        tbody.innerHTML = '';

        reportList.forEach(item => {
            if (!item) return;
            const tr = document.createElement('tr');

            const tdDate = document.createElement('td');
            tdDate.textContent = safeText(item.date);

            const tdName = document.createElement('td');
            tdName.textContent = safeText(item.name);

            const tdLoc = document.createElement('td');
            tdLoc.textContent = safeText(item.loc);

            const tdStatus = document.createElement('td');
            const badge = document.createElement('span');
            const badgeClass = item.status === 'Critical' ? 'critical' : (item.status === 'Stable' ? 'stable' : 'recovered');
            badge.className = `badge ${badgeClass}`;
            badge.textContent = safeText(item.status);
            tdStatus.appendChild(badge);

            const tdAction = document.createElement('td');
            if (currentUserRole === 'admin') {
                const editBtn = document.createElement('button');
                editBtn.className = 'btn-edit';
                editBtn.textContent = 'Edit';
                editBtn.addEventListener('click', () => openEditReport(item.id));

                const delBtn = document.createElement('button');
                delBtn.className = 'btn-delete';
                delBtn.style.marginLeft = '6px';
                delBtn.textContent = 'Delete';
                delBtn.addEventListener('click', () => deleteReport(item.id));

                tdAction.appendChild(editBtn);
                tdAction.appendChild(delBtn);
            } else {
                tdAction.textContent = '—';
            }

            tr.appendChild(tdDate);
            tr.appendChild(tdName);
            tr.appendChild(tdLoc);
            tr.appendChild(tdStatus);
            tr.appendChild(tdAction);

            tbody.appendChild(tr);
        });
    }

    function updateChart() {
        const ctx = qs('trendChart');
        if (!ctx || !window.Chart) return;

        const critical = reportList.filter(r => r && r.status === 'Critical').length;
        const stable = reportList.filter(r => r && r.status === 'Stable').length;
        const recovered = reportList.filter(r => r && r.status === 'Recovered').length;
        const dataValues = [critical, stable, recovered];

        const whiteBackground = {
            id: 'customCanvasBackgroundColor',
            beforeDraw: (chart) => {
                const c = chart.canvas.getContext('2d');
                c.save();
                c.fillStyle = 'white';
                c.fillRect(0, 0, chart.width, chart.height);
                c.restore();
            }
        };

        const dataLabelPlugin = {
            id: 'dataLabels',
            afterDatasetsDraw: (chart) => {
                const { ctx: c } = chart;
                chart.data.datasets.forEach((dataset, i) => {
                    const meta = chart.getDatasetMeta(i);
                    meta.data.forEach((bar, index) => {
                        const value = dataset.data[index];
                        if (value > 0) {
                            c.fillStyle = '#475569';
                            c.font = 'bold 14px Segoe UI';
                            c.textAlign = 'center';
                            c.fillText(String(value), bar.x, bar.y - 10);
                        }
                    });
                });
            }
        };

        if (trendChart) {
            trendChart.data.datasets[0].data = dataValues;
            trendChart.update();
            return;
        }

        trendChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Critical', 'Stable', 'Recovered'],
                datasets: [{
                    label: 'Patient Status',
                    data: dataValues,
                    backgroundColor: ['#ef4444', '#f97316', '#10b981'],
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 20 } },
                scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
                plugins: { legend: { display: false } }
            },
            plugins: [whiteBackground, dataLabelPlugin]
        });
    }

    function downloadChartImage() {
        const canvas = qs('trendChart');
        if (!canvas) return;
        const link = document.createElement('a');
        link.download = 'Monthly_Trend_Chart.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    }

    function downloadCSV() {
        if (reportList.length === 0) {
            showToast('warning', 'No data', 'No data to export.');
            return;
        }

        let csv = 'Date,Name,Location,Diagnosis,Status\n';
        reportList.forEach(r => {
            if (!r) return;
            const row = [r.date, r.name, r.loc, r.diag, r.status]
                .map(v => `"${safeText(v).replace(/"/g, '""')}"`)
                .join(',');
            csv += row + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'EpiWatch_Data_Report.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    async function openEditReport(id) {
        const report = reportList.find(r => r && r.id === id);
        if (!report) return;

        if (currentUserRole !== 'admin') {
            showToast('warning', 'View only', 'This account is view-only and cannot edit records.');
            return;
        }

        const form = document.createElement('div');
        form.style.display = 'flex';
        form.style.flexDirection = 'column';
        form.style.gap = '12px';

        const mkGroup = (label, inputEl) => {
            const wrap = document.createElement('div');
            wrap.className = 'form-group';

            const l = document.createElement('label');
            l.className = 'form-label';
            l.textContent = label;

            wrap.appendChild(l);
            wrap.appendChild(inputEl);
            return wrap;
        };

        const dateEl = document.createElement('input');
        dateEl.className = 'form-input';
        dateEl.type = 'date';
        dateEl.value = safeText(report.date);

        const nameEl = document.createElement('input');
        nameEl.className = 'form-input';
        nameEl.type = 'text';
        nameEl.value = safeText(report.name);

        const diagEl = document.createElement('select');
        diagEl.className = 'form-select';
        ['Dengue', 'Cholera', 'Typhoid', 'Influenza', 'COVID-19'].forEach(v => {
            const o = document.createElement('option');
            o.value = v;
            o.textContent = v;
            diagEl.appendChild(o);
        });
        diagEl.value = safeText(report.diag);

        const statusEl = document.createElement('select');
        statusEl.className = 'form-select';
        ['Critical', 'Stable', 'Recovered'].forEach(v => {
            const o = document.createElement('option');
            o.value = v;
            o.textContent = v;
            statusEl.appendChild(o);
        });
        statusEl.value = safeText(report.status || 'Stable');

        form.appendChild(mkGroup('Date', dateEl));
        form.appendChild(mkGroup('Patient Name', nameEl));
        form.appendChild(mkGroup('Diagnosis', diagEl));
        form.appendChild(mkGroup('Status', statusEl));

        const save = async () => {
            const next = { ...report };
            next.date = safeText(dateEl.value || '').trim();
            next.name = safeText(nameEl.value || '').trim();
            next.diag = safeText(diagEl.value);
            next.status = safeText(statusEl.value);

            const idx = reportList.findIndex(r => r && r.id === id);
            if (idx >= 0) reportList[idx] = next;
            saveLocalReports();
            refreshUI();

            if (supabaseClient) {
                const { error } = await supabaseClient
                    .from('reports')
                    .update({
                        date: next.date,
                        name: next.name,
                        loc: next.loc,
                        province: next.province || null,
                        municipality: next.municipality || null,
                        barangay: next.barangay || null,
                        lat: next.lat || null,
                        lng: next.lng || null,
                        diag: next.diag,
                        status: next.status
                    })
                    .eq('id', id);

                if (error) {
                    showToast('error', 'Sync failed', 'Update saved locally but failed to sync.');
                }
            }

            showToast('success', 'Updated', 'Record updated successfully.');
            closeModal();
        };

        showModal('Edit Record', form, [
            { text: 'Cancel', className: 'btn-secondary', onClick: closeModal },
            { text: 'Save Changes', className: 'btn-primary', onClick: save }
        ]);
    }

    async function deleteReport(id) {
        const report = reportList.find(r => r && r.id === id);
        if (!report) return;

        if (currentUserRole !== 'admin') {
            showToast('warning', 'View only', 'This account is view-only and cannot delete records.');
            return;
        }

        const ok = await showConfirm('Delete record', `Delete record for ${safeText(report.name || 'this patient')}?`, 'Delete', 'Cancel', true);
        if (!ok) return;

        reportList = reportList.filter(r => r && r.id !== id);
        saveLocalReports();
        refreshUI();

        if (supabaseClient) {
            const { error } = await supabaseClient
                .from('reports')
                .delete()
                .eq('id', id);

            if (error) {
                showToast('error', 'Sync failed', 'Delete applied locally but failed to sync.');
            }
        }

        showToast('success', 'Deleted', 'Record deleted successfully.');
    }

    async function loadReportsFromSupabase() {
        if (!supabaseClient) return;
        const { data, error } = await supabaseClient
            .from('reports')
            .select('*')
            .order('id', { ascending: false });

        if (error) {
            showToast('warning', 'Supabase', 'Could not load from Supabase. Using local data.');
            return;
        }

        if (!Array.isArray(data)) return;
        reportList = data.map(r => ({
            id: Number(r.id),
            date: r.date,
            name: r.name,
            loc: r.loc,
            province: r.province,
            municipality: r.municipality,
            barangay: r.barangay,
            lat: typeof r.lat === 'number' ? r.lat : (r.lat ? Number(r.lat) : null),
            lng: typeof r.lng === 'number' ? r.lng : (r.lng ? Number(r.lng) : null),
            diag: r.diag,
            status: r.status
        }));
        saveLocalReports();
        refreshUI();
    }

    function initSupabaseSync() {
        if (!window.supabase || !window.supabase.createClient) return;

        try {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        } catch {
            supabaseClient = null;
            return;
        }

        try {
            supabaseChannel = supabaseClient
                .channel('public:reports')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, async () => {
                    await loadReportsFromSupabase();
                })
                .subscribe();
        } catch {
            supabaseChannel = null;
        }
    }

    function updateProfileUI() {
        const u = qs('profile-username');
        const r = qs('profile-role');
        const p = qs('profile-password');
        if (u) u.textContent = safeText(currentUsername || '—');
        if (r) r.textContent = safeText(currentUserRole || '—');
        if (p) p.value = safeText(currentPasswordMasked || '');
    }

    function applyRolePermissions() {
        const form = qs('report-form');
        if (!form) return;

        if (currentUserRole !== 'admin') {
            Array.from(form.querySelectorAll('input, select, button')).forEach(el => {
                if (el && el.type !== 'button') el.disabled = true;
            });
            const btn = form.querySelector('button[type="submit"]');
            if (btn) btn.disabled = true;
        } else {
            Array.from(form.querySelectorAll('input, select')).forEach(el => {
                if (el && (el.id === 'r-muni' || el.id === 'r-brgy')) return;
                if (el) el.disabled = false;
            });
            const btn = form.querySelector('button[type="submit"]');
            if (btn) btn.disabled = false;
        }
    }

    function showPage(pageId, btn) {
        const pages = document.querySelectorAll('.page');
        pages.forEach(p => p.classList.remove('active'));

        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(n => {
            if (!n.classList.contains('logout')) n.classList.remove('active');
        });

        const target = qs(pageId);
        if (target) target.classList.add('active');

        if (btn) {
            btn.classList.add('active');
        } else {
            const byData = document.querySelector(`.nav-item[data-page="${pageId}"]`);
            if (byData) byData.classList.add('active');
        }

        const title = qs('page-title');
        if (title) {
            if (pageId === 'dashboard') title.textContent = 'Surveillance Dashboard';
            else if (pageId === 'map') title.textContent = 'Live Map';
            else if (pageId === 'reports') title.textContent = 'Submit Report';
            else if (pageId === 'informations') title.textContent = 'Case Information';
            else title.textContent = 'EpiWatch';
        }

        if (pageId === 'map') {
            setTimeout(() => {
                initMap();
                if (map) map.invalidateSize();
                updateMapMarkers();
            }, 60);
        }

        if (pageId === 'dashboard') {
            setTimeout(() => {
                if (trendChart && typeof trendChart.resize === 'function') {
                    trendChart.resize();
                }
            }, 60);
        }

        window.dispatchEvent(new CustomEvent('epiwatch:page', { detail: { pageId } }));
    }

    function setLoginError(msg) {
        const err = qs('login-error');
        if (!err) return;
        if (msg) {
            err.textContent = msg;
            err.style.display = 'block';
        } else {
            err.style.display = 'none';
        }
    }

    function handleLogin(e) {
        e.preventDefault();
        const u = safeText(qs('login-user')?.value || '').trim();
        const p = safeText(qs('login-pass')?.value || '').trim();

        const adminOk = (u === 'maui wowie' && p === 'honolulu123');
        const viewerOk = (u === 'viewer' && p === 'viewer123');

        if (!adminOk && !viewerOk) {
            setLoginError('Incorrect Username or Password');
            showToast('error', 'Login failed', 'Incorrect username or password.');
            return;
        }

        setLoginError('');

        currentUsername = u;
        currentUserRole = adminOk ? 'admin' : 'viewer';
        currentPasswordMasked = p;

        const login = qs('login-screen');
        const app = qs('app-container');
        if (login) login.style.display = 'none';
        if (app) app.style.display = 'flex';

        const display = qs('user-display');
        if (display) display.textContent = safeText(currentUsername);

        initApp();
    }

    async function handleLogout() {
        const ok = await showConfirm('Log out', 'Are you sure you want to log out?', 'Log out', 'Cancel', false);
        if (!ok) return;

        const app = qs('app-container');
        const login = qs('login-screen');
        if (app) app.style.display = 'none';
        if (login) login.style.display = 'flex';

        const userEl = qs('login-user');
        const passEl = qs('login-pass');
        if (userEl) userEl.value = '';
        if (passEl) passEl.value = '';

        currentUsername = null;
        currentUserRole = null;
        currentPasswordMasked = '';

        updateProfileUI();

        window.dispatchEvent(new CustomEvent('epiwatch:logout'));
    }

    async function submitReport(e) {
        e.preventDefault();

        if (currentUserRole !== 'admin') {
            showToast('warning', 'View only', 'This account is view-only and cannot add new entries.');
            return;
        }

        if (submitInFlight) return;
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const prevBtnText = submitBtn ? submitBtn.textContent : '';
        submitInFlight = true;

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Saving...';
        }

        try {
            const provinceCode = safeText(qs('r-province')?.value || '').trim();
            const muniCode = safeText(qs('r-muni')?.value || '').trim();
            const brgyCode = safeText(qs('r-brgy')?.value || '').trim();

            const provinceName = getSelectedOptionText('r-province');
            const muniName = getSelectedOptionText('r-muni');
            const brgyName = getSelectedOptionText('r-brgy');

            if (!provinceCode || !muniCode || !brgyCode) {
                showToast('warning', 'Missing location', 'Please select Province, Municipality/City, and Barangay.');
                return;
            }

            const nameVal = safeText(qs('r-name')?.value || '').trim();
            const dateVal = safeText(qs('r-date')?.value || '').trim();

            const now = Date.now();
            const dupe = reportList.find(r => {
                if (!r) return false;
                const sameName = safeText(r.name || '').trim().toLowerCase() === nameVal.toLowerCase();
                const sameDate = safeText(r.date || '').trim() === dateVal;
                const sameLoc = safeText(r.barangay || '').trim().toLowerCase() === safeText(brgyName || '').trim().toLowerCase();
                const recent = Number.isFinite(Number(r.id)) ? (now - Number(r.id) < 120000) : false;
                return sameName && sameDate && sameLoc && recent;
            });

            if (dupe) {
                showToast('warning', 'Duplicate blocked', 'This looks like a duplicate submission. Please wait.');
                return;
            }

            const geo = await geocodeBarangayHall(provinceName, muniName, brgyName);
            if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) {
                showToast('error', 'Location failed', 'Could not locate the selected barangay on the map.');
                return;
            }

            const newReport = {
                id: Date.now(),
                date: dateVal,
                name: nameVal,
                loc: `${provinceName} - ${muniName} - ${brgyName}`,
                province: provinceName,
                municipality: muniName,
                barangay: brgyName,
                lat: geo.lat,
                lng: geo.lng,
                diag: safeText(qs('r-diag')?.value || ''),
                status: safeText(qs('r-status')?.value || 'Stable')
            };

            reportList.unshift(newReport);
            pendingFocusReportId = newReport.id;
            focusLatestOnNextMapOpen = true;

            if (supabaseClient) {
                const { error } = await supabaseClient.from('reports').insert({
                    id: newReport.id,
                    date: newReport.date,
                    name: newReport.name,
                    loc: newReport.loc,
                    province: newReport.province,
                    municipality: newReport.municipality,
                    barangay: newReport.barangay,
                    lat: newReport.lat,
                    lng: newReport.lng,
                    diag: newReport.diag,
                    status: newReport.status
                });

                if (error) {
                    saveLocalReports();
                    refreshUI();
                    showToast('error', 'Sync failed', 'Record saved locally but failed to sync.');
                } else {
                    await loadReportsFromSupabase();
                }
            } else {
                saveLocalReports();
                refreshUI();
            }

            e.target.reset();
            setDateInputToToday('r-date');
            clearAndDisableSelect(qs('r-muni'), 'Select Municipality / City');
            clearAndDisableSelect(qs('r-brgy'), 'Select Barangay');
            showToast('success', 'Saved', 'Record saved successfully.');
        } catch (err) {
            showToast('error', 'Save failed', 'Something went wrong while saving. Please try again.');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = prevBtnText;
            }
            submitInFlight = false;
        }
    }

    function initApp() {
        reportList = loadLocalReports();

        initSupabaseSync();
        initAddressSelectors();

        setDateInputToToday('r-date');

        applyRolePermissions();

        setTimeout(async () => {
            initMap();
            if (supabaseClient) await loadReportsFromSupabase();
            refreshUI();
        }, 80);

        const passToggle = qs('profile-pass-toggle');
        const passInput = qs('profile-password');
        if (passToggle && passInput) {
            passToggle.addEventListener('click', () => {
                const isHidden = passInput.type === 'password';
                passInput.type = isHidden ? 'text' : 'password';
                passToggle.textContent = isHidden ? 'Hide' : 'Show';
            });
        }

        const profLogout = qs('profile-logout');
        if (profLogout) {
            profLogout.addEventListener('click', () => {
                handleLogout();
            });
        }

        updateProfileUI();
        showToast('success', 'Welcome', `Signed in as ${safeText(currentUsername)} (${safeText(currentUserRole)})`);
    }

    window.handleLogin = handleLogin;
    window.handleLogout = handleLogout;
    window.showPage = showPage;
    window.submitReport = submitReport;
    window.downloadChartImage = downloadChartImage;
    window.downloadCSV = downloadCSV;
    window.openEditReport = openEditReport;
    window.deleteReport = deleteReport;

    document.addEventListener('DOMContentLoaded', () => {
        ensureToastContainer();
        updateProfileUI();
    });
})();


