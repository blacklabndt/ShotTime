package ca.kylekeith.shottime;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.*;
import android.os.*;
import java.io.*;
import java.security.MessageDigest;
import java.util.concurrent.*;

/** Audio capture is independent of the Activity and WebView. Inference never blocks the recorder. */
public final class VoiceService extends Service {
    static volatile boolean active;
    private static volatile float microphoneLevel;
    private static volatile long microphoneAt;
    static float liveLevel(){return active&&SystemClock.elapsedRealtime()-microphoneAt<400?microphoneLevel:0;}
    private static void clearLevel(){microphoneAt=0;microphoneLevel=0;}

    // Why the last start was refused; shown by the page without touching the previous session's journal.
    static volatile String startError="";
    private volatile boolean recording;
    private volatile String failure="";
    private VoiceBackend backend;
    private CloudClient cloud;
    private boolean deferred;
    private String ids="";
    private volatile ThreadPoolExecutor decoderPool;
    private AudioManager audio;
    private PowerManager.WakeLock wake;
    private int oldMode;
    private boolean changedRoute;
    private static final int NOTIFICATION=410;
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent==null)return START_NOT_STICKY;
        if("stop".equals(intent.getAction())){recording=false;clearLevel();if(active)setState("stopping","Finishing captured audio. Keep the app open until processing completes.");else stopSelf();return START_NOT_STICKY;}
        // startForegroundService() must be answered with startForeground() even when the start is refused;
        // a service that stops first crashes the app.
        try{
            getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("voice","Inspection recording",NotificationManager.IMPORTANCE_LOW));
            Notification notification=notification(active?"Recording — tap Stop when finished":"Preparing voice processing");
            if(Build.VERSION.SDK_INT>=29)startForeground(NOTIFICATION,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);else startForeground(NOTIFICATION,notification);
        }catch(Exception e){startError="Could not start recording: "+e.getMessage();if(!active)stopSelf();return START_NOT_STICKY;}
        if(active)return START_NOT_STICKY;
        try{VoiceJournal.start(this,intent.getStringExtra("listId"),intent.getStringExtra("previous"));}
        catch(Exception e){startError="Could not start recording: "+e.getMessage();stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();return START_NOT_STICKY;}
        startError="";
        try {
            deferred=!CloudSettings.mode(this).equals("phone");VoiceJournal.backend(this,deferred?"Preparing cloud":"Phone",deferred);
            clearLevel();active=true;recording=true;
            final boolean bluetooth=intent.getBooleanExtra("bluetooth",false);ids=intent.getStringExtra("ids")==null?"":intent.getStringExtra("ids");
            new Thread(()->record(bluetooth),"ShotTime microphone").start();
        }catch(Exception e){active=false;failure=e.getMessage();setState("error","Could not start recording: "+failure);stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}
        return START_NOT_STICKY;
    }
    private Notification notification(String text){
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,VoiceService.class).setAction("stop"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this,"voice").setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("RT Handbook Note Taker").setContentText(text).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).addAction(new Notification.Action.Builder(null,"Stop",stop).build()).build();
    }
    private void setState(String state,String message){
        try{VoiceJournal.state(this,state,message);}catch(Exception e){failure="Could not save the transcript. Stop and free device storage.";recording=false;}
    }
    private void problem(String message){failure=message;recording=false;try{VoiceJournal.uncertain(this);}catch(Exception ignored){}}
    private static final String MODEL="whisper-small-en-q5_1-bfdff489.bin",DETECTOR="silero-v6.2.0-2aa269b7.bin";
    // Copies a bundled model out of the APK once (native code needs a file path) and verifies it.
    private String prepare(String asset,String name,long size,String expected,String label) throws Exception {
        File target=new File(getNoBackupFilesDir(),name);
        if(target.exists()&&target.length()==size)return target.getAbsolutePath();
        File pending=new File(getNoBackupFilesDir(),name+".part");
        MessageDigest sha=MessageDigest.getInstance("SHA-256");
        try(InputStream in=getAssets().open(asset);FileOutputStream out=new FileOutputStream(pending)){
            byte[] bytes=new byte[65536];int n;while((n=in.read(bytes))!=-1){out.write(bytes,0,n);sha.update(bytes,0,n);}out.getFD().sync();
        }
        StringBuilder digest=new StringBuilder();for(byte b:sha.digest())digest.append(String.format("%02x",b&255));
        if(!digest.toString().equals(expected)){pending.delete();throw new IOException(label+" verification failed. Reinstall the APK.");}
        if(!pending.renameTo(target))throw new IOException("Could not prepare "+label+". Check free storage.");
        return target.getAbsolutePath();
    }
    // Earlier builds copied other models here (base.en is 148 MB); remove anything not in use.
    private void removeOldModels(){
        File[] files=getNoBackupFilesDir().listFiles();if(files==null)return;
        for(File f:files){String n=f.getName();if((n.startsWith("whisper-")||n.startsWith("silero-"))&&!n.equals(MODEL)&&!n.equals(DETECTOR))f.delete();}
    }
    private void chooseRoute(boolean bluetooth) throws Exception {
        audio=getSystemService(AudioManager.class);oldMode=audio.getMode();
        if(!bluetooth)return;
        if(Build.VERSION.SDK_INT<31)throw new IOException("Bluetooth recording in this build requires Android 12 or later. Choose Phone microphone.");
        changedRoute=true;
        if(!RouteApi31.select(audio))throw new IOException("No Bluetooth headset microphone is available. Connect it or choose Phone microphone.");
    }
    // Two or more sections waiting: trade a little accuracy for speed rather than stop the recording.
    private boolean behind(){ThreadPoolExecutor pool=decoderPool;return pool!=null&&pool.getQueue().size()>=2;}
    private void transcribeSection(float[] samples){
        try{String text=backend.transcribe(samples).trim();VoiceJournal.backend(this,backend.status,deferred);if(!text.isEmpty())VoiceJournal.append(this,text);}
        catch(Exception|LinkageError e){problem("Transcription stopped: "+e.getMessage()+" Audio not yet transcribed may be missing.");}
    }
    private void enqueue(ThreadPoolExecutor decoder,WhisperEngine engine,float[] samples){
        if(samples==null)return;
        try {decoder.execute(()->transcribeSection(samples));}catch(RejectedExecutionException e){problem("Whisper could not keep up. Recording stopped; the last audio section was not transcribed. Wait for processing, then repeat that section.");}
    }
    private void record(boolean bluetooth){
        AudioRecord recorder=null;WhisperEngine engine=null;SpeechDetector detector=null;ThreadPoolExecutor decoder=null;AudioSegmenter segmenter=new AudioSegmenter();
        try {
            wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"ShotTime:voice");wake.acquire(40*60*1000L);
            removeOldModels();
            String path=prepare("voice/ggml-small.en-q5_1.bin",MODEL,190098681L,"bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30","Whisper model");if(!recording)return;
            engine=new WhisperEngine(path);if(!recording)return;
            // Silero finds speech and pauses far better than loudness on a noisy site; loudness remains the fallback.
            try{detector=new SpeechDetector(prepare("voice/ggml-silero-v6.2.0.bin",DETECTOR,885098L,"2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987","Speech detector"));}catch(Exception|LinkageError e){detector=null;}
            final WhisperEngine phoneEngine=engine;final String prompt=WhisperEngine.prompt(ids);
            String mode=CloudSettings.mode(this),key="";try{if(!mode.equals("phone"))key=CloudSettings.key(this);}catch(Exception ignored){}
            cloud=new CloudClient(this,key,ids);backend=new VoiceBackend(mode,!key.isEmpty(),pcm->cloud.transcribe(pcm),pcm->phoneEngine.transcribe(pcm,prompt,behind()));
            if(mode.equals("cloud")&&key.isEmpty())throw new IOException("Enter an API key in Voice processing settings first.");
            deferred=backend.cloudReady();VoiceJournal.backend(this,backend.status,deferred);
            chooseRoute(bluetooth);
            int minimum=AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
            if(minimum<=0)throw new IOException("This microphone does not support 16 kHz recording.");
            recorder=new AudioRecord(bluetooth?MediaRecorder.AudioSource.VOICE_COMMUNICATION:MediaRecorder.AudioSource.MIC,16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,Math.max(minimum*4,16000));
            if(recorder.getState()!=AudioRecord.STATE_INITIALIZED)throw new IOException("Microphone could not be opened.");
            if(!bluetooth){for(AudioDeviceInfo device:audio.getDevices(AudioManager.GET_DEVICES_INPUTS))if(device.getType()==AudioDeviceInfo.TYPE_BUILTIN_MIC){recorder.setPreferredDevice(device);break;}}
            recorder.startRecording();if(recorder.getRecordingState()!=AudioRecord.RECORDSTATE_RECORDING)throw new IOException("Microphone access was interrupted.");
            decoder=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(4));decoderPool=decoder;
            short[] frame=new short[3*SpeechDetector.WINDOW];long started=SystemClock.elapsedRealtime();int routeId=-1,routeWait=0;
            while(recording){
                int n=recorder.read(frame,0,frame.length,AudioRecord.READ_BLOCKING);
                if(n<=0)throw new IOException("Microphone disconnected or became unavailable.");
                AudioDeviceInfo device=recorder.getRoutedDevice();
                if(device!=null){
                    boolean isBluetooth=device.getType()==AudioDeviceInfo.TYPE_BLUETOOTH_SCO||device.getType()==26;
                    if(bluetooth&&!isBluetooth){if(++routeWait>30)throw new IOException("Bluetooth microphone did not connect. Choose Phone microphone or reconnect the headset.");continue;}
                    if(!bluetooth&&device.getType()!=AudioDeviceInfo.TYPE_BUILTIN_MIC)throw new IOException("Phone microphone routing changed. Stop and choose the input again.");
                    if(routeId!=-1&&routeId!=device.getId())throw new IOException("Microphone route changed. Check the headset and start again.");
                    if(routeId==-1){routeId=device.getId();VoiceJournal.route(this,(isBluetooth?"Bluetooth: ":"Phone: ")+device.getProductName());setState("listening","Listening — pause briefly between spools. Rows appear as the next spool starts or after Stop.");getSystemService(NotificationManager.class).notify(NOTIFICATION,notification("Recording — tap Stop when finished"));}
                }else {if(++routeWait>30)throw new IOException("Could not confirm the microphone input.");continue;}
                double energy=0;for(int i=0;i<n;i++){double sample=frame[i]/32768.0;energy+=sample*sample;}
                microphoneLevel=(float)Math.max(0,Math.min(1,(20*Math.log10(Math.max(0.000001,Math.sqrt(energy/n)))+60)/60));
                microphoneAt=SystemClock.elapsedRealtime();
                float[] section;
                if(detector!=null){try{section=segmenter.accept(frame,n,detector.speech(frame,n));}catch(IllegalStateException e){detector.close();detector=null;section=segmenter.accept(frame,n);}}
                else section=segmenter.accept(frame,n);
                enqueue(decoder,engine,section);
                if(SystemClock.elapsedRealtime()-started>=30*60*1000L){failure="30-minute session limit reached. Start a new recording to continue.";recording=false;}
            }
        }catch(Exception|LinkageError e){problem("Recording stopped: "+e.getMessage()+" Check the final spool for missing audio.");}
        finally {
            recording=false;clearLevel();
            if(recorder!=null){try{recorder.stop();}catch(Exception ignored){}recorder.release();}
            setState("stopping","Finishing captured audio…");
            // The last section is transcribed here after the queue drains, so a full queue at Stop cannot reject it.
            // The wait ignores interrupts: closing Whisper while a section is still decoding would crash natively.
            boolean interrupted=false;
            if(decoder!=null){float[] tail=segmenter.finish();decoder.shutdown();interrupted=Waits.untilTerminated(decoder);if(tail!=null)transcribeSection(tail);}
            if(backend!=null&&backend.cloudReady()&&failure.isEmpty()){
                try{String transcript=VoiceJournal.transcript(this);if(!transcript.isEmpty())VoiceJournal.suggestion(this,cloud.interpret(transcript));}
                catch(Exception e){try{VoiceJournal.backend(this,"Cloud interpretation unavailable — review the recognized speech",deferred);VoiceJournal.interpretFailed(this,e.getMessage());}catch(Exception storage){problem("Could not save the transcript. Stop and free device storage.");}}
            }
            if(detector!=null)detector.close();
            if(engine!=null)engine.close();
            if(changedRoute){RouteApi31.clear(audio);audio.setMode(oldMode);}
            if(wake!=null&&wake.isHeld())wake.release();
            setState(failure.isEmpty()?"stopped":"error",failure.isEmpty()?"Recording saved. Check weld numbers, sizes and Welder IDs before exporting.":failure);
            active=false;stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();
            if(interrupted)Thread.currentThread().interrupt();
        }
    }
    @Override public void onDestroy(){recording=false;clearLevel();super.onDestroy();}
    private static final class RouteApi31 {
        static boolean select(AudioManager audio){
            for(AudioDeviceInfo device:audio.getAvailableCommunicationDevices())if(device.getType()==AudioDeviceInfo.TYPE_BLUETOOTH_SCO||device.getType()==26){audio.setMode(AudioManager.MODE_IN_COMMUNICATION);if(audio.setCommunicationDevice(device))return true;}
            return false;
        }
        static void clear(AudioManager audio){audio.clearCommunicationDevice();}
    }
}
