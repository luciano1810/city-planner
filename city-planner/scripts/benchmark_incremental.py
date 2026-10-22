"""Measure bounded simulation requests using a copy and temporary autosaves."""
import argparse
import gzip
import json
from pathlib import Path
import sys
import tempfile
import time

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from city.engine import City
from city.service import CityService
from city.simulation import DAY


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--snapshot',required=True)
    parser.add_argument('--months',type=int,default=2)
    parser.add_argument('--output',required=True)
    parser.add_argument('--reference-prefix',help='Optional PREFIX-0-expected.json.gz monthly reference snapshots')
    parser.add_argument('--verify',action='store_true',help='Generate synchronous references with the current rules before timing')
    args=parser.parse_args()
    with gzip.open(args.snapshot,'rt') as handle:city=City.restore(json.load(handle))
    report=dict(initialMonth=city.s['month'],households=len(city.s['households']),parcels=len(city.s['parcels']),months=[])
    references=[]
    if args.verify:
        reference=City.restore(city.snapshot())
        for index in range(args.months):
            reference.step(advance_clock=False,return_view=False)
            references.append(json.loads(json.dumps(reference.snapshot())))
            print(f'Synchronous reference {index+1} ready',flush=True)
    with tempfile.TemporaryDirectory() as folder:
        service=CityService(folder);service.cities['benchmark']=city
        try:
            for index in range(args.months):
                start_month=city.s['month'];started=time.perf_counter();samples=[];stages=set();days=set()
                while city.s['month']==start_month:
                    if time.perf_counter()-started>180:raise TimeoutError('monthly preparation did not finish')
                    before=time.perf_counter()
                    result=service.handle('simulate',dict(id='benchmark',seconds=31*DAY,speed=2592000,
                        daylightSeconds=.1,incremental=True))
                    samples.append(time.perf_counter()-before)
                    if result.get('settlement'):stages.add(result['settlement']['stage'])
                    days.add(int(result['simulation']['monthSeconds']//DAY))
                    if not result['monthsAdvanced']:time.sleep(.1)
                if args.reference_prefix or args.verify:
                    if args.verify:expected=references[index]
                    else:
                        with gzip.open(f'{args.reference_prefix}-{index}-expected.json.gz','rt') as handle:expected=json.load(handle)
                    actual=json.loads(json.dumps(city.snapshot()))
                    for key in actual['state']:
                        if key not in ('simulation','sceneTimeSeconds'):
                            assert actual['state'][key]==expected['state'][key],key
                    assert actual['random']==expected['random'],'random state'
                    for key in ('trips','edges','paths'):assert actual['runtime'][key]==expected['runtime'][key],key
                ordered=sorted(samples)
                row=dict(month=city.s['month'],wallSeconds=round(time.perf_counter()-started,3),requests=len(samples),
                         medianMs=round(ordered[len(ordered)//2]*1000,2),p95Ms=round(ordered[int(len(ordered)*.95)]*1000,2),
                         maximumMs=round(max(samples)*1000,2),commitMs=round(samples[-1]*1000,2),
                         daysVisited=len(days),stages=sorted(stages),referenceMatches=bool(args.reference_prefix or args.verify))
                report['months'].append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
        finally:service.close()
    Path(args.output).parent.mkdir(parents=True,exist_ok=True)
    Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')


if __name__=='__main__':main()
