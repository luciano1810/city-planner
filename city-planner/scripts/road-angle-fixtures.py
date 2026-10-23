"""Emit real engine junctions for the road-angle renderer audit (JSON lines)."""
import itertools
import json
import math
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tests.test_city import flat_world
from tests.test_road_connections import link
from city.geometry import Terrain, make_network
from city.parameters import ROAD_KINDS, ROAD_TYPES, POLICY
from city.signals import configure

terrain = Terrain(flat_world())
angles = [2, 5, 10, 15, 30, 45, 60, 90, 120, 135, 150, 165, 170, 175, 178]
for a, b, angle, shape, level in itertools.product(sorted(ROAD_KINDS), sorted(ROAD_KINDS), angles, ['T', 'X'], [-1, 0, 1]):
    theta = math.radians(angle)
    end = lambda sign: [2000+sign*500*math.cos(theta), 2000+sign*500*math.sin(theta)]
    roads = [link('a', [[1500,2000],[2500,2000]], level=level, kind=a),
             link('b', [[2000,2000] if shape == 'T' else end(-1), end(1)], level=level, kind=b)]
    network = make_network(roads, [], terrain)
    configure(network, POLICY)
    yield_case = dict(id=f'{a}/{b}/{shape}/{angle}/L{level}', kinds=[a,b], angle=angle, shape=shape, level=level,
                     roads=roads, network=network, roadTypes=ROAD_TYPES)
    print(json.dumps(yield_case, separators=(',', ':')))
# Mixed road types at five/six-way junctions, plus grade-separated crossings.
for count in [5, 6]:
    roads = [link(str(i), [[2000,2000],[2000+500*math.cos(i*2*math.pi/count),2000+500*math.sin(i*2*math.pi/count)]], kind=kind)
             for i, kind in enumerate(['street','avenue','lane','highway','motorway','path'][:count])]
    network = make_network(roads, [], terrain); configure(network, POLICY)
    print(json.dumps(dict(id=f'{count}-way', shape='multi', level=0, roads=roads, network=network, roadTypes=ROAD_TYPES)))
for a, b in itertools.product(sorted(ROAD_KINDS), repeat=2):
    roads = [link('a', [[1500,2000],[2500,2000]], kind=a, level=0), link('b', [[2000,1500],[2000,2500]], kind=b, level=1)]
    network = make_network(roads, [], terrain); configure(network, POLICY)
    print(json.dumps(dict(id=f'{a}/{b}/separate', shape='separate', level=0, roads=roads, network=network, roadTypes=ROAD_TYPES)))
