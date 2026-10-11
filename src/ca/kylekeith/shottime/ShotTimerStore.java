package ca.kylekeith.shottime;
import android.content.Context;
import android.provider.Settings;
import org.json.JSONObject;
final class ShotTimerStore {
    static int boot(Context c){return Settings.Global.getInt(c.getContentResolver(),Settings.Global.BOOT_COUNT,-1);}
    static ShotTimerState read(Context c){
        String raw=c.getSharedPreferences("shot_timer",0).getString("state","");if(raw.isEmpty())return null;
        try{JSONObject j=new JSONObject(raw);long d=j.getLong("duration"),r=j.getLong("remaining"),deadline=j.getLong("deadline"),rev=j.getLong("revision");String phase=j.getString("phase");
            if(d<1000||d>ShotTimerState.MAX_SECONDS*1000||r<0||r>d||deadline<0||rev<0||!java.util.Arrays.asList("ready","running","paused","finished","interrupted").contains(phase))throw new IllegalArgumentException();
            return new ShotTimerState(j.getString("id"),j.getString("label"),j.getString("detail"),phase,d,r,deadline,rev,j.getInt("boot"));
        }catch(Exception e){throw new IllegalStateException("Saved timer could not be read. Reset it before starting.",e);}
    }
    static boolean write(Context c,ShotTimerState s){try{android.content.SharedPreferences.Editor e=c.getSharedPreferences("shot_timer",0).edit();if(s==null)e.remove("state");else e.putString("state",new JSONObject().put("id",s.id).put("label",s.label).put("detail",s.detail).put("phase",s.phase).put("duration",s.duration).put("remaining",s.remaining).put("deadline",s.deadline).put("revision",s.revision).put("boot",s.boot).toString());return e.commit();}catch(Exception e){return false;}}
}
