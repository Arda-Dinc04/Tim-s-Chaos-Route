from __future__ import annotations

import pickle
from pathlib import Path
from threading import RLock
from typing import Literal, TypedDict

import networkx as nx
import osmnx as ox
from shapely.geometry import LineString


Mode = Literal["legal", "shortcut", "compare"]
BIKE_SPEED_METERS_PER_MINUTE = 15000 / 60
SHORTCUT_WARNING = (
    "Shortcut Mode may include segments that conflict with mapped one-way "
    "directionality. Use judgment and obey local laws."
)

BASE_DIR = Path(__file__).resolve().parent
GRAPH_CACHE_DIR = BASE_DIR / "graph_cache"
GRAPH_CACHE_PATH = GRAPH_CACHE_DIR / "manhattan_brooklyn_bike.graphml"
GRAPH_PICKLE_PATH = GRAPH_CACHE_DIR / "manhattan_brooklyn_bike.pkl"
UNDIRECTED_PICKLE_PATH = GRAPH_CACHE_DIR / "manhattan_brooklyn_bike_undirected.pkl"
PLACES = [
    "Manhattan, New York City, New York, USA",
    "Brooklyn, New York City, New York, USA",
]

_graph_lock = RLock()
_directed_graph: nx.MultiDiGraph | None = None
_undirected_graph: nx.MultiGraph | None = None


def _load_pickle(path: Path):
    with path.open("rb") as f:
        return pickle.load(f)


def _save_pickle(path: Path, obj) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("wb") as f:
        pickle.dump(obj, f, protocol=pickle.HIGHEST_PROTOCOL)
    tmp.replace(path)


class RouteError(Exception):
    pass


class RouteObject(TypedDict):
    mode: str
    distance_meters: float
    estimated_minutes: float
    geometry: list[list[float]]
    warnings: list[str]


def load_graph() -> nx.MultiDiGraph:
    global _directed_graph

    if _directed_graph is not None:
        return _directed_graph

    with _graph_lock:
        if _directed_graph is not None:
            return _directed_graph

        GRAPH_CACHE_DIR.mkdir(parents=True, exist_ok=True)

        graph: nx.MultiDiGraph | None = None
        if GRAPH_PICKLE_PATH.exists():
            try:
                graph = _load_pickle(GRAPH_PICKLE_PATH)
            except Exception:
                # Stale/incompatible pickle (e.g. after a lib upgrade): fall back
                # to the portable graphml and rebuild the pickle.
                graph = None

        if graph is None:
            if GRAPH_CACHE_PATH.exists():
                graph = ox.io.load_graphml(GRAPH_CACHE_PATH)
            else:
                ox.settings.use_cache = True
                ox.settings.log_console = True
                graph = ox.graph.graph_from_place(
                    PLACES,
                    network_type="bike",
                    simplify=True,
                    retain_all=True,
                    truncate_by_edge=True,
                )
                ox.io.save_graphml(graph, GRAPH_CACHE_PATH)

            try:
                _save_pickle(GRAPH_PICKLE_PATH, graph)
            except Exception:
                # Pickle is only a speed cache; failing to write it shouldn't
                # break routing.
                pass

        _directed_graph = graph
        return graph


def load_undirected_graph() -> nx.MultiGraph:
    global _undirected_graph

    if _undirected_graph is not None:
        return _undirected_graph

    with _graph_lock:
        if _undirected_graph is not None:
            return _undirected_graph

        GRAPH_CACHE_DIR.mkdir(parents=True, exist_ok=True)

        graph: nx.MultiGraph | None = None
        if UNDIRECTED_PICKLE_PATH.exists():
            try:
                graph = _load_pickle(UNDIRECTED_PICKLE_PATH)
            except Exception:
                graph = None

        if graph is None:
            graph = ox.convert.to_undirected(load_graph())
            try:
                _save_pickle(UNDIRECTED_PICKLE_PATH, graph)
            except Exception:
                pass

        _undirected_graph = graph
        return graph


def calculate_time(distance_meters: float) -> float:
    return round(distance_meters / BIKE_SPEED_METERS_PER_MINUTE, 1)


def _nearest_node(graph: nx.MultiDiGraph | nx.MultiGraph, lat: float, lng: float) -> int:
    return int(ox.distance.nearest_nodes(graph, X=lng, Y=lat))


