package nk.noircomicgen2.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLConnection;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String LOCAL_PATH = "/android-app/";
    private static final int AUDIO_REQUEST = 10;
    private static final int FILE_REQUEST = 11;
    private WebView browser;
    private BillingController billing;
    private PermissionRequest pendingAudio;
    private ValueCallback<Uri[]> pendingFiles;
    private final ExecutorService downloads = Executors.newSingleThreadExecutor();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.noir_ink));
        browser = new WebView(this);
        browser.setBackgroundColor(getColor(R.color.noir_paper));
        root.addView(browser, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                return insets;
            });
        } else root.setFitsSystemWindows(true);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::goBack);
        }
        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        browser.addJavascriptInterface(new DownloadBridge(), "NoirDownloads");
        billing = new BillingController(this, browser);
        browser.addJavascriptInterface(billing, "NoirBilling");
        browser.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!trusted(uri) || uri.getPath() == null || !uri.getPath().startsWith(LOCAL_PATH)) return null;
                String name = uri.getPath().substring(LOCAL_PATH.length());
                if (name.isEmpty()) name = "index.html";
                if (name.contains("..") || name.contains("\\") || !request.getMethod().equals("GET")) {
                    return missingAsset();
                }
                try {
                    if (name.equals("index.html")) {
                        String html = readAsset("web/index.html").replace("<head>",
                            "<head><script src=\"/android-app/billing-bridge.js\"></script><script src=\"/android-app/native-bridge.js\"></script>");
                        return new WebResourceResponse("text/html", "UTF-8", 200, "OK",
                            java.util.Collections.singletonMap("Cache-Control", "no-store"),
                            new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
                    }
                    if (name.equals("billing-bridge.js") || name.equals("native-bridge.js")) {
                        return new WebResourceResponse("application/javascript", "UTF-8", 200, "OK",
                            java.util.Collections.singletonMap("Cache-Control", "no-store"), getAssets().open(name));
                    }
                    String mime = URLConnection.guessContentTypeFromName(name);
                    if (name.endsWith(".js")) mime = "application/javascript";
                    if (name.endsWith(".css")) mime = "text/css";
                    if (name.endsWith(".woff2")) mime = "font/woff2";
                    if (mime == null) mime = "application/octet-stream";
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Cache-Control", "no-store");
                    headers.put("X-Content-Type-Options", "nosniff");
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers,
                        getAssets().open("web/" + name));
                } catch (Exception error) {
                    return missingAsset();
                }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (trusted(uri) && uri.getPath() != null && uri.getPath().startsWith(LOCAL_PATH)) return false;
                openExternal(uri);
                return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if (trusted(uri) && uri.getPath() != null && uri.getPath().startsWith(LOCAL_PATH)) {
                    try {
                        view.evaluateJavascript(readAsset("billing-bridge.js"), null);
                        view.evaluateJavascript(readAsset("native-bridge.js"), null);
                    }
                    catch (Exception error) { notifyUser("Android download controls could not start. Reopen the app."); }
                }
            }
        });
        browser.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean audio = false;
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) audio = true;
                    }
                    if (!trusted(request.getOrigin()) || !audio || isFinishing()) {
                        request.deny();
                        return;
                    }
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{ PermissionRequest.RESOURCE_AUDIO_CAPTURE });
                    } else {
                        if (pendingAudio != null) pendingAudio.deny();
                        pendingAudio = request;
                        requestPermissions(new String[]{ Manifest.permission.RECORD_AUDIO }, AUDIO_REQUEST);
                    }
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                runOnUiThread(() -> { if (pendingAudio == request) pendingAudio = null; });
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"text/plain", "text/markdown", "application/octet-stream"});
                try { startActivityForResult(intent, FILE_REQUEST); }
                catch (Exception error) {
                    pendingFiles.onReceiveValue(null);
                    pendingFiles = null;
                    notifyUser("A file picker is not available on this device.");
                }
                return true;
            }
        });
        browser.loadUrl(BuildConfig.APP_ORIGIN + LOCAL_PATH);
    }

    private boolean trusted(Uri uri) {
        Uri origin = Uri.parse(BuildConfig.APP_ORIGIN);
        return "https".equals(uri.getScheme()) && origin.getHost() != null
            && origin.getHost().equalsIgnoreCase(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443);
    }
    private WebResourceResponse missingAsset() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
            new HashMap<>(), new ByteArrayInputStream("App file not found. Reopen the app.".getBytes(StandardCharsets.UTF_8)));
    }
    private String readAsset(String name) throws Exception {
        try (InputStream input = getAssets().open(name); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }
    private void openExternal(Uri uri) {
        if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
        catch (Exception error) { notifyUser("No browser is available to open this link."); }
    }
    private void notifyUser(String message) {
        runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show());
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == AUDIO_REQUEST && pendingAudio != null) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
                pendingAudio.grant(new String[]{ PermissionRequest.RESOURCE_AUDIO_CAPTURE });
            } else {
                pendingAudio.deny();
                notifyUser("Microphone access denied. Enable it in Android app settings to dictate.");
            }
            pendingAudio = null;
        }
    }
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == FILE_REQUEST && pendingFiles != null) {
            Uri chosen = result == RESULT_OK && data != null ? data.getData() : null;
            pendingFiles.onReceiveValue(chosen != null ? new Uri[]{ chosen } : null);
            pendingFiles = null;
        }
    }
    private void goBack() { if (browser.canGoBack()) browser.goBack(); else finish(); }
    // API 33+ uses the native OnBackInvokedDispatcher registered in onCreate.
    // This override is solely the older Android 10–12 compatibility path.
    @SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed() { goBack(); }
    @Override protected void onPause() {
        browser.evaluateJavascript("window.__noirStopRecording && window.__noirStopRecording()", null);
        browser.onPause();
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (browser != null) {
            browser.onResume();
            browser.evaluateJavascript("window.__noirResumeBilling && window.__noirResumeBilling()", null);
        }
    }
    @Override protected void onDestroy() {
        if (pendingAudio != null) pendingAudio.deny();
        if (pendingFiles != null) pendingFiles.onReceiveValue(null);
        browser.removeJavascriptInterface("NoirDownloads");
        browser.removeJavascriptInterface("NoirBilling");
        if (billing != null) billing.close();
        browser.destroy();
        downloads.shutdown();
        super.onDestroy();
    }

    private final class DownloadBridge {
        @JavascriptInterface public void notify(String message) {
            notifyUser(message.length() > 250 ? message.substring(0, 250) : message);
        }
        @JavascriptInterface public void save(String data, String filename, String mime) {
            if (data.length() > 45 * 1024 * 1024) {
                notifyUser("This download is too large. Download fewer panels at a time.");
                return;
            }
            downloads.execute(() -> {
                Uri item = null;
                try {
                    String name = filename.replaceAll("[^a-zA-Z0-9._ -]", "_");
                    name = name.substring(0, Math.min(name.length(), 120));
                    if (name.trim().isEmpty()) name = "Noir-comics-download";
                    byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                    if (bytes.length > 32 * 1024 * 1024) throw new Exception("File too large");
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    values.put(MediaStore.Downloads.MIME_TYPE, mime);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/NoirComics");
                    values.put(MediaStore.Downloads.IS_PENDING, 1);
                    item = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (item == null) throw new Exception("Could not create download");
                    try (OutputStream output = getContentResolver().openOutputStream(item)) {
                        if (output == null) throw new Exception("Could not write download");
                        output.write(bytes);
                    }
                    ContentValues completed = new ContentValues();
                    completed.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContentResolver().update(item, completed, null, null);
                    notifyUser("Saved to Downloads/NoirComics: " + name);
                } catch (Exception error) {
                    if (item != null) getContentResolver().delete(item, null, null);
                    notifyUser("The file could not be saved. Free some storage and try again.");
                }
            });
        }
    }
}
