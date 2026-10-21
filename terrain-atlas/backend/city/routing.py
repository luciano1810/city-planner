"""Deterministic directed shortest paths, shared by traffic and accessibility."""
import heapq
import math


def shortest_paths(graph, source, destination=None, weight=None):
    dist, prev, queue = {source: 0.}, {}, [(0., source)]
    while queue:
        cost, node = heapq.heappop(queue)
        if cost != dist.get(node):
            continue
        if node == destination:
            break
        for edge in graph.get(node, []):
            target = edge['to']
            step = weight(edge,cost) if weight else edge['time']
            if step is None:
                continue
            if not math.isfinite(step) or step < 0:
                raise ValueError('无效的路径成本')
            candidate = cost + step
            if candidate < dist.get(target, math.inf) - 1e-9:
                dist[target], prev[target] = candidate, (node, edge)
                heapq.heappush(queue, (candidate, target))
    return dist, prev


def reconstruct(prev, source, target):
    result, seen = [], set()
    while target != source:
        if target in seen or target not in prev:
            return []
        seen.add(target)
        node, edge = prev[target]
        result.append(dict(edge, origin=node))
        target = node
    return result[::-1]
