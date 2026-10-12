package ca.kylekeith.shottime;
import android.content.*;
public final class ShotTimerAlarmReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c,Intent i){
        ShotTimer t=ShotTimer.get(c);
        if(Intent.ACTION_TIME_CHANGED.equals(i.getAction())){t.clockChanged();return;}
        if(!"finish".equals(i.getAction())||t.state==null||!t.state.phase.equals("running")||!t.state.token().equals(i.getStringExtra("token")))return;
        try{c.startForegroundService(new Intent(c,ShotTimerService.class).setAction("alarm").putExtra("token",t.state.token()));}catch(Exception e){t.alarm(i.getStringExtra("token"));}
    }
}
