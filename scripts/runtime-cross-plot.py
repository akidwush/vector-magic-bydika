# Optional report rendering only; requires installed Matplotlib, not an app dependency.
import os, sys, json
os.environ.setdefault('MPLCONFIGDIR','/tmp/nexora-stage16i-mpl')
os.environ.setdefault('XDG_CACHE_HOME','/tmp/nexora-stage16i-fonts')
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
if len(sys.argv)<2:raise SystemExit('Usage: runtime-cross-plot.py ANALYSIS_DIRECTORY [OUTPUT_PNG]')
analysis=Path(sys.argv[1])
rs=json.loads((analysis/'attribution.json').read_text())
rows=[r for r in rs if r['fixture']=='wave-1024']
fig,ax=plt.subplots(1,2,figsize=(11,4.6))
colors={'worker':'#2679a4','direct':'#d26d36','app':'#42966b'}
labels=[];values=[]
for mode in ['worker','direct','app']:
 for build in ['stage16f','stage16h']:
  a=[r['coreMs'] for r in rows if r['mode']==mode and r['buildId']==build];values.append(a);labels.append(mode+'\n'+build[-1].upper())
ax[0].boxplot(values,tick_labels=labels,whis=(0,100),showfliers=True)
ax[0].set_yscale('log');ax[0].set_ylabel('Binding elapsed (ms, log scale)');ax[0].set_title('Same source and exact binaries across pathways')
for mode in colors:
 a=[r for r in rows if r['mode']==mode and r['attribution']['execution']]
 ax[1].scatter([r['coreMs'] for r in a],[r['attribution']['execution']['cpuMs'] for r in a],s=18,alpha=.65,label=mode,color=colors[mode])
ax[1].plot([500,12000],[500,12000],color='gray',linestyle='--',linewidth=1)
ax[1].set_xscale('log');ax[1].set_yscale('log');ax[1].set_xlabel('Binding elapsed (ms)');ax[1].set_ylabel('Execution-thread CPU envelope (ms)');ax[1].set_title('Slow calls consume CPU and also wait');ax[1].legend()
for a in ax:a.grid(alpha=.2)
fig.suptitle('Stage 1.6I: Wave 1024 — all 180 first/warm/reset calls retained')
fig.text(.01,.01,'Three browser processes, two context slots. Calls within a session are not independent sessions.\nCPU envelopes include surrounding work; new Worker threads can lack a before-snapshot. No outliers removed.',fontsize=8)
fig.tight_layout(rect=(0,.08,1,.94))
output=Path(sys.argv[2] if len(sys.argv)>2 else 'docs/evidence/stage16i/runtime-forensics.png')
output.parent.mkdir(parents=True,exist_ok=True)
fig.savefig(output,dpi=180)
