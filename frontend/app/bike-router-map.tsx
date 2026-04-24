"use client";

/* eslint-disable @next/next/no-img-element */

import {
  AlertTriangle,
  Bike,
  Crosshair,
  Layers,
  Loader2,
  MapPin,
  Navigation,
  RotateCcw,
  Search,
  X,
  Zap,
} from "lucide-react";
import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";

type Mode = "legal" | "shortcut" | "compare";
type SearchField = "start" | "end";
type MapStyleId = "osm" | "carto-light" | "carto-dark" | "cyclosm";
type BikeType = "regular" | "citi" | "tim";
type Point = { lat: number; lng: number };
type GeocodeSuggestion = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  source: "photon";
};
type RouteObject = {
  mode: "legal" | "shortcut";
  distance_meters: number;
  estimated_minutes: number;
  geometry: [number, number][];
  warnings: string[];
};
type CompareRoute = {
  legal: RouteObject;
  shortcut: RouteObject;
  saved_distance_meters: number;
  saved_minutes: number;
};
type RouteResponse = RouteObject | CompareRoute;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const NYC_CENTER: [number, number] = [40.7129, -73.9724];
const MODES: { value: Mode; label: string }[] = [
  { value: "legal", label: "Legal" },
  { value: "shortcut", label: "Shortcut" },
  { value: "compare", label: "Compare" },
];
const BIKE_TYPES: { value: BikeType; label: string; speedMph: number }[] = [
  { value: "regular", label: "Regular Bike", speedMph: 10 },
  { value: "citi", label: "E-Citi Bike", speedMph: 15 },
  { value: "tim", label: "Tim Mode", speedMph: 17 },
];
const BIKE_SPEED_MPH: Record<BikeType, number> = {
  regular: 10,
  citi: 15,
  tim: 17,
};
const MAP_STYLES: Record<
  MapStyleId,
  { label: string; url: string; attribution: string }
