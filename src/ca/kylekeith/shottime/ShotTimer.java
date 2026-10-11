package ca.kylekeith.shottime;

import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import java.lang.ref.WeakReference;
import java.util.UUID;

/** Main-thread timer coordinator; Activity, receiver and service use the same persisted state. */
final class ShotTimer {
    static final int PERMISSION=430,ONGOING=430,DONE=431;
    private static ShotTimer singleton;
    static ShotTimer get(Context c){if(singleton==null)singleton=new ShotTimer(c.getApplicationContext());return singleton;}
    final Context context;
    ShotTimerState state;
    private WeakReference<Activity> activity=new WeakReference<>(null);
    private final Handler handler=new Handler(Looper.getMainLooper());
    private ShotTimerCard card;
    private WindowManager windows;
    private WindowManager.LayoutParams overlayParams;
    private boolean overlay,minimized,acknowledged;
    private String error="";
    private long finishedAt;
    private final Runnable tick=new Runnable(){public void run(){
        reconcile();if(card!=null&&state!=null)card.update(state,acknowledged,error);
        if(state!=null&&state.phase.equals("finished")&&finishedAt>0&&SystemClock.elapsedRealtime()-finishedAt>=60000){minimized=activity.get()==null;stopService();show();finishedAt=0;}
        if(card!=null||ShotTimerService.active)handler.postDelayed(this,card!=null?200:10000);
    }};
    private ShotTimer(Context c){context=c;try{state=ShotTimerStore.read(c);if(state!=null&&state.boot!=ShotTimerStore.boot(c)){state=state.phase.equals("ready")?ShotTimerState.ready(state.id,state.label,state.detail,state.duration/1000,ShotTimerStore.boot(c)):state.recover(ShotTimerStore.boot(c),SystemClock.elapsedRealtime());ShotTimerStore.write(c,state);}}catch(Exception e){error=e.getMessage();}channels();}
    void attach(Activity a){activity=new WeakReference<>(a);if(state!=null&&state.phase.equals("running")&&!exactAllowed()){cancelAlarm(state);save(state.interrupt());error="Alarm permission was removed. Reset the timer.";}ensureFloatingService();show();poll();}
    void detach(Activity a){if(activity.get()==a){activity.clear();show();}}
    private void poll(){handler.removeCallbacks(tick);handler.post(tick);}
    private boolean save(ShotTimerState s){if(!ShotTimerStore.write(context,s)){error="Could not save timer. Free some storage and try again.";notice(error);return false;}state=s;return true;}
    private void notice(String text){Toast.makeText(context,text,Toast.LENGTH_LONG).show();}
    void prepare(Activity a,Uri uri){
        try{
            if(!"shottime".equals(uri.getScheme())||!"timer".equals(uri.getHost())||!"/prepare".equals(uri.getPath())||uri.getFragment()!=null||uri.toString().length()>1000)throw new IllegalArgumentException();
            if(!uri.getQueryParameterNames().equals(new java.util.HashSet<>(java.util.Arrays.asList("seconds","label","detail"))))throw new IllegalArgumentException();
            for(String k:uri.getQueryParameterNames())if(uri.getQueryParameters(k).size()!=1)throw new IllegalArgumentException();
            String text=uri.getQueryParameter("seconds"),label=uri.getQueryParameter("label"),detail=uri.getQueryParameter("detail");
            if(text==null||!text.matches("[0-9]{1,6}")||label==null||detail==null||label.length()>80||detail.length()>120||label.matches("(?s).*[\\p{Cntrl}].*")||detail.matches("(?s).*[\\p{Cntrl}].*"))throw new IllegalArgumentException();
            final ShotTimerState next=ShotTimerState.ready(UUID.randomUUID().toString(),label,detail,Long.parseLong(text),ShotTimerStore.boot(context));
            if(state!=null&&(state.phase.equals("running")||state.phase.equals("paused"))){
                if(state.label.equals(label)&&state.detail.equals(detail)&&state.duration==next.duration){minimized=false;show();return;}
                final String token=state.token();new AlertDialog.Builder(a).setTitle("Replace current timer?").setMessage(state.label+" · "+ShotTimerState.format(state.left(SystemClock.elapsedRealtime()))+" remaining").setNegativeButton("Keep timer",null).setPositiveButton("Replace",(d,w)->{if(state!=null&&state.token().equals(token))replace(next);else notice("Timer changed. Tap the shot time again.");}).show();
            }else replace(next);
        }catch(Exception e){notice("This time cannot start a timer. Choose a time from 1 second to 7 days.");}
    }
    private void replace(ShotTimerState next){ShotTimerState old=state;if(!save(next))return;cancelAlarm(old);manager().cancel(DONE);minimized=false;acknowledged=false;error="";finishedAt=0;if(!keepService())stopService();else ensureFloatingService();show();updateNotification();poll();requestOverlayPermission();}
    void open(){minimized=false;ensureFloatingService();show();poll();}
    void minimize(){minimized=true;show();if(!keepService())stopService();if(state!=null&&(state.phase.equals("ready")||state.phase.equals("interrupted")))notice("Tap a shot time to reopen the timer.");}
    void action(String command,String token){
        if(state==null||!state.token().equals(token))return;
        if(command.equals("start")){start();return;}
        if(command.equals("restart")){if(!state.phase.equals("paused"))return;ShotTimerState next=ShotTimerState.ready(UUID.randomUUID().toString(),state.label,state.detail,state.duration/1000,ShotTimerStore.boot(context));replace(next);if(state==next)start();return;}
        if(command.equals("pause")){reconcile();if(state==null||!state.phase.equals("running"))return;ShotTimerState old=state;if(save(state.pause(SystemClock.elapsedRealtime())))cancelAlarm(old);}
        else if(command.equals("reset")){replace(ShotTimerState.ready(UUID.randomUUID().toString(),state.label,state.detail,state.duration/1000,ShotTimerStore.boot(context)));return;}
        else if(command.equals("close")){ShotTimerState old=state;if(!save(null))return;cancelAlarm(old);manager().cancel(DONE);stopService();}
        else if(command.equals("ack")){acknowledged=true;finishedAt=0;manager().cancel(DONE);if(!keepService())stopService();else ensureFloatingService();}
        show();updateNotification();poll();
    }
    private boolean exactAllowed(){return Build.VERSION.SDK_INT<31||alarms().canScheduleExactAlarms();}
    private void start(){
        if(state==null||!(state.phase.equals("ready")||state.phase.equals("paused")))return;
        Activity a=activity.get();
        if(Build.VERSION.SDK_INT>=33&&context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){
            if(a!=null){notice("Allow notifications for timer controls and the completion alarm, then press Start.");a.requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},PERMISSION);}else notice("Open RT Handbook to enable timer notifications.");return;
        }
        if(!manager().areNotificationsEnabled()||manager().getNotificationChannel("shot_timer_done").getImportance()==NotificationManager.IMPORTANCE_NONE){
            if(a!=null)new AlertDialog.Builder(a).setTitle("Enable timer notifications").setMessage("Notifications provide background controls and the completion alarm. Enable them, then press Start.").setNegativeButton("Cancel",null).setPositiveButton("Settings",(d,w)->a.startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,context.getPackageName()))).show();return;
        }
        if(!exactAllowed()){
            if(a!=null)new AlertDialog.Builder(a).setTitle("Allow alarms & reminders").setMessage("This lets the timer alert when the screen is off. Return here and press Start after allowing access.").setNegativeButton("Cancel",null).setPositiveButton("Settings",(d,w)->{try{a.startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+context.getPackageName())));}catch(Exception e){notice("Open Android settings and allow alarms for RT Handbook.");}}).show();return;
        }
        ShotTimerState old=state,next=state.start(SystemClock.elapsedRealtime());if(!save(next))return;
        try{schedule();context.startForegroundService(new Intent(context,ShotTimerService.class).setAction("activate").putExtra("token",state.token()));error=manager().getNotificationChannel("shot_timer_done").getSound()==null?"Alarm sound is muted in Android settings.":"";acknowledged=false;minimized=false;}
        catch(Exception e){cancelAlarm(next);save(old);error="Timer could not start. Open the app and try again.";notice(error);}
        show();poll();
    }
    private void requestOverlayPermission(){
        Activity a=activity.get();if(a==null||floating())return;
        android.content.SharedPreferences prefs=context.getSharedPreferences("shot_timer",0);
        if(prefs.getBoolean("overlayDefaultExplained",false))return;
        prefs.edit().putBoolean("overlayDefaultExplained",true).apply();
        new AlertDialog.Builder(a).setTitle("Keep the timer visible").setMessage("Allow Display over other apps for RT Handbook to keep the timer on your home screen and over other apps. It will float automatically when you return, even before Start.").setNegativeButton("Not now",null).setPositiveButton("Settings",(d,w)->{try{a.startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,Uri.parse("package:"+context.getPackageName())));}catch(Exception e){notice("Open Android settings to allow Display over other apps for RT Handbook.");}}).show();
    }
    boolean floating(){return Settings.canDrawOverlays(context);}
    boolean keepService(){return ShotTimerDisplay.keepService(state==null?null:state.phase,floating(),minimized,acknowledged);}
    private void ensureFloatingService(){
        if(activity.get()==null||!floating()||!keepService()||ShotTimerService.active)return;
        try{context.startForegroundService(new Intent(context,ShotTimerService.class).setAction("activate").putExtra("token",state.token()));}
        catch(Exception e){error="Floating timer could not start. Keep the app open and try again.";notice(error);}
    }
    void reconcile(){
        if(state==null||!state.phase.equals("running"))return;
        ShotTimerState next=state.finish(SystemClock.elapsedRealtime());if(next==state)return;
        ShotTimerState old=state;if(!save(next)){cancelAlarm(old);state=old.interrupt();stopService();show();return;}
        cancelAlarm(old);finishedAt=SystemClock.elapsedRealtime();acknowledged=false;
        try{manager().notify(DONE,completed());}catch(Exception e){error="Time up. Notification could not be shown.";}
        updateNotification();show();
    }
    void alarm(String token){if(state==null||!state.token().equals(token)||!state.phase.equals("running"))return;if(state.left(SystemClock.elapsedRealtime())>0){try{schedule();}catch(Exception e){failed();}}else{reconcile();poll();}}
    void clockChanged(){if(state!=null&&state.phase.equals("running")){try{schedule();}catch(Exception e){failed();}}}
    void failed(){if(state!=null&&state.phase.equals("running")){ShotTimerState old=state;save(state.interrupt());cancelAlarm(old);}error="Timer interrupted. Reset and start again.";notice(error);show();}
    private AlarmManager alarms(){return context.getSystemService(AlarmManager.class);}
    private NotificationManager manager(){return context.getSystemService(NotificationManager.class);}
    private PendingIntent alarmIntent(ShotTimerState s){Intent i=new Intent(context,ShotTimerAlarmReceiver.class).setAction("finish").setData(Uri.parse("shottimer://alarm/"+Uri.encode(s.token()))).putExtra("token",s.token());return PendingIntent.getBroadcast(context,0,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    private void cancelAlarm(ShotTimerState s){if(s!=null)try{PendingIntent intent=alarmIntent(s);alarms().cancel(intent);intent.cancel();}catch(Exception ignored){}}
    private void schedule(){if(state==null)return;long left=state.left(SystemClock.elapsedRealtime());alarms().setAlarmClock(new AlarmManager.AlarmClockInfo(System.currentTimeMillis()+left,openIntent()),alarmIntent(state));}
    private PendingIntent openIntent(){return PendingIntent.getActivity(context,430,new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("showShotTimer",true),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    private PendingIntent command(String command){return PendingIntent.getForegroundService(context,430,new Intent(context,ShotTimerService.class).setAction(command).setData(Uri.parse("shottimer://action/"+command+"/"+Uri.encode(state.token()))).putExtra("token",state.token()),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    private void channels(){NotificationChannel active=new NotificationChannel("shot_timer","Shot countdown",NotificationManager.IMPORTANCE_LOW);active.setSound(null,null);manager().createNotificationChannel(active);NotificationChannel end=new NotificationChannel("shot_timer_done","Shot timer alarm",NotificationManager.IMPORTANCE_HIGH);end.setSound(Settings.System.DEFAULT_ALARM_ALERT_URI,new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_ALARM).build());end.enableVibration(true);end.setVibrationPattern(new long[]{0,500,200,500,200,500});manager().createNotificationChannel(end);}
    Notification notification(){
        Notification.Builder b=new Notification.Builder(context,"shot_timer").setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle(state==null?"Shot timer":state.label).setContentIntent(openIntent()).setOnlyAlertOnce(true).setOngoing(true);
        if(state!=null){boolean running=state.phase.equals("running");b.setContentText(state.detail+" · "+(running?"Counting down":state.phase)).setWhen(System.currentTimeMillis()+state.left(SystemClock.elapsedRealtime())).setUsesChronometer(running).setChronometerCountDown(true);if(running)b.addAction(new Notification.Action.Builder(null,"Pause",command("pause")).build());else if(state.phase.equals("paused"))b.addAction(new Notification.Action.Builder(null,"Resume",command("start")).build());b.addAction(new Notification.Action.Builder(null,"Close",command("close")).build());}return b.build();
    }
    private Notification completed(){return new Notification.Builder(context,"shot_timer_done").setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle("Time up · "+state.label).setContentText(state.detail).setCategory(Notification.CATEGORY_ALARM).setContentIntent(openIntent()).setAutoCancel(true).addAction(new Notification.Action.Builder(null,"Stop",command("ack")).build()).build();}
    void updateNotification(){if(ShotTimerService.active&&state!=null)manager().notify(ONGOING,notification());}
    void serviceReady(){show();poll();}
    void serviceGone(){if(overlay)removeCard();handler.removeCallbacks(tick);if(activity.get()!=null)poll();}
    private void stopService(){context.stopService(new Intent(context,ShotTimerService.class));manager().cancel(ONGOING);}
    private void removeCard(){if(card==null)return;try{if(overlay)windows.removeView(card);else if(card.getParent() instanceof android.view.ViewGroup)((android.view.ViewGroup)card.getParent()).removeView(card);}catch(Exception ignored){}card=null;overlay=false;}
    private void show(){
        if(state==null||minimized){removeCard();return;}
        Activity a=activity.get();boolean background=a==null;
        if(background&&(!floating()||!ShotTimerService.active||context.getSystemService(KeyguardManager.class).isKeyguardLocked())){removeCard();return;}
        Context viewContext=background?context:a;
        // State changes (including Reset) retain the same window and dragged position.
        // Recreate only when moving between the Activity and the system overlay.
        if(card!=null&&overlay==background&&card.getContext()==viewContext){card.update(state,acknowledged,error);move(0,0);return;}
        removeCard();card=new ShotTimerCard(viewContext,this);card.update(state,acknowledged,error);
        int width=Math.min(dp(240),context.getResources().getDisplayMetrics().widthPixels-dp(24));
        if(background){windows=context.getSystemService(WindowManager.class);overlayParams=new WindowManager.LayoutParams(width,WindowManager.LayoutParams.WRAP_CONTENT,WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,android.graphics.PixelFormat.TRANSLUCENT);overlayParams.gravity=Gravity.TOP|Gravity.LEFT;overlayParams.x=(context.getResources().getDisplayMetrics().widthPixels-width)/2;overlayParams.y=dp(220);try{windows.addView(card,overlayParams);overlay=true;}catch(Exception e){card=null;notice("Floating window unavailable. Use the timer notification.");}}
        else{FrameLayout.LayoutParams lp=new FrameLayout.LayoutParams(width,FrameLayout.LayoutParams.WRAP_CONTENT,Gravity.TOP|Gravity.LEFT);lp.leftMargin=Math.max(dp(12),(a.getResources().getDisplayMetrics().widthPixels-width)/2);lp.topMargin=dp(240);((android.view.ViewGroup)a.getWindow().getDecorView()).addView(card,lp);}
        if(card!=null){card.post(()->restorePosition());card.getViewTreeObserver().addOnGlobalLayoutListener(()->move(0,0));}
    }
    private void restorePosition(){if(card==null)return;android.content.SharedPreferences prefs=context.getSharedPreferences("shot_timer",0);float x=prefs.getFloat("x",.5f),y=prefs.getFloat("y",.43f);int w=context.getResources().getDisplayMetrics().widthPixels,h=context.getResources().getDisplayMetrics().heightPixels;if(!overlay&&card.getParent() instanceof View){w=((View)card.getParent()).getWidth();h=((View)card.getParent()).getHeight();}float tx=Math.max(0,w-card.getWidth())*x,ty=Math.max(0,h-card.getHeight())*y;move(tx-(overlay?overlayParams.x:card.getX()),ty-(overlay?overlayParams.y:card.getY()));}
    void rememberPosition(){if(card==null)return;int w=context.getResources().getDisplayMetrics().widthPixels,h=context.getResources().getDisplayMetrics().heightPixels;if(!overlay&&card.getParent() instanceof View){w=((View)card.getParent()).getWidth();h=((View)card.getParent()).getHeight();}float x=(overlay?overlayParams.x:card.getX())/Math.max(1,w-card.getWidth()),y=(overlay?overlayParams.y:card.getY())/Math.max(1,h-card.getHeight());context.getSharedPreferences("shot_timer",0).edit().putFloat("x",Math.max(0,Math.min(1,x))).putFloat("y",Math.max(0,Math.min(1,y))).apply();}
    private int dp(float n){return (int)(n*context.getResources().getDisplayMetrics().density+.5f);}
    void move(float dx,float dy){if(card==null)return;int screenW=context.getResources().getDisplayMetrics().widthPixels,screenH=context.getResources().getDisplayMetrics().heightPixels;
        if(overlay){int x=Math.max(dp(8),Math.min(screenW-card.getWidth()-dp(8),overlayParams.x+(int)dx)),y=Math.max(dp(32),Math.min(screenH-card.getHeight()-dp(48),overlayParams.y+(int)dy));if(x==overlayParams.x&&y==overlayParams.y)return;overlayParams.x=x;overlayParams.y=y;try{windows.updateViewLayout(card,overlayParams);}catch(Exception ignored){}}
        else if(card.getParent() instanceof android.view.View){android.view.View parent=(android.view.View)card.getParent();card.setX(Math.max(dp(8),Math.min(parent.getWidth()-card.getWidth()-dp(8),card.getX()+dx)));card.setY(Math.max(dp(32),Math.min(parent.getHeight()-card.getHeight()-dp(48),card.getY()+dy)));}
    }
}
