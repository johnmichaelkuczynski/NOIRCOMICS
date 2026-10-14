package nk.noircomicgen2.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.QueryPurchasesParams;
import com.google.android.play.core.integrity.IntegrityManagerFactory;
import com.google.android.play.core.integrity.StandardIntegrityManager;
import com.revenuecat.purchases.CustomerInfo;
import com.revenuecat.purchases.Offerings;
import com.revenuecat.purchases.PurchaseParams;
import com.revenuecat.purchases.Purchases;
import com.revenuecat.purchases.PurchasesConfiguration;
import com.revenuecat.purchases.PurchasesError;
import com.revenuecat.purchases.interfaces.PurchaseCallback;
import com.revenuecat.purchases.interfaces.ReceiveCustomerInfoCallback;
import com.revenuecat.purchases.interfaces.ReceiveOfferingsCallback;
import com.revenuecat.purchases.models.StoreTransaction;
import com.revenuecat.purchases.models.GoogleStoreProduct;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.json.JSONObject;
import java.util.List;
import java.util.Locale;
import android.util.Base64;

public final class BillingController {
    private static boolean configured;
    private final Activity activity;
    private final WebView browser;
    private com.revenuecat.purchases.Package monthly;
    private boolean purchasing;
    private BillingClient ownershipClient;
    private final StandardIntegrityManager integrityManager;
    private StandardIntegrityManager.StandardIntegrityTokenProvider tokenProvider;
    private long providerProject;

    BillingController(Activity activity, WebView browser) {
        this.activity = activity;
        this.browser = browser;
        integrityManager = IntegrityManagerFactory.createStandard(activity.getApplicationContext());
    }

    @JavascriptInterface public String deviceId() {
        try {
            String id = Settings.Secure.getString(activity.getContentResolver(), Settings.Secure.ANDROID_ID);
            if (id == null || id.isEmpty()) return "";
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(("nk.noircomicgen2.app:" + id).getBytes(StandardCharsets.UTF_8));
            StringBuilder encoded = new StringBuilder();
            for (byte value : digest) encoded.append(String.format(Locale.ROOT, "%02x", value & 0xff));
            return encoded.toString();
        } catch (Exception error) { return ""; }
    }

    @JavascriptInterface public void identify(String customerId) {
        if (customerId == null || !customerId.matches("noir_[a-f0-9]{64}")) return;
        activity.runOnUiThread(() -> {
            try {
                if (!configured) {
                    Purchases.configure(new PurchasesConfiguration.Builder(
                        activity.getApplicationContext(), BuildConfig.REVENUECAT_API_KEY)
                        .appUserID(customerId).build());
                    configured = true;
                }
                loadOffering();
            } catch (Exception error) { notifyState("unavailable", "Subscription setup is unavailable. Generation will not bypass its limits.", ""); }
        });
    }

    private void loadOffering() {
        Purchases.getSharedInstance().getOfferings(new ReceiveOfferingsCallback() {
            @Override public void onReceived(Offerings offerings) {
                monthly = offerings.getCurrent() == null ? null : offerings.getCurrent().getMonthly();
                if (monthly != null) {
                    if (!(monthly.getProduct() instanceof GoogleStoreProduct)) monthly = null;
                    else {
                        GoogleStoreProduct product = (GoogleStoreProduct) monthly.getProduct();
                        if (!"noir_monthly_v1".equals(product.getProductId()) ||
                            !"monthly".equals(product.getBasePlanId()) ||
                            product.getDefaultOption() == null ||
                            !"monthly".equals(product.getDefaultOption().getId())) monthly = null;
                    }
                }
                if (monthly == null) {
                    notifyState("unavailable", "The monthly subscription is not yet available in Google Play. Free limits remain enforced.", "");
                } else {
                    notifyState("ready", "", monthly.getProduct().getPrice().getFormatted());
                }
            }
            @Override public void onError(PurchasesError error) {
                notifyState("unavailable", "Google Play has not made this subscription available. Free limits remain enforced.", "");
            }
        });
    }

