#!/usr/bin/env python3
"""Plot measured Stage J observations; never supplies synthetic observations."""
import argparse,json,os,tempfile
cache=tempfile.TemporaryDirectory(prefix="nexora-matplotlib-")
os.environ.setdefault("MPLCONFIGDIR",cache.name)
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
p=argparse.ArgumentParser();p.add_argument('root');p.add_argument('output');a=p.parse_args()
r=json.loads((Path(a.root)/'analysis.json').read_text());calls=r['calls']
fig,ax=plt.subplots(1,3,figsize=(16,5),layout='constrained')
fixtures=list(dict.fromkeys(c['fixture']for c in calls));colors={'stage16f':'#1768ac','stage16h':'#ca5b25'}
for i,f in enumerate(fixtures):
 for ki,k in enumerate(colors):
  values=[c['coreMs']for c in calls if c['fixture']==f and c['key']==k and c['condition']=='control'];x=i+(ki-.5)*.27
  ax[0].scatter([x+(j-len(values)/2)*.007 for j in range(len(values))],values,c=colors[k],s=23,alpha=.75,label=k if i==0 else None)
ax[0].set(xticks=range(len(fixtures)),xticklabels=[f.replace('-1024','\n1024').replace('-512','\n512')for f in fixtures],ylabel='Binding elapsed ms',title='Original callback: all 90 calls\n3 independent browser processes')
ax[0].axhline(2000,color='#9d1235',ls='--',lw=1);ax[0].legend();ax[0].tick_params(axis='x',labelsize=8)
profiled=[c for c in calls if c['condition']=='profiled'and c['fixture']=='wave-1024'and c['key']=='stage16h'];slow=max(profiled,key=lambda c:c['coreMs']);fast=min(profiled,key=lambda c:c['coreMs'])
family_colors=plt.cm.tab10.colors
families=list(dict.fromkeys(list(slow['families'])+list(fast['families'])))
for j,c in enumerate([fast,slow]):
 left=0
 for i,f in enumerate(families):
  val=c['families'].get(f,0);ax[1].barh(j,val,left=left,color=family_colors[i%10],label=f.replace('_',' ')if j==0 else None);left+=val
ax[1].set(yticks=[0,1],yticklabels=['Fast '+fast['id'].split('-profiled')[0],'Slow '+slow['id'].split('-profiled')[0]],xlabel='Sampled wall-interval weight ms',title='Same H binary, same Wave input/SVG\nDisjoint stack-family attribution')
ax[1].tick_params(axis='y',labelsize=7);ax[1].legend(fontsize=6,loc='lower right',ncol=2)
for j,c in enumerate([fast,slow]):
 lo,hi=c['cpu']['cpuLowerMs'],c['cpu']['cpuUpperMs'];wlo,whi=c['cpu']['waitLowerMs'],c['cpu']['waitUpperMs'];ax[2].barh(j-.16,hi,height=.28,color='#1768ac',label='Kernel scheduled CPU upper bound'if j==0 else None);ax[2].plot([lo,hi],[j-.16,j-.16],c='black',lw=2);ax[2].barh(j+.16,whi,height=.28,color='#ca5b25',label='Runqueue upper bound'if j==0 else None);ax[2].text(max(hi,whi)+30,j,f'wall {c["coreMs"]:.1f} ms',fontsize=8)
ax[2].set(yticks=[0,1],yticklabels=['Fast','Slow'],xlabel='Kernel schedstat ms',title='Per-call kernel read-window bounds\nNo elapsed-as-CPU substitution');ax[2].set_xlim(0,max(c['coreMs']for c in [fast,slow])*1.25);ax[2].legend(fontsize=7)
for x in ax:x.grid(axis='x',alpha=.2);x.set_axisbelow(True)
fig.suptitle('Stage 1.6J — stalls reproduced; dominant mechanism remains unresolved',fontsize=14)
base=Path(a.output);base.parent.mkdir(parents=True,exist_ok=True);fig.savefig(str(base)+'.png',dpi=160);fig.savefig(str(base)+'.svg')
