# Shortcut Bike Router

An MVP web app for OSM-based bike routing in NYC. It lets a user search for or click a start and destination on a map, then calculates a bike route with FastAPI, OSMnx, and NetworkX.

## What It Does

- **Legal Bike Mode** uses the directed OSM bike network.
- **Shortcut Mode** converts the bike graph to an undirected graph before routing, so most streets are treated as two-way.
- **Compare Mode** returns and draws both routes, then shows approximate distance and time saved.
- **Search** uses a FastAPI proxy to Photon for OSM-based start and destination suggestions.
- **Map styles** include OSM Standard, Carto Light, Carto Dark, and CyclOSM.
- **Current location** can be used as the start point, and the map has a recenter button for the user's browser location.
- **Tim overlays** use `frontend/public/CitiBikeTim.png` beside the title and `frontend/public/healthBarTim.png` as the bottom-left character card.

Shortcut Mode is experimental. It may include wrong-way or non-standard segments that conflict with mapped one-way directionality. Use judgment and obey local laws.

## Project Structure

```text
backend/
  main.py
  routing.py
  graph_cache/
  requirements.txt
frontend/
  app/
  package.json
  tsconfig.json
```

## Backend Setup

```bash
cd /Users/ardadinc/Desktop/TIm-Bike-Chaos/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The first route request downloads the Manhattan and Brooklyn bike network from OpenStreetMap through OSMnx. The graph is cached at `backend/graph_cache/manhattan_brooklyn_bike.graphml`, so later backend starts can load it faster.

## Frontend Setup

```bash
cd /Users/ardadinc/Desktop/TIm-Bike-Chaos/frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

The frontend defaults to `http://localhost:8000` for the API. To override it:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
```

## Vercel Frontend Setup

Deploy the `frontend/` directory as the Vercel project root. Set:

```text
NEXT_PUBLIC_API_URL=https://your-routing-backend.example.com
```

The FastAPI/OSMnx backend should be deployed separately from Vercel or replaced with a production OSM routing service. Do not leave `NEXT_PUBLIC_API_URL` pointed at `localhost` for a hosted deployment.

## Example Route Request

```bash
curl -X POST http://localhost:8000/route \
  -H "Content-Type: application/json" \
  -d '{
    "start": { "lat": 40.730823, "lng": -73.997332 },
    "end": { "lat": 40.700292, "lng": -73.996659 },
    "mode": "compare"
  }'
```

## API

`POST /route`

```json
{
  "start": { "lat": 40.730823, "lng": -73.997332 },
  "end": { "lat": 40.700292, "lng": -73.996659 },
  "mode": "legal"
}
```

For `legal` or `shortcut`, the response is:

```json
{
  "mode": "shortcut",
  "distance_meters": 1234.5,
  "estimated_minutes": 4.9,
  "geometry": [[-73.997332, 40.730823]],
  "warnings": []
}
```

For `compare`, the response contains `legal`, `shortcut`, `saved_distance_meters`, and `saved_minutes`.

`GET /geocode?q=Washington%20Square&limit=5`

```json
{
  "query": "Washington Square",
  "results": [
    {
      "id": "photon-way-123",
      "label": "Washington Square Park, Manhattan, New York",
      "lat": 40.7309,
      "lng": -73.9973,
      "source": "photon"
    }
  ]
}
```

The geocoder endpoint proxies Photon and filters suggestions to a broad NYC-area bounding box. Public Nominatim is intentionally not used for live autocomplete.

## Production Note

OSMnx and NetworkX are good for an MVP and demo-scale routing. For production traffic, migrate routing to an OSM-based engine such as OSRM, GraphHopper, or Valhalla with a custom bike profile.
