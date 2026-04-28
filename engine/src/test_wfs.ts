import axios from 'axios';

async function testWFS() {
    // Helsinki kuntakoodi is 91. 
    // Filter tyyppi like C38% to get C38
    const cql = `kuntakoodi=91 AND tyyppi IN ('C37', 'C38', 'C39', 'E2')`;
    const url = `https://avoinapi.vaylapilvi.fi/vaylatiedot/digiroad/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=dr_liikennemerkit&outputFormat=application/json&srsName=EPSG:4326&count=5&cql_filter=${encodeURIComponent(cql)}`;
    
    try {
        console.log(`Fetching from: ${url}`);
        const response = await axios.get(url);
        console.log(`Got ${response.data.features.length} features.`);
        if (response.data.features.length > 0) {
            console.log(JSON.stringify(response.data.features[0].properties, null, 2));
            console.log("Geometry:", JSON.stringify(response.data.features[0].geometry));
        }
    } catch (err: any) {
        console.error('Error:', err.message);
        if (err.response) {
            console.error('Response data:', err.response.data);
        }
    }
}

testWFS();
