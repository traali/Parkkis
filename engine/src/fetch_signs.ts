import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import * as turf from '@turf/turf';
import pLimit from 'p-limit';

const limit = pLimit(5);

const SOURCES = {
    DIGI_WFS: 'https://avoinapi.vaylapilvi.fi/vaylatiedot/digiroad/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=dr_liikennemerkit&outputFormat=application/json&srsName=EPSG:4326'
};

const HEADERS = {
    'User-Agent': 'Parkkis/2.1 (Temporal Intelligence Engine; arto.oinonen@gmail.com)',
    'Accept': 'application/json'
};

export class DigiroadClient {
    async fetchWithRetry(url: string, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                return await axios.get(url, { headers: HEADERS, timeout: 120000 });
            } catch (err: any) {
                if (i === retries - 1) throw err;
                console.warn(`[RETRY ${i+1}] Failed to fetch: ${err.message}`);
                await new Promise(res => setTimeout(res, 5000 * (i + 1)));
            }
        }
    }

    async fetchHelsinkiSigns() {
        console.log(`[SIGNS] Starting fetch for Helsinki parking signs...`);
        // Expanded list based on parking regulations
        const signTypes = [
            'C37', 'C38', 'C39', 'C40', 'C44.1', 'C44.2', 
            'E2', 'E3.1', 'E3.2', 'E3.3', 'E3.4', 'E3.5', 
            'E4.1', 'E4.2', 'E4.3', 
            'E24', 'E26', 'E28'
        ];
        const cql = `kuntakoodi=91 AND tyyppi IN (${signTypes.map(t => `'${t}'`).join(',')})`;
        const pageSize = 5000;
        let startIndex = 0;
        const allFeatures: any[] = [];
        let hasMore = true;

        while (hasMore) {
            const url = `${SOURCES.DIGI_WFS}&count=${pageSize}&startIndex=${startIndex}&cql_filter=${encodeURIComponent(cql)}`;
            const response = await this.fetchWithRetry(url);
            const features = response?.data?.features || [];
            allFeatures.push(...features);
            
            console.log(`[SIGNS] Received ${features.length} features (Total: ${allFeatures.length})`);
            
            if (features.length < pageSize) {
                hasMore = false;
            } else {
                startIndex += pageSize;
            }
        }
        return turf.featureCollection(allFeatures);
    }
}

async function main() {
    const client = new DigiroadClient();
    const CACHE_DIR = path.join(process.cwd(), '.cache');
    await fs.ensureDir(CACHE_DIR);

    try {
        console.log('🚀 Starting Digiroad Traffic Sign Harvest...');
        const signs = await client.fetchHelsinkiSigns();

        console.log('[WRITE] Saving signs.json to cache...');
        await fs.writeJson(path.join(CACHE_DIR, 'signs.json'), signs);

        console.log('✅ Sign Harvest Complete.');
    } catch (e) {
        console.error('❌ Sign Harvest Failed:', e);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