def _best_edge_data(graph: nx.MultiDiGraph | nx.MultiGraph, u: int, v: int) -> dict:
    edge_options = graph.get_edge_data(u, v)
    if not edge_options:
        raise RouteError(f"Route geometry is missing an edge between nodes {u} and {v}.")
    return min(edge_options.values(), key=lambda edge: float(edge.get("length", 0)))


def _node_coord(graph: nx.MultiDiGraph | nx.MultiGraph, node: int) -> tuple[float, float]:
    data = graph.nodes[node]
    return float(data["x"]), float(data["y"])


def _squared_distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def _edge_coords(
    graph: nx.MultiDiGraph | nx.MultiGraph,
    u: int,
    v: int,
    edge_data: dict,
) -> list[list[float]]:
    geometry = edge_data.get("geometry")
    if isinstance(geometry, LineString):
        coords = [[float(lng), float(lat)] for lng, lat in geometry.coords]
    else:
        coords = [list(_node_coord(graph, u)), list(_node_coord(graph, v))]

    u_coord = _node_coord(graph, u)
    v_coord = _node_coord(graph, v)
    forward_score = _squared_distance(tuple(coords[0]), u_coord) + _squared_distance(
        tuple(coords[-1]), v_coord
    )
    reverse_score = _squared_distance(tuple(coords[0]), v_coord) + _squared_distance(
        tuple(coords[-1]), u_coord
    )

    if reverse_score < forward_score:
        coords.reverse()

    return coords


def calculate_distance(
    graph: nx.MultiDiGraph | nx.MultiGraph,
    route_nodes: list[int],
) -> float:
    total = 0.0
    for u, v in zip(route_nodes[:-1], route_nodes[1:]):
        edge_data = _best_edge_data(graph, u, v)
        total += float(edge_data.get("length", 0))
    return round(total, 1)


def route_to_geojson_coords(
    graph: nx.MultiDiGraph | nx.MultiGraph,
    route_nodes: list[int],
) -> list[list[float]]:
    geometry: list[list[float]] = []
    for u, v in zip(route_nodes[:-1], route_nodes[1:]):
        edge_data = _best_edge_data(graph, u, v)
        segment = _edge_coords(graph, u, v, edge_data)
        if geometry and segment:
            segment = segment[1:]
        geometry.extend(segment)
    return geometry


def _compute_route(
    start_lat: float,
    start_lng: float,
    end_lat: float,
    end_lng: float,
    mode: Literal["legal", "shortcut"],
) -> RouteObject:
    graph = load_graph() if mode == "legal" else load_undirected_graph()
    origin = _nearest_node(graph, start_lat, start_lng)
    destination = _nearest_node(graph, end_lat, end_lng)

    try:
        route_nodes = nx.shortest_path(graph, origin, destination, weight="length")
    except (nx.NetworkXNoPath, nx.NodeNotFound) as exc:
        raise RouteError(f"No {mode} bike route found between these points.") from exc

    distance_meters = calculate_distance(graph, route_nodes)
    return {
        "mode": mode,
        "distance_meters": distance_meters,
        "estimated_minutes": calculate_time(distance_meters),
        "geometry": route_to_geojson_coords(graph, route_nodes),
        "warnings": [SHORTCUT_WARNING] if mode == "shortcut" else [],
    }


def get_route(
    start_lat: float,
    start_lng: float,
    end_lat: float,
    end_lng: float,
    mode: Mode,
):
    if mode == "compare":
        legal = _compute_route(start_lat, start_lng, end_lat, end_lng, "legal")
        shortcut = _compute_route(start_lat, start_lng, end_lat, end_lng, "shortcut")
        saved_distance = legal["distance_meters"] - shortcut["distance_meters"]
        saved_minutes = legal["estimated_minutes"] - shortcut["estimated_minutes"]
        return {
            "legal": legal,
            "shortcut": shortcut,
            "saved_distance_meters": round(saved_distance, 1),
            "saved_minutes": round(saved_minutes, 1),
        }

    if mode in {"legal", "shortcut"}:
        return _compute_route(start_lat, start_lng, end_lat, end_lng, mode)

    raise RouteError(f"Unsupported route mode: {mode}")
