package ca.kylekeith.shottime;
/** Lifecycle rules shared by the floating window and its foreground service. */
final class ShotTimerDisplay {
    static boolean keepService(String phase,boolean floating,boolean minimized,boolean acknowledged){
        if(phase==null)return false;
        if(phase.equals("running")||phase.equals("paused"))return true;
        if(phase.equals("finished"))return !acknowledged||(floating&&!minimized);
        return phase.equals("ready")&&floating&&!minimized;
    }
}
