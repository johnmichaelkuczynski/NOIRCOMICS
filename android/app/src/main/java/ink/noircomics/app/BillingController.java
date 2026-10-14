package ink.noircomics.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
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
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.json.JSONObject;

public final class BillingController {
    private static boolean configured;
    private final Activity activity;
    private final WebView browser;
    private com.revenuecat.purchases.Package monthly;
    private boolean purchasing;

    BillingController(Activity activity, WebView browser) {
        this.activity = activity;
        this.browser = browser;
    }

    @JavascriptInterface public String deviceId() {
        try {
            String id = Settings.Secure.getString(activity.getContentResolver(), Settings.Secure.ANDROID_ID);
            if (id == null || id.isEmpty()) return "";
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(("ink.noircomics.app:" + id).getBytes(StandardCharsets.UTF_8));
            StringBuilder encoded = new StringBuilder();
            for (byte value : digest) encoded.append(String.format("%02x", value & 0xff));
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
                    // Never unlock using the client's claim alone; the server verifies RevenueCat.
                    notifyState("purchased", "Purchase received. Verifying your subscription with the server…", "");
                }
                @Override public void onError(PurchasesError error, boolean cancelled) {
                    purchasing = false;
                    notifyState("ready", cancelled ? "Purchase cancelled. Your writing is kept." : "Purchase failed. Your writing is kept; try again.",
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
            Purchases.getSharedInstance().restorePurchases(new ReceiveCustomerInfoCallback() {
                @Override public void onReceived(CustomerInfo info) {
                    notifyState("restored", "Checking restored purchases with the server…", "");
                    loadOffering();
                }
                @Override public void onError(PurchasesError error) {
                    notifyState("unavailable", "Purchases could not be restored. Your writing is kept.", "");
                }
            });
        });
    }
    @JavascriptInterface public void manage() {
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(
                    "https://play.google.com/store/account/subscriptions?sku=noir_monthly_v1&package=ink.noircomics.app")));
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
