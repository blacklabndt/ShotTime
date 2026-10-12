package ca.kylekeith.shottime;
public final class ShotTimerStateTest {
    static void check(boolean value){if(!value)throw new AssertionError();}
    public static void main(String[] args){
        ShotTimerState s=ShotTimerState.ready("a","6 STD","External",165,1);
        check(s.left(100)==165000);s=s.start(1000);check(s.deadline==166000);
        check(s.left(32000)==134000);String token=s.token();s=s.pause(32000);check(!token.equals(s.token()));check(s.left(999999)==134000);
        s=s.start(500000);check(s.left(501000)==133000);check(s.finish(501000)==s);
        s=s.finish(700000);check(s.phase.equals("finished"));check(s.finish(800000)==s);
        check(s.recover(2,0).phase.equals("finished"));
        s=s.reset();check(s.remaining==165000&&s.phase.equals("ready"));
        s=s.start(1);check(s.recover(2,2).phase.equals("interrupted"));check(s.recover(1,2).phase.equals("running"));
        check(s.recover(1,900000).phase.equals("finished"));
        check(ShotTimerState.format(165000).equals("02:45"));check(ShotTimerState.format(164001).equals("02:45"));check(ShotTimerState.format(3600000).equals("01:00:00"));
        for(long v:new long[]{0,-1,604801,Long.MAX_VALUE}){try{ShotTimerState.ready("a","b","c",v,1);throw new AssertionError();}catch(IllegalArgumentException expected){}}
        check(ShotTimerState.ready("a","b","c",604800,1).duration==604800000);
        System.out.println("PASS: countdown deadlines, pause/resume, reset, stale tokens, recovery, rounding and bounds");
    }
}