> = {
  osm: {
    label: "OSM Standard",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  "carto-light": {
    label: "Carto Light",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  "carto-dark": {
    label: "Carto Dark",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  cyclosm: {
    label: "CyclOSM",
    url: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    attribution:
      '<a href="https://www.cyclosm.org">CyclOSM</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
};

function isCompareRoute(route: RouteResponse | null): route is CompareRoute {
  return Boolean(route && "legal" in route && "shortcut" in route);
}

function formatMeters(meters: number) {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

const METERS_PER_MILE = 1609.34;

function etaMinutes(distanceMeters: number, speedMph: number): number {
  const minutes = (distanceMeters / METERS_PER_MILE / speedMph) * 60;
  return Math.max(1, Math.round(minutes));
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (networkError) {
    if ((networkError as Error).name === "AbortError") {
      throw networkError;
    }
    throw new Error(
      `Network error reaching ${url}: ${(networkError as Error).message}`,
    );
  }

  const rawText = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const looksJson = contentType.includes("application/json");

  let payload: unknown = null;
  let parseFailed = false;
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      parseFailed = true;
    }
  }

  if (!response.ok) {
    const detailFromJson =
      payload &&
      typeof payload === "object" &&
      "detail" in (payload as Record<string, unknown>)
        ? String((payload as Record<string, unknown>).detail)
        : null;
    const snippet = detailFromJson ?? rawText.slice(0, 160) ?? response.statusText;
    throw new Error(
      `HTTP ${response.status} ${response.statusText} from ${url} — ${snippet || "(empty body)"}`,
    );
  }

  if (parseFailed || !looksJson) {
    const snippet = rawText.slice(0, 160);
    throw new Error(
      `Expected JSON from ${url} but got ${contentType || "no content-type"} (HTTP ${response.status}). Body: ${snippet || "(empty)"}`,
    );
  }

  return payload as T;
}

function toLeafletPath(coords: [number, number][]): [number, number][] {
  return coords.map(([lng, lat]) => [lat, lng]);
}

function ClickHandler({
  onPoint,
}: {
  onPoint: (point: Point) => void;
}) {
  useMapEvents({
    click(event) {
      onPoint({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

function FitRoutes({ routes }: { routes: RouteResponse | null }) {
  const map = useMap();

  useEffect(() => {
    const coords = isCompareRoute(routes)
      ? [...routes.legal.geometry, ...routes.shortcut.geometry]
      : routes?.geometry ?? [];

    if (coords.length < 2) {
      return;
    }

    const bounds = L.latLngBounds(toLeafletPath(coords as [number, number][]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 });
  }, [map, routes]);

  return null;
}

function PointMarker({ point, kind }: { point: Point; kind: SearchField }) {
  const icon = useMemo(
    () =>
      L.divIcon({
        className: "",
        html: `<div class="point-marker ${kind}">${kind === "start" ? "A" : "B"}</div>`,
        iconAnchor: [15, 15],
      }),
    [kind],
  );

  return <Marker icon={icon} position={[point.lat, point.lng]} />;
}

function UserLocationMarker({ point }: { point: Point }) {
  const icon = useMemo(
    () =>
      L.divIcon({
        className: "",
        html: '<div class="user-location-marker"></div>',
        iconAnchor: [10, 10],
      }),
    [],
  );

  return <Marker icon={icon} position={[point.lat, point.lng]} />;
}

function FocusPoint({
  point,
  requestId,
  zoom = 16,
}: {
  point: Point | null;
  requestId: number;
  zoom?: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (!point || requestId === 0) {
      return;
    }

    map.flyTo([point.lat, point.lng], zoom, {
      animate: true,
      duration: 0.85,
    });
  }, [map, point, requestId, zoom]);

  return null;
}

function SearchBox({
  field,
  label,
  placeholder,
  query,
  activeSearchField,
  suggestions,
  isSearching,
  onQueryChange,
  onFocus,
  onSelect,
  onClear,
}: {
  field: SearchField;
  label: string;
  placeholder: string;
  query: string;
  activeSearchField: SearchField | null;
  suggestions: GeocodeSuggestion[];
  isSearching: boolean;
  onQueryChange: (field: SearchField, value: string) => void;
  onFocus: (field: SearchField) => void;
  onSelect: (field: SearchField, suggestion: GeocodeSuggestion) => void;
  onClear: (field: SearchField) => void;
}) {
  const isActive = activeSearchField === field;

  return (
    <label className="search-field">
      <span className="mb-1 block text-[11px] font-black uppercase tracking-[0.16em] text-neutral-500">
        {label}
      </span>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
          size={16}
        />
        <input
          autoComplete="off"
          className="w-full rounded-md border border-neutral-300 bg-white py-2 pl-9 pr-16 text-sm font-bold text-neutral-950 outline-none transition placeholder:font-semibold placeholder:text-neutral-400 focus:border-neutral-950"
          onChange={(event) => onQueryChange(field, event.target.value)}
          onFocus={() => onFocus(field)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && suggestions[0]) {
              event.preventDefault();
              onSelect(field, suggestions[0]);
            }
          }}
          placeholder={placeholder}
          value={query}
        />
        {query && (
          <button
            aria-label={`Clear ${label.toLowerCase()}`}
            className="search-clear-button"
            onClick={(event) => {
              event.preventDefault();
              onClear(field);
            }}
            type="button"
          >
            <X size={14} />
          </button>
        )}
        {isSearching && isActive && (
          <Loader2
            className="absolute right-9 top-1/2 -translate-y-1/2 animate-spin text-neutral-500"
            size={16}
          />
        )}

        {isActive && suggestions.length > 0 && (
          <div className="suggestion-list">
            {suggestions.map((suggestion, index) => (
              <button
                className="suggestion-item"
                key={`${field}-${suggestion.id}-${index}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(field, suggestion);
                }}
                type="button"
              >
                <MapPin size={14} />
                <span>{suggestion.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </label>
  );
}

function EtaCaption({
  bikeType,
  speedMph,
}: {
  bikeType: BikeType;
  speedMph: number;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-neutral-500">
        ETA based on {speedMph} mph average speed.
      </p>
      {bikeType === "tim" && (
        <p className="text-xs font-bold text-[#7d2719]">
          Tim Mode assumes aggressive e-bike pace. Obey local laws.
        </p>
      )}
    </div>
  );
}

function SingleStats({
  route,
  bikeType,
  speedMph,
}: {
  route: RouteObject;
  bikeType: BikeType;
  speedMph: number;
}) {
  const minutes = etaMinutes(route.distance_meters, speedMph);
  return (
    <div className="space-y-2">
      <div className="stats-grid">
        <div className="stat-box">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-500">
            Distance
          </p>
          <p className="mt-1 text-lg font-black">{formatMeters(route.distance_meters)}</p>
        </div>
        <div className="stat-box">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-500">
            Time
          </p>
          <p className="mt-1 text-lg font-black">{minutes} min</p>
        </div>
      </div>
      <EtaCaption bikeType={bikeType} speedMph={speedMph} />
    </div>
  );
}

function CompareStats({
  route,
  bikeType,
  speedMph,
}: {
  route: CompareRoute;
  bikeType: BikeType;
  speedMph: number;
}) {
  const legalMinutes = etaMinutes(route.legal.distance_meters, speedMph);
  const shortcutMinutes = etaMinutes(route.shortcut.distance_meters, speedMph);
  const savedMinutes = Math.max(0, legalMinutes - shortcutMinutes);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md bg-neutral-950 p-3 text-white">
        <span className="text-xs font-black uppercase tracking-[0.14em] text-emerald-200">
          Legal
        </span>
        <span className="text-sm font-bold">{formatMeters(route.legal.distance_meters)}</span>
        <span className="text-sm font-bold">{legalMinutes} min</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md bg-[#fff1dc] p-3 text-[#7d2719]">
        <span className="text-xs font-black uppercase tracking-[0.14em]">
          Shortcut
        </span>
        <span className="text-sm font-bold">{formatMeters(route.shortcut.distance_meters)}</span>
        <span className="text-sm font-bold">{shortcutMinutes} min</span>
      </div>
      <p className="text-sm font-bold">
        Saved: {formatMeters(Math.max(0, route.saved_distance_meters))} /{" "}
        {savedMinutes} min
      </p>
      <EtaCaption bikeType={bikeType} speedMph={speedMph} />
    </div>
  );
}

export default function BikeRouterMap() {
  const [mode, setMode] = useState<Mode>("legal");
  const [mapStyle, setMapStyle] = useState<MapStyleId>("carto-light");
  const [bikeType, setBikeType] = useState<BikeType>("regular");
  const [start, setStart] = useState<Point | null>(null);
  const [end, setEnd] = useState<Point | null>(null);
  const [startQuery, setStartQuery] = useState("");
  const [endQuery, setEndQuery] = useState("");
  const [activeSearchField, setActiveSearchField] = useState<SearchField | null>(null);
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [userLocation, setUserLocation] = useState<Point | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [focusRequestId, setFocusRequestId] = useState(0);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedMapStyle = MAP_STYLES[mapStyle];
  const titleTone = mapStyle === "carto-dark" ? "dark" : "light";
  const activeQuery = activeSearchField === "start" ? startQuery : endQuery;
  const hasShortcutWarning =
    mode === "shortcut" || mode === "compare" || isCompareRoute(route);

  function handlePoint(point: Point) {
    setError(null);
    setSuggestions([]);
    setActiveSearchField(null);
    if (!start || (start && end)) {
      setStart(point);
      setStartQuery("Dropped pin");
      setEnd(null);
      setEndQuery("");
      setRoute(null);
      return;
    }

    setEnd(point);
    setEndQuery("Dropped pin");
    setRoute(null);
  }

  function clearRoute() {
    setStart(null);
    setEnd(null);
    setStartQuery("");
    setEndQuery("");
    setActiveSearchField(null);
    setSuggestions([]);
    setRoute(null);
    setError(null);
  }

  function handleQueryChange(field: SearchField, value: string) {
    setError(null);
    setActiveSearchField(field);
    setSuggestions([]);
    setRoute(null);

    if (field === "start") {
      setStartQuery(value);
      setStart(null);
    } else {
      setEndQuery(value);
      setEnd(null);
    }
  }

  function handleSuggestionSelect(field: SearchField, suggestion: GeocodeSuggestion) {
    const point = { lat: suggestion.lat, lng: suggestion.lng };
    setError(null);
    setSuggestions([]);
    setActiveSearchField(null);
    setRoute(null);

    if (field === "start") {
      setStart(point);
      setStartQuery(suggestion.label);
    } else {
      setEnd(point);
      setEndQuery(suggestion.label);
    }
  }

  function clearSearchField(field: SearchField) {
    setError(null);
    setSuggestions([]);
    setActiveSearchField(field);
    setRoute(null);

    if (field === "start") {
      setStart(null);
      setStartQuery("");
      return;
    }

    setEnd(null);
    setEndQuery("");
  }

  function applyUserLocation(point: Point, useAsStart: boolean) {
    setUserLocation(point);
    setFocusRequestId((current) => current + 1);
    setError(null);

    if (!useAsStart) {
      return;
    }

    setStart(point);
    setStartQuery("Your current location");
    setRoute(null);
    setSuggestions([]);
    setActiveSearchField(null);
  }

  function requestUserLocation(useAsStart: boolean) {
    if (!navigator.geolocation) {
      setError("Current location is not available in this browser.");
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        applyUserLocation(
          {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
          useAsStart,
        );
        setIsLocating(false);
      },
      () => {
        setError("Location permission was denied or unavailable.");
        setIsLocating(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 30000,
        timeout: 10000,
      },
    );
  }

  useEffect(() => {
    if (!activeSearchField || activeQuery.trim().length < 3 || activeQuery === "Dropped pin") {
      return;
    }

    const controller = new AbortController();
    const debounce = window.setTimeout(async () => {
      setIsSearching(true);
      const params = new URLSearchParams({ q: activeQuery, limit: "5" });
      const url = `${API_URL}/geocode?${params.toString()}`;
      try {
        const payload = await apiFetch<{ results?: GeocodeSuggestion[] }>(url, {
          signal: controller.signal,
        });
        setSuggestions(payload.results ?? []);
      } catch (searchError) {
        if ((searchError as Error).name !== "AbortError") {
          setSuggestions([]);
          setError((searchError as Error).message);
        }
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(debounce);
      controller.abort();
    };
  }, [activeQuery, activeSearchField]);

  useEffect(() => {
    if (!start || !end) {
      return;
    }

    const controller = new AbortController();

    async function fetchRoute() {
      setIsLoading(true);
      setError(null);

      const url = `${API_URL}/route`;
      try {
        const payload = await apiFetch<RouteResponse>(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ start, end, mode }),
          signal: controller.signal,
        });
        setRoute(payload);
      } catch (requestError) {
        if ((requestError as Error).name !== "AbortError") {
          setRoute(null);
          setError((requestError as Error).message);
        }
      } finally {
        setIsLoading(false);
      }
    }

    fetchRoute();
    return () => controller.abort();
  }, [start, end, mode]);

  return (
    <main className="map-shell">
      <MapContainer center={NYC_CENTER} zoom={12} scrollWheelZoom zoomControl={false}>
        <TileLayer
          attribution={selectedMapStyle.attribution}
          key={mapStyle}
          url={selectedMapStyle.url}
        />
        <ClickHandler onPoint={handlePoint} />
        <FitRoutes routes={route} />
        <FocusPoint point={userLocation} requestId={focusRequestId} />
        {start && <PointMarker kind="start" point={start} />}
        {end && <PointMarker kind="end" point={end} />}
        {userLocation && <UserLocationMarker point={userLocation} />}
        {isCompareRoute(route) ? (
          <>
            <Polyline
              pathOptions={{ color: "#006b5f", weight: 6, opacity: 0.9 }}
              positions={toLeafletPath(route.legal.geometry)}
            />
            <Polyline
              pathOptions={{ color: "#d94124", dashArray: "9 8", weight: 5, opacity: 0.95 }}
              positions={toLeafletPath(route.shortcut.geometry)}
            />
          </>
        ) : route ? (
          <Polyline
            pathOptions={{
              color: route.mode === "shortcut" ? "#d94124" : "#006b5f",
              dashArray: route.mode === "shortcut" ? "9 8" : undefined,
              weight: 6,
              opacity: 0.95,
            }}
            positions={toLeafletPath(route.geometry)}
          />
        ) : null}
      </MapContainer>

      <aside className={`route-title route-title-${titleTone}`}>
        <div>
          <h2>Tim&rsquo;s Chaos Route</h2>
          <p>Wear a helmet dumbass</p>
        </div>
        <img
          alt="Tim on a bike"
          src="/CitiBikeTim.png"
        />
      </aside>

      <aside className="tim-character-card" aria-label="Tim status character">
        <img
          alt="Tim status character"
          src="/healthBarTim.png"
        />
      </aside>

      <button
        aria-label="Recenter on your current location"
        className="recenter-button"
        disabled={isLocating}
        onClick={() => requestUserLocation(false)}
        type="button"
      >
        {isLocating ? <Loader2 className="animate-spin" size={20} /> : <Crosshair size={20} />}
      </button>

      <section className="control-card">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-neutral-500">
              <Bike size={15} />
              NYC bike routing
            </div>
            <h1 className="text-2xl font-black leading-none">Shortcut Bike Router</h1>
          </div>
          <button
            aria-label="Clear route"
            className="reset-button grid h-11 w-11 shrink-0 place-items-center rounded-md bg-neutral-950 text-white transition hover:bg-neutral-700"
            onClick={clearRoute}
            type="button"
          >
            <RotateCcw size={18} />
          </button>
        </div>

        <div className="mb-3 space-y-3">
          <SearchBox
            activeSearchField={activeSearchField}
            field="start"
            isSearching={isSearching}
            label="Start"
            onFocus={setActiveSearchField}
            onQueryChange={handleQueryChange}
            onClear={clearSearchField}
            onSelect={handleSuggestionSelect}
            placeholder="Search a start place"
            query={startQuery}
            suggestions={suggestions}
          />
          <button
            className="location-start-button"
            disabled={isLocating}
            onClick={() => requestUserLocation(true)}
            type="button"
          >
            {isLocating ? <Loader2 className="animate-spin" size={15} /> : <Navigation size={15} />}
            <span>Use current location as start</span>
          </button>
          <SearchBox
            activeSearchField={activeSearchField}
            field="end"
            isSearching={isSearching}
            label="Destination"
            onFocus={setActiveSearchField}
            onQueryChange={handleQueryChange}
            onClear={clearSearchField}
            onSelect={handleSuggestionSelect}
            placeholder="Search a destination"
            query={endQuery}
            suggestions={suggestions}
          />
        </div>

        <div className="selects-row mb-3 grid grid-cols-3 gap-2">
          <label className="block min-w-0">
            <span className="mb-1 block text-[11px] font-black uppercase tracking-[0.16em] text-neutral-500">
              Mode
            </span>
            <select
              className="w-full min-w-0 rounded-md border border-neutral-300 bg-white px-2 py-2 text-sm font-bold text-neutral-950 outline-none ring-0 transition focus:border-neutral-950"
              onChange={(event) => setMode(event.target.value as Mode)}
              value={mode}
            >
              {MODES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block min-w-0">
            <span className="mb-1 flex items-center gap-1 text-[11px] font-black uppercase tracking-[0.16em] text-neutral-500">
              <Zap size={12} className="text-amber-500" />
              Bike
            </span>
            <select
              className="w-full min-w-0 rounded-md border border-neutral-300 bg-white px-2 py-2 text-sm font-bold text-neutral-950 outline-none ring-0 transition focus:border-neutral-950"
              onChange={(event) => setBikeType(event.target.value as BikeType)}
              value={bikeType}
            >
              {BIKE_TYPES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block min-w-0">
            <span className="mb-1 flex items-center gap-1 text-[11px] font-black uppercase tracking-[0.16em] text-neutral-500">
              <Layers size={12} />
              Map
            </span>
            <select
              className="w-full min-w-0 rounded-md border border-neutral-300 bg-white px-2 py-2 text-sm font-bold text-neutral-950 outline-none ring-0 transition focus:border-neutral-950"
              onChange={(event) => setMapStyle(event.target.value as MapStyleId)}
              value={mapStyle}
            >
              {Object.entries(MAP_STYLES).map(([id, style]) => (
                <option key={id} value={id}>
                  {style.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mb-4 flex items-center gap-2 rounded-md bg-neutral-950 px-3 py-2 text-sm font-semibold text-white">
          <MapPin size={16} />
          Search above or click the map to drop start and destination pins.
        </div>

        <div className="space-y-3">
          {isLoading && (
            <p className="rounded-md bg-neutral-100 p-3 text-sm font-bold">
              Calculating route...
            </p>
          )}

          {error && (
            <p className="rounded-md bg-red-50 p-3 text-sm font-bold text-red-800 break-words">
              {error}
            </p>
          )}

          {route &&
            (isCompareRoute(route) ? (
              <CompareStats
                bikeType={bikeType}
                route={route}
                speedMph={BIKE_SPEED_MPH[bikeType]}
              />
            ) : (
              <SingleStats
                bikeType={bikeType}
                route={route}
                speedMph={BIKE_SPEED_MPH[bikeType]}
              />
            ))}

          {route && !isCompareRoute(route) && (
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-neutral-500">
              Mode used: {route.mode}
            </p>
          )}

          {hasShortcutWarning && (
            <div className="warning-card flex gap-2 text-sm font-bold">
              <AlertTriangle className="mt-0.5 shrink-0" size={17} />
              <span>Experimental route. May include wrong-way or non-standard segments.</span>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
