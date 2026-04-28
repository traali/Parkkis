import axios from 'axios';

async function testRoadworks() {
    const typeName = 'avoindata:Katutyot_alue';
    const url = `https://kartta.hel.fi/ws/geoserver/avoindata/wfs?service=WFS&version=2.0.0&request=GetFeature&typeName=${typeName}&outputFormat=application/json&srsName=EPSG:4326&count=5`;
    
    try {
        console.log(`Fetching from: ${url}`);
        const response = await axios.get(url);
        console.log(`Got ${response.data.features.length} features.`);
        if (response.data.features.length > 0) {
            console.log(JSON.stringify(response.data.features[0].properties, null, 2));
            console.log("Geometry Type:", response.data.features[0].geometry.type);
        }
    } catch (err: any) {
        console.error('Error:', err.message);
        if (err.response) {
            console.error('Response data:', err.response.data);
        }
    }
}

testRoadworks();
