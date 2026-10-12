package ca.kylekeith.shottime;
import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
public final class ShotTimerService extends Service {
    static boolean active;
    private final BroadcastReceiver screen=new BroadcastReceiver(){public void onReceive(Context c,Intent i){ShotTimer.get(c).serviceReady();}};
    @Override public IBinder onBind(Intent i){return null;}
    @Override public void onCreate(){super.onCreate();IntentFilter f=new IntentFilter(Intent.ACTION_SCREEN_OFF);f.addAction(Intent.ACTION_USER_PRESENT);f.addAction(Intent.ACTION_CONFIGURATION_CHANGED);if(Build.VERSION.SDK_INT>=33)registerReceiver(screen,f,Context.RECEIVER_NOT_EXPORTED);else registerReceiver(screen,f);}
    @Override public int onStartCommand(Intent i,int flags,int id){
        ShotTimer t=ShotTimer.get(this);
        try{if(Build.VERSION.SDK_INT>=34)startForeground(ShotTimer.ONGOING,t.notification(),ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);else startForeground(ShotTimer.ONGOING,t.notification());active=true;}
        catch(Exception e){t.failed();stopSelf();return START_NOT_STICKY;}
        if(i!=null){String action=i.getAction(),token=i.getStringExtra("token");if("alarm".equals(action))t.alarm(token);else if(!"activate".equals(action))t.action(action==null?"":action,token==null?"":token);}
        t.reconcile();
        if(!t.keepService()){stopSelf();return START_NOT_STICKY;}
        t.serviceReady();return START_STICKY;
    }
    @Override public void onDestroy(){active=false;try{unregisterReceiver(screen);}catch(Exception ignored){}stopForeground(STOP_FOREGROUND_REMOVE);ShotTimer.get(this).serviceGone();super.onDestroy();}
}
