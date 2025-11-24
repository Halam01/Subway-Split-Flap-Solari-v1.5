const fs = require('fs');
const path = require('path');
const express = require('express');
const fetch = require('node-fetch');
const app = express();

const jsonFilePath = 'output.json';

// Configuration and state
let Choose_A_Station = process.env.SOLARI_STATION || 'A44';
const TRANSITER_HOST = process.env.TRANSITER_HOST || 'transiter';
const TRANSITER_PORT = process.env.TRANSITER_PORT || '8080';
const BASE_URL = `http://${TRANSITER_HOST}:${TRANSITER_PORT}`;

// In-memory store of latest results (array)
let jsonData = [];

async function get_stop_times(station) {
    try {
        const stop_times_url = `${BASE_URL}/systems/us-ny-subway/stops/${station}`;
        const resp = await fetch(stop_times_url, { timeout: 10000 });
        const stop_times_data = await resp.json();

        const result = [];
        const nowSeconds = Date.now() / 1000;

        if (!stop_times_data || !stop_times_data.stopTimes) return result;

        for (const stop_time of stop_times_data.stopTimes) {
            if (stop_time.departure && typeof stop_time.departure.time !== 'undefined') {
                const route_id = stop_time.trip && stop_time.trip.route ? stop_time.trip.route.id : '';
                const last_stop_name = stop_time.trip && stop_time.trip.destination ? stop_time.trip.destination.name : '';
                const stop_id = stop_times_data.name || station;
                const departureTs = Number(stop_time.departure.time);
                const seconds_to_leave = departureTs - nowSeconds;
                const arrival_time = Math.floor(seconds_to_leave / 60);

                if (arrival_time > 0) {
                    result.push({
                        route_id,
                        arrival_time,
                        current_stop: stop_id,
                        last_stop_name
                    });
                } else if (arrival_time === 0) {
                    result.push({
                        route_id,
                        arrival_time: '0',
                        current_stop: stop_id,
                        last_stop_name
                    });
                }
            }
        }

        return result;
    } catch (err) {
        console.error('get_stop_times error', err && err.message);
        return [];
    }
}

async function get_transfer_stations(station) {
    try {
        const transfers_url = `${BASE_URL}/systems/us-ny-subway/transfers`;
        const resp = await fetch(transfers_url, { timeout: 10000 });
        const transfers_data = await resp.json();
        const transfer_stations = [];
        if (!transfers_data || !transfers_data.transfers) return transfer_stations;
        for (const transfer of transfers_data.transfers) {
            if (transfer.fromStop && transfer.fromStop.id === station && transfer.toStop) {
                transfer_stations.push(transfer.toStop.id);
            }
        }
        return transfer_stations;
    } catch (err) {
        console.error('get_transfer_stations error', err && err.message);
        return [];
    }
}

function contains_delay(value) {
    if (!value) return false;
    return value.toUpperCase().includes('MAINTENANCE');
}

async function get_service_status() {
    try {
        const routes_url = `${BASE_URL}/systems/us-ny-subway/routes`;
        const resp = await fetch(routes_url, { timeout: 10000 });
        const routes_data = await resp.json();

        const results = {};
        for (const route of (routes_data.routes || [])) {
            const route_id = route.id;
            results[route_id] = { status: '' };
            const alerts = route.alerts || [];
            if (!alerts || alerts.length === 0) {
                results[route_id].status = 'Good Service';
            } else {
                let delay_found = false;
                for (const alert of alerts) {
                    const cause = alert.cause || '';
                    const effect = alert.effect || '';
                    if (contains_delay(cause) || contains_delay(effect)) {
                        results[route_id].status = 'SERVICE CHANGE';
                        delay_found = true;
                        break;
                    }
                }
                if (!delay_found) results[route_id].status = 'DELAYS';
            }
        }
        return results;
    } catch (err) {
        console.error('get_service_status error', err && err.message);
        return {};
    }
}

async function fetchAndWrite() {
    try {
        const station = Choose_A_Station;
        let result = await get_stop_times(station);

        const transfer_stations = await get_transfer_stations(station);
        for (const t of transfer_stations) {
            const transfer_results = await get_stop_times(t);
            result = result.concat(transfer_results);
        }

        const service_status = await get_service_status();

        const combined_results = [];
        for (const stop of result) {
            const route_id = stop.route_id;
            combined_results.push({
                route_id,
                arrival_time: stop.arrival_time,
                current_stop: stop.current_stop,
                last_stop_name: stop.last_stop_name,
                service_status: (service_status[route_id] || {}).status || 'Unknown'
            });
        }

        combined_results.sort((a, b) => {
            const aa = typeof a.arrival_time === 'number' ? a.arrival_time : Number.POSITIVE_INFINITY;
            const bb = typeof b.arrival_time === 'number' ? b.arrival_time : Number.POSITIVE_INFINITY;
            return aa - bb;
        });

        // update in-memory and on-disk
        jsonData = combined_results;
        try {
            fs.writeFileSync(jsonFilePath, JSON.stringify(combined_results, null, 2));
        } catch (err) {
            console.error('Error writing output.json', err && err.message);
        }
    } catch (err) {
        console.error('fetchAndWrite error', err && err.message);
    }
}

// run once immediately, then schedule
fetchAndWrite();
setInterval(fetchAndWrite, 20000);

// API: get or set current station
app.get('/api/station', async (req, res) => {
    const s = req.query.station;
    if (s) {
        Choose_A_Station = String(s).toUpperCase();
        // immediately fetch for new station and wait for updated data
        try {
            await fetchAndWrite();
            return res.json({ ok: true, station: Choose_A_Station });
        } catch (err) {
            console.error('Error fetching data after station change', err && err.message);
            return res.status(500).json({ ok: false, error: 'fetch failed', station: Choose_A_Station });
        }
    }
    res.json({ station: Choose_A_Station });
});

app.use('/api/arrivals', (req, res) => {
    const r = { data: [] };
    for (let i = 0; i < Math.min(45, jsonData.length); i++) {
        const entry = jsonData[i];
        const data = {
            line: entry.route_id,
            stop: entry.current_stop,
            terminal: entry.last_stop_name,
            scheduled: entry.arrival_time,
            remarks: entry.service_status
        };
        data.status = (entry.service_status === 'SERVICE CHANGE' || entry.service_status === 'DELAYS') ? 'B' : 'A';
        r.data.push(data);
    }
    res.json(r);
});

// serve static UI
app.use('/', express.static('public'));

// Serve the stations.csv from project root so the UI can fetch it
app.get('/stations.csv', (req, res) => {
    const csvPath = path.join(__dirname, 'stations.csv');
    if (fs.existsSync(csvPath)) {
        res.sendFile(csvPath);
    } else {
        res.status(404).send('stations.csv not found');
    }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log('split flap started on port ' + port));