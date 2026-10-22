"""Prepare an isolated monthly transaction while the visible calendar advances.

Only completed results may replace authoritative state. The child process has
no save directory or service access; edits invalidate its revision, and a
failed/cancelled preparation cannot publish partially computed economics.
"""
import copy
import multiprocessing
import threading
import time
from collections import OrderedDict

from .simulation import DAY, MAX_STEP, month_days


def prepare_month(city, connection):
    try:
        last_time=0.;last_fraction=0.
        def progress(fraction,label):
            nonlocal last_time,last_fraction
            fraction=max(last_fraction,.03+.96*fraction)
            now=time.monotonic()
            if now-last_time>=.05 or fraction>=.99:
                connection.send(('progress',(fraction,label)))
                last_time=now;last_fraction=fraction
        city._monthly_progress=progress
        city.step(advance_clock=False,return_view=False)
        view=city.view()
        # Return the ready network, avoiding a costly rebuild on the UI request.
        # Derived search caches and the unchanged terrain need not cross IPC.
        city.__dict__.pop('_monthly_progress',None)
        city.__dict__.pop('_housing_commutes',None)
        city.route_cache={};city.route_solutions={}
        city.surface_journeys=OrderedDict();city.surface_journey_edges=0
        city.terrain=None
        connection.send(('result',(city,view)))
    except Exception as exc:
        try:connection.send(('error',str(exc)))
        except (BrokenPipeError,EOFError,OSError):pass
    finally:connection.close()


class Preparation:
    def __init__(self, city):
        self.city=city
        self.signature=(city.s['revision'],city.s['month'])
        self.start=city.s['simulation']['monthSeconds']
        self.progress=(0.,'准备月内计算')
        self.result=None;self.error=None
        self.cancelled=threading.Event()
        # Copy the current derived graphs as well as authoritative state. A
        # save/restore here would rebuild newly developed entrances early and
        # could change the next month's growth decisions versus direct step().
        draft=copy.copy(city)
        draft.__dict__=dict(city.__dict__)
        draft.__dict__.pop('_housing_commutes',None)
        draft.live_traffic=None;draft.undo=[];draft.redo=[]
        draft.route_cache={};draft.route_solutions={}
        draft.surface_journeys=OrderedDict();draft.surface_journey_edges=0
        draft=copy.deepcopy(draft)
        context=multiprocessing.get_context('spawn')
        self.receiver,sender=context.Pipe(duplex=False)
        self.process=context.Process(target=prepare_month,args=(draft,sender),daemon=True)
        # Starting a spawned process serializes its input. Keep that IPC and
        # result decoding off the request thread as well as the actual solve.
        self.thread=threading.Thread(target=self._receive,args=(sender,),daemon=True)
        self.thread.start()

    def _receive(self,sender):
        try:
            if self.cancelled.is_set():return
            self.process.start()
            sender.close()
            if self.cancelled.is_set():self.process.terminate();return
            while True:
                kind,value=self.receiver.recv()
                if self.cancelled.is_set():return
                if kind=='progress':self.progress=value
                elif kind=='result':
                    prepared,view=value
                    self.view=view;self.result=prepared
                    return
                else:self.error=value;return
        except Exception as exc:
            if not self.cancelled.is_set():self.error='月内计算进程中断：'+str(exc)
        finally:
            sender.close();self.receiver.close()
            if self.process.pid is not None:
                self.process.join(timeout=.2)
                if self.process.is_alive():self.process.terminate();self.process.join(timeout=.2)

    def matches(self,city):
        return self.city is city and self.signature==(city.s['revision'],city.s['month'])

    def cancel(self):
        self.cancelled.set()
        if self.process.pid is not None and self.process.is_alive():self.process.terminate()

    def allowance(self,city,seconds):
        duration=month_days(city.s['month'])*DAY
        fraction=1. if self.result is not None else self.progress[0]
        available=self.start+(duration-self.start)*fraction-city.s['simulation']['monthSeconds']
        # At most one day / one monthly commit per response. Unused requested
        # time is returned to the driver's backlog, never silently discarded.
        return min(seconds,DAY,max(0.,available))

    def commit(self,city):
        if not self.matches(city) or self.result is None:
            raise ValueError('月内计算结果已失效')
        prepared=self.result
        terrain=city.terrain
        # These fields may change while economics is prepared (sun scrubbing,
        # manual naming, saving); they are not monthly economic inputs.
        for key in ('simulation','sceneTimeSeconds','name','saveGroup'):
            if key in city.s:prepared.s[key]=city.s[key]
        city.__dict__.update(prepared.__dict__)
        city.__dict__.pop('_housing_commutes',None)
        city.terrain=terrain
        return getattr(self,'view',None)

    def status(self):
        return dict(progress=1. if self.result is not None else self.progress[0],
                    stage='结算已准备' if self.result is not None else self.progress[1],
                    pending=self.result is None)


def advance_incremental(service,city,payload):
    from .simulation import advance
    from .engine import number
    # Validate before creating a process or accepting any calendar time.
    seconds=number(payload.get('seconds',0),0,MAX_STEP,'模拟时长')
    speed=payload.get('speed',city.s['simulation']['speed'])
    from .simulation import SPEEDS
    if type(speed) not in (int,float) or speed not in SPEEDS:raise ValueError('未知模拟速度')
    mode=payload.get('mode','observed');reset=payload.get('reset',False)
    if mode not in ('observed','test') or type(reset) is not bool:raise ValueError('无效的交通设置')
    daylight=payload.get('daylightSeconds',seconds if speed<DAY else seconds/speed)
    daylight=number(daylight,0,MAX_STEP,'光照推进时长')
    job=service.preparation
    if job is not None and not job.matches(city):
        job.cancel();job=service.preparation=None
    if job is None and seconds:
        job=service.preparation=Preparation(city)
    if job is not None and job.error:
        error=job.error;job.cancel();service.preparation=None
        raise ValueError('月内计算失败，城市结算尚未提交：'+error)
    accepted=job.allowance(city,seconds) if job else seconds
    try:result=advance(city,accepted,speed,mode,reset,daylight,settlement=job.commit if job else None)
    except Exception:
        # A failed commit may have touched the returned object's RNG/runtime.
        # The transaction restores the visible city; never reuse that result.
        if job:job.cancel()
        service.preparation=None
        raise
    result['advancedSeconds']=accepted
    result['settlement']=job.status() if job else None
    if result['monthsAdvanced']:
        service.preparation=None
        result['settlement']=None
    return result
