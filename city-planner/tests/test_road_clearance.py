"""Manual roadworks clear sites atomically and resettle real occupants."""
import copy
import unittest
from unittest.mock import patch
from shapely.geometry import Polygon,LineString
from tests.test_city import City,flat_world,road
from tests.test_city_v3 import complete
from tests.test_renewal import neighborhood,begin
from city.parameters import ROAD_TYPES
from city.simulation import advance


def occupied_street(alternative=True,households=2):
    c=City(flat_world());c.s['settings'].update(autoGrow=False,autoRenew=False,growth=0,migration=0,externalJobs=1000)
    rid=road(c,[[500,1500],[2000,1500]],kind='lane')
    far=road(c,[[500,1900],[2000,1900]])
    road(c,[[2000,1500],[2000,1900]])
    source=min((p for p in c.s['parcels'] if p['road']==rid and p['center'][1]>1500),key=lambda p:abs(p['center'][0]-750))
    home=min((p for p in c.s['parcels'] if p['road']==far and p['center'][1]>1900),key=lambda p:abs(p['center'][0]-750))
    job=min((p for p in c.s['parcels'] if p['road']==far and p['center'][1]>1900),key=lambda p:abs(p['center'][0]-1100))
    complete(c,source,'residential',10);source['rent']=1
    if alternative:complete(c,home,'residential',10);home['rent']=1
    complete(c,job,'office',20)
    for _ in range(households):
        c.s['households'].append(dict(id=c.uid('h'),home=source['id'],job=job['id'],size=3,income=6000,car=False,
            stress=0,unemployedMonths=0,burden=.1,commute=None,commuteFailed=False))
    c.rebuild();c.summarize()
    return c,rid,source,home,job


def cutting(source):
    x,y=Polygon(source['building']['footprint']).centroid.coords[0]
    return dict(type='road',kind='street',level=0,points=[[x-20,y],[x+20,y]],snap=False)


