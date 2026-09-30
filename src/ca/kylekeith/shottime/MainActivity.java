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
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
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
                if (request.isForMainFrame() && "shottime://print".equals(request.getUrl().toString())) printList();
                return true;
            }
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
            String html = readAsset("index.html").replace("/*__TECHNIQUES__*/", readAsset("techniques.json"))
                .replace("/*__CALCULATOR__*/", readAsset("calculator.js"));
            web.loadDataWithBaseURL("https://shottime.local/", html, "text/html", "UTF-8", null);
        } catch (Exception error) {
            root.removeAllViews();
            TextView message = new TextView(this);
            message.setText("ShotTime could not load its chart. Please reinstall the APK.");
            message.setPadding(24,24,24,24);
            root.addView(message);
        }
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
                            final PrintDocumentAdapter delegate = view.createPrintDocumentAdapter("ShotTime shot list");
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
                            PrintJob job = manager.print("ShotTime shot list", adapter, new PrintAttributes.Builder()
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
    @Override public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        web.evaluateJavascript("typeof closeTopSheet==='function' && closeTopSheet()", result -> {
            if (!"true".equals(result)) MainActivity.super.onBackPressed();
        });
    }
    @Override protected void onResume() {
        super.onResume();
        clearFinishedPrint();
    }
    @Override protected void onPause() {
        if (web != null) web.evaluateJavascript("typeof captureDraft==='function' && captureDraft()",null);
        super.onPause();
    }
    @Override protected void onDestroy() {
        ++printGeneration;
        mainHandler.removeCallbacks(printTimeout);
        // super.onDestroy() detaches Android's print adapter from this Activity, so the
        // snapshot is no longer in use when it is destroyed below.
        super.onDestroy();
        if (web != null) { web.destroy(); web = null; }
        if (printWeb != null) { printWeb.destroy(); printWeb = null; }
        printJob = null;
    }
}
