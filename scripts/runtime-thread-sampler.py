#!/usr/bin/env python3
"""Bounded, read-only task sampling. Hardware events are never synthesized."""
import argparse, ctypes, errno, json, os, platform, resource, select, struct, sys, time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--pid',type=int,required=True);p.add_argument('--tid',type=int,required=True);p.add_argument('--output',required=True);p.add_argument('--seconds',type=float,default=90);p.add_argument('--interval',type=float,default=.002);a=p.parse_args()
if not(0.001<=a.interval<=.1 and 0<a.seconds<=180):raise SystemExit('bounded sampling only')
libc=ctypes.CDLL(None,use_errno=True);libc.syscall.restype=ctypes.c_long
nr={'x86_64':298,'aarch64':241}.get(platform.machine());fds={};cap={}
for name,typ,config in [('cycles',0,0),('instructions',0,1),('cache_misses',0,3),('context_switches',1,3)]:
 if nr is None:cap[name]={'available':False,'reason':'unsupported syscall architecture'};continue
 attr=ctypes.create_string_buffer(128)
 # No sampling interrupts. Read raw value/time-enabled/time-running; user space only.
 struct.pack_into('IIQQQQQ',attr,0,typ,128,config,0,0,3,(1<<5)|(1<<6))
 fd=libc.syscall(nr,ctypes.byref(attr),a.tid,-1,-1,0)
 if fd<0:
  e=ctypes.get_errno();cap[name]={'available':False,'errno':e,'reason':os.strerror(e)}
 else:fds[name]=fd;cap[name]={'available':True,'type':typ,'config':config,'exclude_kernel':True,'exclude_hv':True,'read_format':'value,time_enabled,time_running'}
print(json.dumps({'ready':True,'pid':a.pid,'tid':a.tid,'hardware':cap}),flush=True)
start=time.monotonic_ns();usage=resource.getrusage(resource.RUSAGE_SELF);rows=[];system=[];end_reason='budget';last_system=0
try:
 while time.monotonic_ns()-start < int(a.seconds*1e9):
  before=time.monotonic_ns()
  try:
   values=Path(f'/proc/{a.pid}/task/{a.tid}/schedstat').read_text().split();cpu,wait=int(values[0]),int(values[1]);runs=int(values[2])
  except (OSError,ValueError,IndexError):end_reason='task-unavailable';break
  hw={}
  for name,fd in fds.items():
   try:hw[name]=list(struct.unpack('QQQ',os.read(fd,24)))
   except OSError as e:hw[name]={'error':e.errno}
  after=time.monotonic_ns();rows.append({'loUs':before/1000,'hiUs':after/1000,'cpuNs':cpu,'waitNs':wait,'runs':runs,'hardware':hw})
  if before-last_system>=20_000_000:
   record={'atUs':after/1000}
   for name in ['cpu.stat','cpu.pressure','memory.current','memory.events']:
    try:record[name]=(Path('/sys/fs/cgroup')/name).read_text()
    except OSError:record[name]=None
   system.append(record);last_system=before
  ready,_,_=select.select([sys.stdin],[],[],a.interval)
  if ready:
   sys.stdin.readline();end_reason='stopped';break
finally:
 for fd in fds.values():os.close(fd)
stop=resource.getrusage(resource.RUSAGE_SELF)
result={'schema':1,'pid':a.pid,'tid':a.tid,'clock':'CLOCK_MONOTONIC microseconds','intervalSeconds':a.interval,'maxSeconds':a.seconds,'reason':end_reason,'hardwareCapabilities':cap,'observerCpuMs':((stop.ru_utime-usage.ru_utime)+(stop.ru_stime-usage.ru_stime))*1000,'samples':rows,'system':system,'policy':'CPU and wait are cumulative kernel schedstat, not elapsed-time estimates. Hardware triples are raw; multiplexing is not hidden. Serialization happens after capture.'}
Path(a.output).write_text(json.dumps(result))
