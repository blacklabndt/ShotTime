package ca.kylekeith.shottime;

import android.content.Context;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** One recoverable session. Replaced only after the page has durably received its completed transcript. */
final class VoiceJournal {
    private static JSONObject data;
    private static AtomicFile file;
    static boolean busy(String state){return state.equals("preparing")||state.equals("listening")||state.equals("stopping");}
    private static void init(Context ctx) throws Exception {
        if(data!=null)return;
        file=new AtomicFile(new File(ctx.getNoBackupFilesDir(),"voice-session.json"));
        byte[] bytes;
        try{bytes=file.readFully();}
        catch(FileNotFoundException absent){
            // AtomicFile must get the first chance to restore a legacy .bak journal.
            File base=file.getBaseFile();
            if(base.exists()||new File(base+".bak").exists()||new File(base+".new").exists())throw absent;
            data=new JSONObject();return;
        }
        JSONObject recovered=new JSONObject(new String(bytes,StandardCharsets.UTF_8));
        if(busy(recovered.optString("state"))){recovered.put("state","interrupted");recovered.put("message","Recording was interrupted. Saved transcript recovered; audio not yet transcribed may be missing.");save(recovered);}
        // A failed read, parse or recovery write leaves data unpublished and the journal intact.
        data=recovered;
    }
    private static void save() throws Exception {
        save(data);
    }
    private static void save(JSONObject candidate) throws Exception {
        FileOutputStream stream=null;
        try{stream=file.startWrite();stream.write(candidate.toString().getBytes(StandardCharsets.UTF_8));file.finishWrite(stream);}
        catch(Exception e){if(stream!=null)file.failWrite(stream);throw e;}
    }
    static synchronized void start(Context ctx,String list,String previous) throws Exception {
        init(ctx);
        if(busy(data.optString("state")))throw new IllegalStateException("A recording is already running.");
        if(!data.optString("id").equals(previous))throw new IllegalStateException("Recover the previous transcript before starting again.");
        JSONObject candidate=new JSONObject().put("id",UUID.randomUUID().toString()).put("listId",list).put("state","preparing").put("message","Preparing Whisper. The microphone starts when Listening appears.").put("events",new JSONArray()).put("route","");
        // Publish only after persistence succeeds so failed starts remain retryable.
        save(candidate);data=candidate;
    }
    static synchronized void backend(Context ctx,String name,boolean deferred)throws Exception{init(ctx);data.put("backend",name).put("deferred",deferred);save();}
    static synchronized void suggestion(Context ctx,String text)throws Exception{init(ctx);data.put("suggestion",text);save();}
    static synchronized String transcript(Context ctx)throws Exception{init(ctx);StringBuilder text=new StringBuilder();JSONArray events=data.getJSONArray("events");for(int i=0;i<events.length();i++)text.append(events.getJSONObject(i).getString("text")).append(' ');return text.toString().trim();}
    static synchronized void state(Context ctx,String state,String message) throws Exception {init(ctx);data.put("state",state).put("message",message);save();}
    static synchronized void route(Context ctx,String name) throws Exception {init(ctx);data.put("route",name);save();}
    static synchronized void interpretFailed(Context ctx,String reason)throws Exception{init(ctx);data.put("interpretError",reason==null?"failed":reason);save();}
    static synchronized void uncertain(Context ctx) throws Exception {init(ctx);data.put("uncertain",true);save();}
    static synchronized void append(Context ctx,String text) throws Exception {
        init(ctx);JSONArray events=data.getJSONArray("events");
        if(events.length()>=2000)throw new IllegalStateException("Session limit reached. Stop and begin a new recording.");
        events.put(new JSONObject().put("text",text));save();
    }
    static synchronized String snapshot(Context ctx) {
        try{init(ctx);return data.toString();}catch(Exception e){return "{\"state\":\"error\",\"message\":\"Voice recovery storage could not be read. Recording is disabled to preserve it.\"}";}
    }
}
