import os
from typing import Literal

import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from routing import RouteError, get_route


class Point(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class RouteRequest(BaseModel):
    start: Point
    end: Point
    mode: Literal["legal", "shortcut", "compare"]


PHOTON_URL = "https://photon.komoot.io/api/"
NYC_BOUNDS = {
    "min_lat": 40.45,
    "max_lat": 40.95,
    "min_lng": -74.35,
    "max_lng": -73.65,
}

app = FastAPI(title="Shortcut Bike Router API")

_DEFAULT_CORS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
]


def _cors_allow_origins() -> list[str]:
    """Default localhost + extra origins from CORS_ALLOW_ORIGINS (comma-separated)."""
    seen: set[str] = set()
    out: list[str] = []
    for origin in _DEFAULT_CORS:
        if origin not in seen:
            seen.add(origin)
            out.append(origin)
    extra = os.environ.get("CORS_ALLOW_ORIGINS", "")
    for part in extra.split(","):
        o = part.strip()
        if o and o not in seen:
            seen.add(o)
            out.append(o)
    return out


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_allow_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _inside_nyc_bounds(lat: float, lng: float) -> bool:
    return (
        NYC_BOUNDS["min_lat"] <= lat <= NYC_BOUNDS["max_lat"]
        and NYC_BOUNDS["min_lng"] <= lng <= NYC_BOUNDS["max_lng"]
    )


def _format_feature_label(properties: dict) -> str:
    name_parts = [
        properties.get("housenumber"),
        properties.get("street"),
    ]
    address = " ".join(str(part) for part in name_parts if part)
    primary = properties.get("name") or address
    context = [
        properties.get("district"),
        properties.get("city"),
        properties.get("state"),
    ]
    label_parts = [str(part) for part in [primary, *context] if part]
    return ", ".join(dict.fromkeys(label_parts))


@app.get("/geocode")
def geocode(
    q: str = Query(default="", min_length=0),
    limit: int = Query(default=5, ge=1, le=10),
):
    query = q.strip()
    if len(query) < 3:
        return {"query": query, "results": []}

    try:
        response = requests.get(
            PHOTON_URL,
            params={
                "q": query,
                "lat": 40.7129,
                "lon": -73.9724,
                "limit": max(limit * 3, limit),
                "lang": "en",
            },
            headers={"User-Agent": "ShortcutBikeRouterMVP/0.1"},
            timeout=8,
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502,
            detail="Geocoding service is unavailable. Try again shortly.",
        ) from exc

    features = response.json().get("features", [])
    results = []
    seen_results = set()
    for index, feature in enumerate(features):
        coordinates = feature.get("geometry", {}).get("coordinates", [])
        if len(coordinates) < 2:
            continue

        lng = float(coordinates[0])
        lat = float(coordinates[1])
        if not _inside_nyc_bounds(lat, lng):
            continue

        properties = feature.get("properties", {})
        label = _format_feature_label(properties)
        if not label:
            continue
        result_key = (label, round(lat, 7), round(lng, 7))
        if result_key in seen_results:
            continue
        seen_results.add(result_key)

        osm_type = properties.get("osm_type", "feature")
        osm_id = properties.get("osm_id", index)

        results.append(
            {
                "id": f"photon-{osm_type}-{osm_id}-{index}",
                "label": label,
                "lat": lat,
                "lng": lng,
                "source": "photon",
            }
        )
        if len(results) >= limit:
            break

    return {"query": query, "results": results}


@app.post("/route")
def route(request: RouteRequest):
    try:
        return get_route(
            start_lat=request.start.lat,
            start_lng=request.start.lng,
            end_lat=request.end.lat,
            end_lng=request.end.lng,
            mode=request.mode,
        )
    except RouteError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
