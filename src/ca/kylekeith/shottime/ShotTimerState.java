package ca.kylekeith.shottime;

/** Immutable countdown snapshot; all time arithmetic uses elapsedRealtime milliseconds. */
public final class ShotTimerState {
    public static final long MAX_SECONDS=7*24*60*60;
    public final String id,label,detail,phase;
    public final long duration,remaining,deadline,revision;
    public final int boot;
    public ShotTimerState(String id,String label,String detail,String phase,long duration,long remaining,long deadline,long revision,int boot){
        this.id=id;this.label=label;this.detail=detail;this.phase=phase;this.duration=duration;this.remaining=remaining;this.deadline=deadline;this.revision=revision;this.boot=boot;
    }
    public static ShotTimerState ready(String id,String label,String detail,long seconds,int boot){
        if(seconds<1||seconds>MAX_SECONDS)throw new IllegalArgumentException("Timer supports 1 second to 7 days.");
        return new ShotTimerState(id,label,detail,"ready",seconds*1000,seconds*1000,0,0,boot);
    }
    public long left(long now){return "running".equals(phase)?Math.max(0,deadline-now):remaining;}
    public String token(){return id+":"+revision;}
    private ShotTimerState change(String phase,long left,long deadline){return new ShotTimerState(id,label,detail,phase,duration,left,deadline,revision+1,boot);}
    public ShotTimerState start(long now){if(!phase.equals("ready")&&!phase.equals("paused"))return this;return change("running",remaining,Math.addExact(now,remaining));}
    public ShotTimerState pause(long now){if(!phase.equals("running"))return this;long n=left(now);return change(n==0?"finished":"paused",n,0);}
    public ShotTimerState finish(long now){return phase.equals("running")&&left(now)==0?change("finished",0,0):this;}
    public ShotTimerState reset(){return change("ready",duration,0);}
    public ShotTimerState interrupt(){return change("interrupted",remaining,0);}
    public ShotTimerState recover(int currentBoot,long now){if(boot!=currentBoot)return phase.equals("running")||phase.equals("paused")?interrupt():this;return finish(now);}
    public static String format(long millis){long n=(Math.max(0,millis)+999)/1000;return n>=3600?String.format(java.util.Locale.ROOT,"%02d:%02d:%02d",n/3600,n/60%60,n%60):String.format(java.util.Locale.ROOT,"%02d:%02d",n/60,n%60);}
}
