package ca.kylekeith.shottime;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.graphics.Color;
import android.graphics.Insets;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceResponse;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.print.PrintManager;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PageRange;
import android.print.PrintJob;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import org.json.JSONTokener;
import org.json.JSONObject;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import java.util.ArrayList;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private static final int BACKUP_SAVE=420,BACKUP_RESTORE=421,MAX_BACKUP_BYTES=20000000;
    private byte[] pendingBackup;
    private boolean backupBusy;
    private void backupNotice(String text){runOnUiThread(()->Toast.makeText(this,text,Toast.LENGTH_LONG).show());}
    private void backupCommand(boolean save){
        if(backupBusy||web==null)return;
        backupBusy=true;
        String script=save?"ShotNotesUI.backupExport()":"ShotNotesUI.restoreReady()";
        web.evaluateJavascript("(()=>{try{return "+script+";}catch(e){return null;}})()",value->{
            try{
                Object decoded=new JSONTokener(value).nextValue();
                if(save){
                    if(!(decoded instanceof String))throw new IllegalStateException();
                    pendingBackup=((String)decoded).getBytes(StandardCharsets.UTF_8);
                    if(pendingBackup.length>MAX_BACKUP_BYTES)throw new IllegalStateException();
                    String date=new java.text.SimpleDateFormat("yyyy-MM-dd-HHmmss",java.util.Locale.US).format(new java.util.Date());
                    startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE,"RT-Handbook-notes-"+date+".json"),BACKUP_SAVE);
                }else{
                    if(!Boolean.TRUE.equals(decoded))throw new IllegalStateException();
                    startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"),BACKUP_RESTORE);
                }
            }catch(Exception e){backupBusy=false;pendingBackup=null;backupNotice("Could not open backup files. Stop recording and resolve any notes recovery first, then try again.");}
        });
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request!=BACKUP_SAVE&&request!=BACKUP_RESTORE)return;
        final byte[] snapshot=pendingBackup;pendingBackup=null;
        if(result!=RESULT_OK||data==null||data.getData()==null){backupBusy=false;return;}
        final Uri uri=data.getData();
        new Thread(()->{
            try{
                if(request==BACKUP_SAVE){
                    if(snapshot==null)throw new java.io.IOException("Backup interrupted");
                    try(java.io.OutputStream out=getContentResolver().openOutputStream(uri,"wt")){
                        if(out==null)throw new java.io.IOException("Cannot open destination");out.write(snapshot);out.flush();
                    }
                    backupNotice("Backup file saved.");
                }else{
                    ByteArrayOutputStream bytes=new ByteArrayOutputStream();
                    try(InputStream in=getContentResolver().openInputStream(uri)){
                        if(in==null)throw new java.io.IOException("Cannot read file");
                        byte[] buffer=new byte[8192];int count;
                        while((count=in.read(buffer))!=-1){if(bytes.size()+count>MAX_BACKUP_BYTES)throw new java.io.IOException("File too large");bytes.write(buffer,0,count);}
                    }
                    String text=StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes.toByteArray())).toString();
                    runOnUiThread(()->{if(web!=null&&!isDestroyed())web.evaluateJavascript("window.ShotNotesUI && ShotNotesUI.receiveBackup("+JSONObject.quote(text)+")",null);});
                }
            }catch(Exception e){backupNotice(request==BACKUP_SAVE?"Backup could not be saved. Try again; do not use the incomplete file.":"Backup could not be read (maximum 20 MB). Current notes are unchanged.");}
            finally{runOnUiThread(()->backupBusy=false);}
        },"notes-backup").start();
    }
    private void shareCSV() {
        web.evaluateJavascript("JSON.stringify(ShotNotesUI.csvExport())", result -> {
            try {
                JSONObject data=new JSONObject((String)new JSONTokener(result).nextValue());
                String name=data.getString("name");
                if(!name.matches("[a-zA-Z0-9._-]{1,120}\\.csv")) throw new IllegalArgumentException("Invalid filename");
                removeOldShares();
                java.io.File directory=new java.io.File(getCacheDir(),"csv-share/"+java.util.UUID.randomUUID());
                if(!directory.mkdirs()) throw new java.io.IOException("Cannot create export directory");
                java.io.File file=new java.io.File(directory,name);
                try(java.io.FileOutputStream out=new java.io.FileOutputStream(file)){out.write(data.getString("text").getBytes(StandardCharsets.UTF_8));}
                Uri uri=new Uri.Builder().scheme("content").authority(getPackageName()+".csv").appendPath(directory.getName()).appendPath(name).build();
                Intent send=new Intent(Intent.ACTION_SEND).setType("text/csv").putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                send.setClipData(android.content.ClipData.newRawUri("Weld list CSV",uri));
                startActivity(Intent.createChooser(send,"Share weld list CSV"));
            } catch(Exception e){Toast.makeText(this,"Could not share CSV. Please try again.",Toast.LENGTH_LONG).show();}
        });
    }
    // Shared CSVs stay readable for a day (the receiving app may open them later), then are removed.
    private void removeOldShares(){
        java.io.File[] shares=new java.io.File(getCacheDir(),"csv-share").listFiles();if(shares==null)return;
        for(java.io.File share:shares)if(System.currentTimeMillis()-share.lastModified()>86400000L){java.io.File[] files=share.listFiles();if(files!=null)for(java.io.File f:files)f.delete();share.delete();}
    }
    private WebView web;
    private WebView printWeb;
    private boolean printPending;
    private int printGeneration;
    // Set once Android's print screen has the document; the session stays open until Android
    // reports it finished or the job is no longer active.
    private PrintJob printJob;
    private boolean printInterrupted;
    private boolean recreateAfterPrint;
    private final Runnable printTimeout = () -> printError();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Uri pendingVoice;
    private String voiceNotice="";
    private String lastVoiceSnapshot="";
    // Lightweight, ephemeral microphone meter; never writes/replays transcript state.
    private final Runnable levelPoll=new Runnable(){public void run(){
        if(web!=null)web.evaluateJavascript("window.ShotNotesUI && ShotNotesUI.receiveLevel("+VoiceService.liveLevel()+")",null);
        mainHandler.postDelayed(this,100);
    }};
    private final Runnable voicePoll=new Runnable(){public void run(){pushVoice();mainHandler.postDelayed(this,750);}};
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                Insets edges = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(edges.left, edges.top, edges.right, edges.bottom);
                return insets;
            });
        } else {
            getWindow().setStatusBarColor(Color.BLACK);
            getWindow().setNavigationBarColor(Color.BLACK);
            getWindow().getDecorView().setSystemUiVisibility(0);
        }
        setContentView(root);
        // From Android 13 (and always when targeting Android 16) Back goes through OnBackInvokedCallback,
        // not onBackPressed(). Kept in a nested class so older Android never loads the API 33 types.
        if (Build.VERSION.SDK_INT >= 33) BackApi33.register(this);
        if (Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null) {
            getWindow().getInsetsController().setSystemBarsAppearance(
                0,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if(view==web&&request.isForMainFrame()&&request.hasGesture()&&"shottime".equals(request.getUrl().getScheme())&&"timer".equals(request.getUrl().getHost()))ShotTimer.get(MainActivity.this).prepare(MainActivity.this,request.getUrl());
                if(view==web&&request.isForMainFrame()&&request.hasGesture()){
                    if("shottime://backup/save".equals(request.getUrl().toString()))backupCommand(true);
                    if("shottime://backup/restore".equals(request.getUrl().toString()))backupCommand(false);
                }
                if (request.isForMainFrame() && view == web && "shottime://share-csv".equals(request.getUrl().toString())) shareCSV();
                if (request.isForMainFrame() && "shottime://print".equals(request.getUrl().toString())) printList();
                if (request.isForMainFrame() && "shottime".equals(request.getUrl().getScheme()) && "voice".equals(request.getUrl().getHost()) && view == web) voiceCommand(request.getUrl());
                if (view == web && request.isForMainFrame() && request.hasGesture() && ChartLinks.allowed(request.getUrl().toString())) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()).addCategory(Intent.CATEGORY_BROWSABLE));
                    } catch (android.content.ActivityNotFoundException | SecurityException e) {
                        Toast.makeText(MainActivity.this,"No browser available to open the chart link.",Toast.LENGTH_LONG).show();
                    }
                }
                return true;
            }
            @Override public void onPageFinished(WebView view,String url){lastVoiceSnapshot="";pushVoice();}
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                root.removeView(view);
                if (web == view) web = null;
                view.destroy();
                // Recreating now would close Android's print screen mid-document; wait until it finishes.
                if (printJob != null) { recreateAfterPrint = true; return true; }
                mainHandler.post(() -> {
                    if (!isFinishing() && !isDestroyed()) {
                        Toast.makeText(MainActivity.this,"Screen reloaded after a display error. Saved drafts will be restored.",Toast.LENGTH_LONG).show();
                        recreate();
                    }
                });
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(-1,-1));
        try {
            String html = readAsset("index.html").replace("/*__UNSHARPNESS__*/", readAsset("unsharpness.js")).replace("/*__UNSHARPNESS_UI__*/", readAsset("unsharpness-ui.js")).replace("/*__CODE_CHART_IMAGES__*/", readAsset("code-chart-images.json")).replace("/*__CODE_DATA__*/", readAsset("code-data.json")).replace("/*__CODE_CALCULATOR__*/", readAsset("code-calculator.js")).replace("/*__CODE_UI__*/", readAsset("code-ui.js")).replace("/*__PIPE_CHART__*/", readAsset("pipe-chart.json")).replace("/*__TECHNIQUES__*/", readAsset("techniques.json"))
                .replace("/*__CALCULATOR__*/", readAsset("calculator.js"))
                .replace("/*__NOTES_MODEL__*/", readAsset("notes-model.js"))
                .replace("/*__NOTES_JOBS__*/", readAsset("notes-jobs.js"))
                .replace("/*__NOTES_PARSER__*/", readAsset("notes-parser.js"))
                .replace("/*__NOTES_STORAGE__*/", readAsset("notes-storage.js"))
                .replace("/*__NOTES_VOICE__*/", readAsset("notes-voice.js"))
                .replace("/*__NOTES_LEARNING__*/", readAsset("notes-learning.js"))
                .replace("/*__NOTES_UI__*/", readAsset("notes-ui.js"));
            web.loadDataWithBaseURL("https://shottime.local/", html, "text/html", "UTF-8", null);
        } catch (Exception error) {
            root.removeAllViews();
            TextView message = new TextView(this);
            message.setText("RT Handbook could not load its chart. Please reinstall the APK.");
            message.setPadding(24,24,24,24);
            root.addView(message);
        }
    }
    private boolean holdVoice,voiceStartQueued;
    private void stopVoice(){
        pendingVoice=null;holdVoice=false;
        if(VoiceService.active||voiceStartQueued)startService(new Intent(this,VoiceService.class).setAction("stop"));
        voiceStartQueued=false;lastVoiceSnapshot="";pushVoice();
    }
    private void voiceCommand(Uri command){
        if("/settings".equals(command.getPath())){CloudSettings.show(this,()->{lastVoiceSnapshot="";pushVoice();});return;}
        if("/stop".equals(command.getPath())){stopVoice();return;}
        if(!"/start".equals(command.getPath())||pendingVoice!=null||VoiceService.active)return;
        String list=command.getQueryParameter("list");
        if(list==null||!list.matches("[A-Za-z0-9-]{1,100}"))return;
        voiceNotice="";VoiceService.startError="";pendingVoice=command;holdVoice="1".equals(command.getQueryParameter("hold"));
        ArrayList<String> permissions=new ArrayList<>();
        if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)permissions.add(Manifest.permission.RECORD_AUDIO);
        if(Build.VERSION.SDK_INT>=31&&"bluetooth".equals(command.getQueryParameter("input"))&&checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)!=PackageManager.PERMISSION_GRANTED)permissions.add(Manifest.permission.BLUETOOTH_CONNECT);
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)permissions.add(Manifest.permission.POST_NOTIFICATIONS);
        if(!permissions.isEmpty())requestPermissions(permissions.toArray(new String[0]),410);else startVoice();
        pushVoice();
    }
    private void startVoice(){
        Uri command=pendingVoice;pendingVoice=null;if(command==null)return;
        boolean bluetooth="bluetooth".equals(command.getQueryParameter("input"));
        if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){voiceNotice="Microphone permission is required. Tap Start to try again, or enable it in Android app settings.";return;}
        if(bluetooth&&Build.VERSION.SDK_INT>=31&&checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)!=PackageManager.PERMISSION_GRANTED){voiceNotice="Nearby devices permission is required for the Bluetooth microphone.";return;}
        // Welder IDs already on the list bias Whisper's spelling; only plain IDs are accepted.
        String ids=command.getQueryParameter("ids");if(ids==null||!ids.matches("[A-Z0-9-]{1,12}(,[A-Z0-9-]{1,12}){0,19}"))ids="";
        try{voiceStartQueued=true;startForegroundService(new Intent(this,VoiceService.class).putExtra("ids",ids).putExtra("listId",command.getQueryParameter("list")).putExtra("previous",command.getQueryParameter("previous")==null?"":command.getQueryParameter("previous")).putExtra("bluetooth",bluetooth));}
        catch(Exception e){voiceStartQueued=false;holdVoice=false;voiceNotice="Could not start the microphone: "+e.getMessage();}
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==410){startVoice();pushVoice();}}
    private void pushVoice(){
        if(web==null)return;
        if(VoiceService.active)voiceStartQueued=false;
        try{
            JSONObject snapshot=new JSONObject(VoiceJournal.snapshot(this));snapshot.put("available",true).put("notice",voiceNotice.isEmpty()?VoiceService.startError:voiceNotice).put("processingMode",CloudSettings.mode(this));
            if(pendingVoice!=null)snapshot.put("state","permission");
            String json=snapshot.toString();if(json.equals(lastVoiceSnapshot))return;lastVoiceSnapshot=json;
            web.evaluateJavascript("window.ShotNotesUI && ShotNotesUI.receiveVoice("+JSONObject.quote(json)+")",null);
        }catch(Exception ignored){}
    }
    private void printList() {
        clearFinishedPrint();
        if (printPending || printWeb != null || printJob != null) { Toast.makeText(this,"A print is still open or in progress. Finish or cancel it, then try again.",Toast.LENGTH_LONG).show(); return; }
        final int generation = ++printGeneration;
        printPending = true;
        mainHandler.postDelayed(printTimeout,15000);
        web.evaluateJavascript("makePrintDocument()", value -> {
            if (!printPending || generation != printGeneration) return;
            printPending = false;
            try {
                Object decoded = new JSONTokener(value).nextValue();
                if (isFinishing() || isDestroyed()) { mainHandler.removeCallbacks(printTimeout); return; }
                if (!(decoded instanceof String)) {
                    mainHandler.removeCallbacks(printTimeout);
                    Toast.makeText(this,"Nothing to print. Check the source activity and filters.",Toast.LENGTH_LONG).show();
                    return;
                }
                printWeb = new WebView(this);
                printWeb.getSettings().setJavaScriptEnabled(false);
                printWeb.getSettings().setAllowFileAccess(false);
                printWeb.getSettings().setAllowContentAccess(false);
                printWeb.setWebViewClient(new WebViewClient() {
                    private boolean started;
                    @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                        if (request.isForMainFrame() && view == printWeb) printFailed();
                    }
                    @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                        if (view == printWeb) printFailed();
                        return true;
                    }
                    @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return true; }
                    @Override public void onPageFinished(WebView view, String url) {
                        if (started || view != printWeb || isFinishing() || isDestroyed()) return;
                        mainHandler.removeCallbacks(printTimeout);
                        started = true;
                        try {
                            PrintManager manager = (PrintManager)getSystemService(PRINT_SERVICE);
                            if (manager == null) throw new IllegalStateException("Printing unavailable");
                            final WebView snapshot = view;
                            final PrintDocumentAdapter delegate = view.createPrintDocumentAdapter("RT Handbook shot list");
                            PrintDocumentAdapter adapter = new PrintDocumentAdapter() {
                                // After an interruption the snapshot is destroyed; fail instead of calling into it.
                                private boolean usable() { return !printInterrupted && printWeb == snapshot; }
                                @Override public void onStart() { if (usable()) delegate.onStart(); }
                                @Override public void onLayout(PrintAttributes oldAttrs, PrintAttributes newAttrs, CancellationSignal signal, LayoutResultCallback callback, Bundle extras) { try { if (!usable()) throw new IllegalStateException("Print snapshot unavailable"); delegate.onLayout(oldAttrs,newAttrs,signal,callback,extras); } catch (Exception e) { callback.onLayoutFailed("Unable to prepare shot list. Close printing and try again."); } }
                                @Override public void onWrite(PageRange[] pages, ParcelFileDescriptor destination, CancellationSignal signal, WriteResultCallback callback) { try { if (!usable()) throw new IllegalStateException("Print snapshot unavailable"); delegate.onWrite(pages,destination,signal,callback); } catch (Exception e) { callback.onWriteFailed("Unable to write shot list. Close printing and try again."); } }
                                @Override public void onFinish() {
                                    try { if (usable()) delegate.onFinish(); }
                                    catch (Exception ignored) { }
                                    // The print WebView is never attached. View.post() can wait
                                    // forever for attachment; schedule cleanup on the main looper.
                                    mainHandler.post(() -> finishPrint(generation));
                                }
                            };
                            PrintJob job = manager.print("RT Handbook shot list", adapter, new PrintAttributes.Builder()
                                .setMediaSize(PrintAttributes.MediaSize.NA_LETTER)
                                .setMinMargins(new PrintAttributes.Margins(500,500,500,500))
                                .setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME).build());
                            if (job == null) throw new IllegalStateException("Print session unavailable");
                            printJob = job;
                        } catch (Exception e) { printError(); }
                    }
                });
                printWeb.loadDataWithBaseURL("https://shottime.local/",(String)decoded,"text/html","UTF-8",null);
            } catch (Exception e) { printError(); }
        });
    }
    // Failure before Android's print screen has the document.
    private void printError() {
        ++printGeneration;
        mainHandler.removeCallbacks(printTimeout);
        if (printWeb != null) { printWeb.destroy(); printWeb = null; }
        printPending = false;
        Toast.makeText(this,"Unable to open printing. Check your phone's print service and try again.",Toast.LENGTH_LONG).show();
    }
    private void printFailed() {
        if (printJob == null) { printError(); return; }
        // The print screen is already open: keep the session until Android reports it finished.
        if (printInterrupted) return;
        printInterrupted = true;
        if (printWeb != null) { printWeb.destroy(); printWeb = null; }
        Toast.makeText(this,"Printing was interrupted. Close the print screen and try again.",Toast.LENGTH_LONG).show();
    }
    private void finishPrint(int generation) {
        if (generation != printGeneration) return;
        ++printGeneration;
        mainHandler.removeCallbacks(printTimeout);
        if (printWeb != null) { printWeb.destroy(); printWeb = null; }
        printJob = null;
        printPending = false;
        printInterrupted = false;
        if (recreateAfterPrint && !isFinishing() && !isDestroyed()) {
            recreateAfterPrint = false;
            Toast.makeText(this,"Screen reloaded after a display error. Saved drafts will be restored.",Toast.LENGTH_LONG).show();
            recreate();
        }
    }
    // Fallback for print services that never report the print screen finished.
    private void clearFinishedPrint() {
        if (printJob == null) return;
        boolean done;
        try { done = printJob.isCompleted() || printJob.isCancelled() || printJob.isFailed(); }
        catch (Exception e) { done = false; }
        if (done) finishPrint(printGeneration);
    }
    private String readAsset(String name) throws Exception {
        try (InputStream stream = getAssets().open(name); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = stream.read(buffer)) != -1) output.write(buffer,0,count);
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }
    // Back closes overlays, then navigates up within QC Notes before the system default.
    private void handleBack() {
        if (web == null) { defaultBack(); return; }
        web.evaluateJavascript("typeof closeTopSheet==='function' && closeTopSheet()", result -> {
            if (!"true".equals(result) && web != null) {
                web.evaluateJavascript("!window.ShotNotesUI || ShotNotesUI.canLeave()", allowed -> {
                    if ("true".equals(allowed)) defaultBack();
                });
            }
        });
    }
    @SuppressWarnings("deprecation")
    private void defaultBack() { if (!isFinishing() && !isDestroyed()) super.onBackPressed(); }
    // Android 8â€“12 only; Android 13+ uses BackApi33 because the manifest enables OnBackInvokedCallback.
    @SuppressWarnings("deprecation")
    @Override public void onBackPressed() { handleBack(); }
    private static final class BackApi33 {
        static void register(MainActivity activity) {
            activity.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT, new OnBackInvokedCallback() {
                    @Override public void onBackInvoked() { activity.handleBack(); }
                });
        }
    }
    @Override protected void onResume() {
        super.onResume();
        ShotTimer.get(this).attach(this);
        if(getIntent().getBooleanExtra("showShotTimer",false)){getIntent().removeExtra("showShotTimer");ShotTimer.get(this).open();}
        clearFinishedPrint();
        mainHandler.removeCallbacks(voicePoll);mainHandler.post(voicePoll);
        mainHandler.removeCallbacks(levelPoll);mainHandler.post(levelPoll);
    }
    @Override protected void onPause() {
        if(holdVoice)stopVoice();
        mainHandler.removeCallbacks(voicePoll);
        mainHandler.removeCallbacks(levelPoll);
        if (web != null) web.evaluateJavascript("typeof captureDraft==='function' && captureDraft();window.ShotNotesUI && ShotNotesUI.flush()",null);
        super.onPause();
    }
    @Override protected void onDestroy() {
        ShotTimer.get(this).detach(this);
        mainHandler.removeCallbacks(voicePoll);
        mainHandler.removeCallbacks(levelPoll);
        ++printGeneration;
        mainHandler.removeCallbacks(printTimeout);
        // super.onDestroy() detaches Android's print adapter from this Activity, so the
        // snapshot is no longer in use when it is destroyed below.
        super.onDestroy();
        if (web != null) { web.destroy(); web = null; }
        if (printWeb != null) { printWeb.destroy(); printWeb = null; }
        printJob = null;
    }
    @Override protected void onStop(){ShotTimer.get(this).detach(this);super.onStop();}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);if(intent.getBooleanExtra("showShotTimer",false))ShotTimer.get(this).open();}
}
