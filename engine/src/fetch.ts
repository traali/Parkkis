import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import * as turf from '@turf/turf';
import pLimit from 'p-limit';

const limit = pLimit(5);

const SOURCES = {
    PARKKIHUBI: 'https://pubapi.parkkiopas.fi/public/v1/parking_area/',
    FINTRAFFIC: 'https://liippapi.fintraffic.fi/v1/parking-facilities',
    SERVICEMAP: 'https://api.hel.fi/servicemap/v2/administrative_division/',
    WFS_SLOTS: 'https://kartta.hel.fi/ws/geoserver/avoindata/wfs?service=WFS&version=2.0.0&request=GetFeature&typeName=avoindata:Pysakointipaikat_alue&outputFormat=application/json',
    WFS_FINES: 'https://kartta.hel.fi/ws/geoserver/avoindata/wfs?service=WFS&version=2.0.0&request=GetFeature&typeName=avoindata:Pysakointivirheet&outputFormat=application/json'
};

const HEADERS = {
    'User-Agent': 'Parkkis/2.0 (Spatial Intelligence Dashboard; arto.oinonen@gmail.com)',
    'Accept': 'application/json'
};

export class HelsinkiClient {
    async fetchWithRetry(url: string, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                return await axios.get(url, { headers: HEADERS, timeout: 60000 });
            } catch (err: any) {
                if (i === retries - 1) throw err;
                console.warn(`[RETRY ${i+1}] Failed to fetch ${url}: ${err.message}`);
                await new Promise(res => setTimeout(res, 2000 * (i + 1)));
            }
        }
    }

    async fetchWFS(baseUrl: string, label: string) {
        console.log(`[WFS] Starting chunked fetch for ${label}...`);
        const pageSize = 5000;
        let startIndex = 0;
        const allFeatures: any[] = [];
        let hasMore = true;

        while (hasMore) {
            const url = `${baseUrl}&count=${pageSize}&startIndex=${startIndex}`;
            const response = await this.fetchWithRetry(url);
            const features = response?.data?.features || [];
            allFeatures.push(...features);
            
            console.log(`[WFS] ${label}: Received ${features.length} features (Total: ${allFeatures.length})`);
            
            if (features.length < pageSize) {
                hasMore = false;
            } else {
                startIndex += pageSize;
            }
        }
        return turf.featureCollection(allFeatures);
    }

    async fetchParkkihubi() {
        console.log('[HUBI] Fetching real-time areas...');
        let url: string | null = SOURCES.PARKKIHUBI;
        const allFeatures: any[] = [];

        while (url) {
            const response = await this.fetchWithRetry(url);
            allFeatures.push(...(response?.data?.features || []));
            url = response?.data?.next;
            if (url) console.log(`[HUBI] Next page: ${url}`);
        }
        return turf.featureCollection(allFeatures);
    }

    async fetchServicemap() {
        console.log('[MAP] Fetching administrative metadata...');
        const url = `${SOURCES.SERVICEMAP}?type=parking_area&page_size=1000&geometry=true&municipality=helsinki`;
        const response = await this.fetchWithRetry(url);
        return response?.data;
    }
}

async function main() {
    const client = new HelsinkiClient();
    const CACHE_DIR = path.join(process.cwd(), '.cache');
    await fs.ensureDir(CACHE_DIR);

    try {
        console.log('🚀 Starting Unified Data Harvest...');
        
        const [slots, fines, hubi] = await Promise.all([
            client.fetchWFS(SOURCES.WFS_SLOTS, 'Slots'),
            client.fetchWFS(SOURCES.WFS_FINES, 'Violations'),
            client.fetchParkkihubi()
        ]);

        console.log('[WRITE] Saving raw GeoJSON to cache...');
        await fs.writeJson(path.join(CACHE_DIR, 'slots.json'), slots);
        await fs.writeJson(path.join(CACHE_DIR, 'violations.json'), fines);
        await fs.writeJson(path.join(CACHE_DIR, 'hubi.json'), hubi);

        console.log('✅ Harvest Complete. Ready for Parquet conversion.');
    } catch (e) {
        console.error('❌ Harvest Failed:', e);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
