import unittest
from types import SimpleNamespace
from unittest.mock import patch
from shapely.geometry import box
from tests.test_naming import sample  # backend imports
from city.renewal import conversion_constraint


class ConversionTests(unittest.TestCase):
    def setUp(self):
        self.source=dict(id='old',connected=True,building=dict(use='office',capacity=100,employees=0))
        self.land=dict(id='empty',connected=True,use='auto',points=[[0,0],[10,0],[10,10]],terrain=dict(slope=0,maxFloors=5,costFactor=1))
        self.city=SimpleNamespace(s=dict(parcels=[self.source,self.land],households=[],renewals=[],policy=dict(minimumProjectUnits=5,economicCatchmentMinutes=30,householdSpace=75)),distances=lambda *_:({'empty':5},{}))
        self.housing=SimpleNamespace(gap=lambda p:0)
        self.market=SimpleNamespace(gap=lambda p,u:100 if u=='commercial' else 0)

    def check(self):
        with patch('city.renewal.building_footprint',return_value=box(0,0,100,100)),patch('city.development.desired_floors',return_value=3):
            return conversion_constraint(self.city,[self.source],'commercial',50,10000000,self.housing,self.market)

    def test_surplus_and_shortage_required(self):
        self.source['building']['employees']=80
        self.assertIn('原用途',self.check())
        self.source['building']['employees']=0
        self.market.gap=lambda p,u:0
        self.assertIn('目标用途',self.check())

    def test_accessible_affordable_land_wins_but_remote_or_expensive_land_does_not(self):
        self.assertIn('空地',self.check())
        self.city.distances=lambda *_:({}, {})
        self.assertIsNone(self.check())
        self.city.distances=lambda *_:({'empty':5}, {})
        self.land['terrain']['costFactor']=20
        self.assertIsNone(self.check())
        self.city.s['parcels']=[self.source]
        self.assertIsNone(self.check())
