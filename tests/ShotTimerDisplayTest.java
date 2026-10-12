package ca.kylekeith.shottime;
public final class ShotTimerDisplayTest {
    static void check(boolean value){if(!value)throw new AssertionError();}
    public static void main(String[] args){
        check(ShotTimerDisplay.keepService("ready",true,false,false));
        check(!ShotTimerDisplay.keepService("ready",false,false,false));
        check(!ShotTimerDisplay.keepService("ready",true,true,false));
        check(ShotTimerDisplay.keepService("running",false,true,false));
        check(ShotTimerDisplay.keepService("paused",true,false,false));
        check(!ShotTimerDisplay.keepService(null,true,false,false));
        check(ShotTimerDisplay.keepService("finished",true,false,true));
        check(!ShotTimerDisplay.keepService("finished",true,true,true));
        check(!ShotTimerDisplay.keepService("finished",false,false,true));
        check(ShotTimerDisplay.keepService("finished",true,false,false));
        check(!ShotTimerDisplay.keepService("interrupted",true,false,false));
        System.out.println("PASS: floating ready timer lifetime, minimized cleanup, active countdown and acknowledgement");
    }
}