class RoadClearanceTests(unittest.TestCase):
    def test_preview_is_pure_and_reports_clearance(self):
        c,_,source,_,_=occupied_street()
        before=c.snapshot();runtime=copy.deepcopy(c.runtime());rng=c.rng.getstate()
        preview=c.preview_road(cutting(source))
        self.assertTrue(preview['valid'],preview)
        self.assertEqual(preview['clearance']['buildings'],1)
        self.assertEqual(preview['clearance']['households'],2)
        self.assertEqual(preview['clearance']['cost'],10000)
        self.assertEqual(c.snapshot(),before);self.assertEqual(c.runtime(),runtime);self.assertEqual(c.rng.getstate(),rng)

    def test_new_road_relocates_households_and_restores(self):
        c,_,source,home,job=occupied_street();old=source['building']['id']
        c.command(cutting(source))
        self.assertFalse(any(p.get('building',{}) and p['building']['id']==old for p in c.s['parcels']))
        self.assertTrue(all(h['home']==home['id'] and h['job']==job['id'] for h in c.s['households']))
        self.assertEqual(c.s['lastRoadClearance']['relocated'],6)
        self.assertEqual(c.s['movedOut'],0)
        surface=LineString(c.s['roads'][-1]['points']).buffer(ROAD_TYPES['street']['width']/2+2)
        self.assertFalse(any(surface.intersection(Polygon(p['building']['footprint'])).area>1 for p in c.s['parcels'] if p.get('building')))
        City.restore(c.snapshot())

    def test_upgrade_clears_widened_road_and_relocates(self):
        c,rid,source,home,_=occupied_street();old=source['building']['id']
        c.command(dict(type='road_update',id=rid,kind='avenue'))
        self.assertEqual(next(r for r in c.s['roads'] if r['id']==rid)['kind'],'avenue')
        self.assertFalse(any(p.get('building') and p['building']['id']==old for p in c.s['parcels']))
        self.assertTrue(all(h['home']==home['id'] for h in c.s['households']))
        City.restore(c.snapshot())

    def test_manual_road_edit_also_clears_but_automatic_builder_does_not(self):
        c,_,source,_,_=occupied_street()
        cmd=cutting(source);before=c.snapshot()
        with self.assertRaisesRegex(ValueError,'建筑'):c.add_road(cmd)
        self.assertEqual(c.snapshot(),before)
        rid=road(c,[[500,2300],[600,2300]])
        c.command(dict(cmd,type='road_edit',id=rid))
        self.assertEqual(c.s['roads'][-1]['id'],rid)
        self.assertEqual(c.s['lastRoadClearance']['buildings'],1)

    def test_limited_capacity_queues_unplaced_households_once(self):
        c,_,source,home,_=occupied_street();home['building']['capacity']=1
        c.command(cutting(source))
        self.assertEqual(len(c.s['households']),1)
        self.assertEqual(c.s['pendingHousing'],1)
        self.assertEqual(sum(row['count'] for row in c.s['migrationQueue']),1)
        self.assertEqual(c.s['lastRoadClearance']['relocated'],3)
        self.assertEqual(c.s['lastRoadClearance']['movedOut'],3)
        City.restore(c.snapshot())

    def test_unaffordable_homes_are_not_forced_on_residents(self):
        c,_,source,home,_=occupied_street();home['rent']=1000
        c.command(cutting(source))
        self.assertEqual(c.s['households'],[])
        self.assertEqual(c.s['pendingHousing'],2)
        self.assertEqual(c.s['movedOut'],6)
        self.assertTrue(all(not p['building'].get('employees') for p in c.s['parcels'] if p.get('building') and p['building']['use']=='office'))
        City.restore(c.snapshot())

    def test_failed_budget_and_protected_land_roll_back_everything(self):
        for protected in (False,True):
            with self.subTest(protected=protected):
                c,_,source,_,_=occupied_street()
                if protected:source['use']='protected'
                else:c.s['settings']['budget']=True;c.s['treasury']=10001
                before=c.snapshot();rng=c.rng.getstate()
                with self.assertRaises(ValueError):c.command(cutting(source))
                self.assertEqual(c.snapshot(),before);self.assertEqual(c.rng.getstate(),rng)

    def test_undo_and_redo_restore_people_buildings_and_queue(self):
        c,_,source,_,_=occupied_street(False)
        before=c.snapshot();c.command(cutting(source));after=c.snapshot()
        c.command(dict(type='undo'));restored=c.snapshot()
        for key in ('parcels','households','roads','firms','pendingHousing','migrationQueue','treasury','capitalAccounts'):
            self.assertEqual(restored['state'][key],before['state'][key])
        c.command(dict(type='redo'))
        for key in ('parcels','households','roads','pendingHousing','migrationQueue','treasury','capitalAccounts'):
            self.assertEqual(c.s[key],after['state'][key])
        City.restore(c.snapshot())

    def test_late_failure_restores_graphs_live_traffic_and_next_edit(self):
        c,_,source,_,_=occupied_street()
        advance(c,1)
        before=c.snapshot();graphs=copy.deepcopy(c.graphs)
        control=City.restore(before)
        with patch.object(c,'summarize',side_effect=RuntimeError('after road rebuild')):
            with self.assertRaisesRegex(RuntimeError,'after road rebuild'):
                c.command(cutting(source))
        self.assertEqual(c.snapshot(),before)
        self.assertEqual(c.graphs,graphs)
        self.assertIs(c.live_traffic.city,c)
        for p in c.s['parcels']:self.assertIs(c.parcelmap[p['id']],p)
        for edge in c.network['edges']:self.assertIs(c.edge_map[edge['id']],edge)
        # A failed transaction must also leave a usable city for the next edit.
        command=cutting(source)
        c.command(command);control.command(command)
        self.assertEqual(c.snapshot(),control.snapshot())

    def test_employer_moves_to_same_use_building_or_closes(self):
        for relocate in (False,True):
            with self.subTest(relocate=relocate):
                c,_,source,_,job=occupied_street()
                target=next(p for p in c.s['parcels'] if p['road']==job['road'] and not p.get('building') and abs(p['center'][0]-1400)<20)
                if relocate:complete(c,target,'office',20)
                c.s['firms'].append(dict(id='firm-test',parcel=job['id'],industry='office',status='active',opened=0,employees=2,relocations=0,lossMonths=0))
                old_job=job['id'];c.command(cutting(job))
                firm=next(f for f in c.s['firms'] if f['id']=='firm-test')
                self.assertEqual(firm['status'],'active' if relocate else 'closed')
                if relocate:
                    self.assertEqual(firm['parcel'],target['id'])
                    self.assertTrue(all(h['job']==target['id'] for h in c.s['households']))
                self.assertFalse(any(h.get('job')==old_job for h in c.s['households']))
                City.restore(c.snapshot())

    def test_road_interrupts_renewal_without_future_building_on_road(self):
        c,plots=neighborhood();project=begin(c,plots[0],mode='renovate')
        source=plots[0];old=source['building']['id'];cmd=cutting(source)
        c.command(cmd)
        self.assertEqual(project['status'],'cancelled')
        self.assertFalse(any(p.get('renewalProject')==project['id'] for p in c.s['parcels']))
        c.s['month']+=12;c.complete_projects()
        self.assertFalse(any(p.get('building') and p['building']['id']==old for p in c.s['parcels']))
        City.restore(c.snapshot())

    def test_elevated_road_does_not_demolish_ground_homes(self):
        c,_,source,_,_=occupied_street();old=source['building']['id']
        c.command(dict(cutting(source),level=1))
        self.assertTrue(any(p.get('building') and p['building']['id']==old for p in c.s['parcels']))
        self.assertEqual(len(c.s['households']),2)

    def test_station_clearance_removes_owned_stop_and_invalidates_line(self):
        c=City(flat_world());c.s['settings']['autoGrow']=False
        road(c,[[500,1000],[3300,1000]],kind='train')
        road(c,[[500,1120],[3300,1120]])
        for x in (1000,2400):c.command(dict(type='special_building',kind='train_station',point=[x,1020]))
        a,b=c.s['facilities']
        c.command(dict(type='line',mode='train',stops=[a['stop'],b['stop']]))
        c.command(dict(type='road',kind='street',points=[[900,1030],[1100,1030]],snap=False))
        self.assertNotIn(a['id'],[f['id'] for f in c.s['facilities']])
        self.assertNotIn(a['stop'],[s['id'] for s in c.s['stops']])
        self.assertFalse(c.s['lines'][0]['valid'])
        City.restore(c.snapshot())


if __name__=='__main__':unittest.main()
