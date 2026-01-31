const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Proxy to NHTSA VPIC API
app.use('/api/nhtsa', async (req, res) => {
  try {
    const path = req.url;
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles${path}`;
    
    console.log('NHTSA request:', url);
    
    const response = await fetch(url);
    const body = await response.text();
    
    res.set('Content-Type', 'application/json');
    res.status(response.status).send(body);
  } catch (e) {
    console.error('NHTSA proxy error:', e);
    res.status(500).json({ error: String(e) });
  }
});

// Proxy to fueleconomy.gov REST
app.use('/api/fueleconomy', async (req, res) => {
  try {
    const path = req.url;
    const url = `https://www.fueleconomy.gov/ws/rest${path}`;
    
    console.log('FuelEconomy request:', url);
    
    const response = await fetch(url);
    const body = await response.text();
    
    res.set('Content-Type', 'application/xml');
    res.status(response.status).send(body);
  } catch (e) {
    console.error('FuelEconomy proxy error:', e);
    res.status(500).json({ error: String(e) });
  }
});

app.listen(PORT, () => {
  console.log('Proxy server listening on http://localhost:' + PORT);
});