    @JavascriptInterface public void purchase() {
        activity.runOnUiThread(() -> {
            if (purchasing) return;
            if (!configured || monthly == null) {
                notifyState("unavailable", "Subscription checkout is unavailable. Further generation is blocked after the free allowance.", "");
                return;
            }
            purchasing = true;
            notifyState("purchasing", "Complete the purchase in Google Play. Your writing is kept.", "");
            Purchases.getSharedInstance().purchase(new PurchaseParams.Builder(activity, monthly).build(), new PurchaseCallback() {
                @Override public void onCompleted(StoreTransaction transaction, CustomerInfo info) {
                    purchasing = false;
                    // Client callbacks never unlock access; the server verifies Google orders.
                    notifyState("purchased", "Purchase received. Verifying your subscription with the server…", "");
                }
                @Override public void onError(PurchasesError error, boolean cancelled) {
                    purchasing = false;
                    notifyState(cancelled ? "ready" : "check-owned", cancelled ? "Purchase cancelled. Your writing is kept." : "Checking whether Google Play completed your purchase. No access is granted before server verification.",
                        monthly.getProduct().getPrice().getFormatted());
                }
            });
        });
    }

    @JavascriptInterface public void restore() {
        activity.runOnUiThread(() -> {
            if (!configured) {
                notifyState("unavailable", "Subscription verification has not started. Reopen the app.", "");
                return;
            }
            notifyState("restored", "Looking up your purchases in Google Play. Your writing is kept.", "");
        });
    }
    @JavascriptInterface public void establishSession(String challenge, String callbackId) {
        activity.runOnUiThread(() -> attest("session", challenge, "", "", callbackId, null));
    }
    @JavascriptInterface public void attestGeneration(String challenge, String path, String payloadHash, String callbackId) {
        if (path == null || !path.matches("/api/comics/(generate|script|transcribe)") ||
            payloadHash == null || !payloadHash.matches("[a-f0-9]{64}")) {
            integrityError(callbackId, "Invalid generation request."); return;
        }
        activity.runOnUiThread(() -> attest("generation", challenge, payloadHash, path, callbackId, null));
    }
    @JavascriptInterface public void synchronizePurchases(String challenge, String callbackId) {
        activity.runOnUiThread(() -> {
            if (ownershipClient == null) {
                ownershipClient = BillingClient.newBuilder(activity.getApplicationContext())
                    .setListener((result, purchases) -> { })
                    .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                    .build();
            }
            if (ownershipClient.isReady()) queryOwned(challenge, callbackId);
            else ownershipClient.startConnection(new BillingClientStateListener() {
                @Override public void onBillingSetupFinished(BillingResult result) {
                    if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) queryOwned(challenge, callbackId);
                    else integrityError(callbackId, "Google Play Billing is unavailable on this device.");
                }
                @Override public void onBillingServiceDisconnected() {
                    integrityError(callbackId, "Google Play Billing disconnected. Try restoring again.");
                }
            });
        });
    }
    private void queryOwned(String challenge, String callbackId) {
        ownershipClient.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build(),
            (result, purchases) -> {
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    integrityError(callbackId, "Google Play could not restore purchases."); return;
                }
                Purchase selected = null;
                boolean pending = false;
                for (Purchase purchase : purchases) {
                    if (!purchase.getProducts().contains("noir_monthly_v1")) continue;
                    if (purchase.getPurchaseState() == Purchase.PurchaseState.PENDING) pending = true;
                    if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED &&
                        (selected == null || purchase.getPurchaseTime() > selected.getPurchaseTime())) selected = purchase;
                }
                if (selected == null) {
                    integrityError(callbackId, pending ? "Payment is pending. No paid access was activated."
                        : "No active Noir subscription was found in this Google Play account."); return;
                }
                String receipt = selected.getPurchaseToken();
                try { attest("receipt", challenge, hexHash(receipt), "", callbackId, receipt); }
                catch (Exception error) { integrityError(callbackId, "The purchase proof could not be prepared."); }
            });
    }
    private String hexHash(String text) throws Exception {
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        for (byte b : hash) result.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return result.toString();
    }
    private void attest(String purpose, String challenge, String payload, String path, String callbackId, String receipt) {
        if (callbackId == null || !callbackId.matches("[a-zA-Z0-9_-]{1,80}")) return;
        try {
            JSONObject data = new JSONObject(challenge);
            String nonce = data.getString("nonce");
            long project = Long.parseLong(data.getString("cloudProjectNumber"));
            String device = deviceId();
            if (!nonce.matches("[a-f0-9]{64}") || project <= 0 || !device.matches("[a-f0-9]{64}")) throw new Exception();
            String canonical = purpose.equals("session") ? "session\n" + nonce + "\n" + device
                : purpose.equals("receipt") ? "receipt\n" + nonce + "\n" + device + "\n" + payload
                : "generation\n" + nonce + "\n" + device + "\n" + path + "\n" + payload;
            String hash = Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8)),
                Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
            if (tokenProvider != null && providerProject == project) requestProof(hash, nonce, device, callbackId, receipt);
            else integrityManager.prepareIntegrityToken(StandardIntegrityManager.PrepareIntegrityTokenRequest.builder()
                .setCloudProjectNumber(project).build())
                .addOnSuccessListener(provider -> {
                    tokenProvider = provider; providerProject = project;
                    requestProof(hash, nonce, device, callbackId, receipt);
                }).addOnFailureListener(error -> integrityError(callbackId,
                    "Google Play device verification is unavailable. Install through the configured Play test or production track."));
        } catch (Exception error) { integrityError(callbackId, "The server's Google Play challenge is invalid."); }
    }
    private void requestProof(String hash, String nonce, String device, String callbackId, String receipt) {
        tokenProvider.request(StandardIntegrityManager.StandardIntegrityTokenRequest.builder().setRequestHash(hash).build())
            .addOnSuccessListener(proof -> {
                try {
                    JSONObject output = new JSONObject();
                    output.put("requestId", callbackId); output.put("nonce", nonce);
                    output.put("deviceId", device); output.put("integrityToken", proof.token());
                    if (receipt != null) output.put("purchaseToken", receipt);
                    deliverIntegrity(output);
                } catch (Exception error) { integrityError(callbackId, "The device proof could not be returned."); }
            }).addOnFailureListener(error -> {
                tokenProvider = null;
                integrityError(callbackId, "Google Play verification failed. No generation or subscription access was granted.");
            });
    }
    private void integrityError(String callbackId, String message) {
        try {
            JSONObject output = new JSONObject();
            output.put("requestId", callbackId); output.put("error", message);
            deliverIntegrity(output);
        } catch (Exception ignored) { }
    }
    private void deliverIntegrity(JSONObject output) {
        activity.runOnUiThread(() -> {
            if (!activity.isFinishing() && !activity.isDestroyed())
                browser.evaluateJavascript("window.__noirIntegrityResult && window.__noirIntegrityResult(" + output.toString() + ")", null);
        });
    }
    void close() {
        if (ownershipClient != null) ownershipClient.endConnection();
    }
    @JavascriptInterface public void manage() {
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(
                    "https://play.google.com/store/account/subscriptions?sku=noir_monthly_v1&package=nk.noircomicgen2.app")));
            } catch (Exception error) { notifyState("unavailable", "Open Google Play to manage your subscription.", ""); }
        });
    }
    private void notifyState(String state, String message, String price) {
        try {
            JSONObject json = new JSONObject();
            json.put("state", state);
            json.put("message", message);
            json.put("price", price);
            activity.runOnUiThread(() -> {
                if (!activity.isFinishing() && !activity.isDestroyed()) {
                    browser.evaluateJavascript("window.__noirBillingUpdate && window.__noirBillingUpdate(" + json.toString() + ")", null);
                }
            });
        } catch (Exception ignored) { /* Invalid UI data must never grant access. */ }
    }
}
