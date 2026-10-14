import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const keyDirectory = resolve(workspace, '.android-signing');
const keyPath = resolve(keyDirectory, 'noir-upload.p12');
const configurationPath = resolve(keyDirectory, 'key-config.json');
const source = resolve(process.argv[2] || resolve(workspace, 'android/app/build/outputs/bundle/release/app-release.aab'));
const destination = resolve(process.argv[3] || resolve(workspace, 'generated-artifacts/android/noir-comic-creator-deluxe-vc1.aab'));
const alias = 'noir-upload';
const context = 'noircomics/android-upload-keystore/v1';

// Key passwords are consumed only by subprocesses. Never print or persist them.
// The domain-separated fallback uses an existing protected workspace secret;
// it is not the server's raw secret and is never embedded in the application.
let sourceName;
if (existsSync(configurationPath)) {
  sourceName = JSON.parse(readFileSync(configurationPath, 'utf8')).passwordSource;
} else {
  sourceName = process.env.ANDROID_UPLOAD_KEY_PASSWORD ? 'ANDROID_UPLOAD_KEY_PASSWORD' : 'SESSION_SECRET_DERIVED';
}
let password;
if (sourceName === 'ANDROID_UPLOAD_KEY_PASSWORD') {
  password = process.env.ANDROID_UPLOAD_KEY_PASSWORD;
} else if (sourceName === 'SESSION_SECRET_DERIVED' && process.env.SESSION_SECRET) {
  password = createHmac('sha256', process.env.SESSION_SECRET).update(context).digest('hex');
}
if (!password || password.length < 6) {
  throw new Error('The protected signing secret is unavailable. The existing key has not been changed.');
}
if (!existsSync(source)) throw new Error('Build the Android app bundle before signing.');
mkdirSync(keyDirectory, { recursive: true, mode: 0o700 });
chmodSync(keyDirectory, 0o700);
const environment = { ...process.env, NOIR_ANDROID_STORE_PASSWORD: password };
function run(program, args) {
  const result = spawnSync(program, args, { env: environment, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) {
    // Commands deliberately contain variable names, never password values.
    throw new Error(`${program} failed. The key remains private and no signing password has been logged.`);
  }
  return result.stdout || '';
}
if (!existsSync(keyPath)) {
  if (existsSync(configurationPath)) throw new Error('The original signing key is missing. Restore its private backup; do not replace it.');
  run('keytool', [
    '-genkeypair', '-keystore', keyPath, '-storetype', 'PKCS12',
    '-storepass:env', 'NOIR_ANDROID_STORE_PASSWORD', '-keypass:env', 'NOIR_ANDROID_STORE_PASSWORD',
    '-alias', alias, '-keyalg', 'RSA', '-keysize', '3072', '-sigalg', 'SHA256withRSA',
    '-validity', '10000', '-dname', 'CN=Noir Comics Android, O=Noir Comics',
  ]);
  chmodSync(keyPath, 0o600);
  writeFileSync(configurationPath, JSON.stringify({
    alias, passwordSource: sourceName, applicationId: 'nk.noircomicgen2.app',
    warning: 'Retain this private key and its protected password source for future releases. Re-encrypt before rotating the password source.',
  }, null, 2), { mode: 0o600 });
}
mkdirSync(dirname(destination), { recursive: true });
run('jarsigner', [
  '-keystore', keyPath, '-storetype', 'PKCS12', '-storepass:env', 'NOIR_ANDROID_STORE_PASSWORD',
  '-sigalg', 'SHA256withRSA', '-digestalg', 'SHA-256', '-signedjar', destination, source, alias,
]);
const verification = run('jarsigner', ['-verify', destination]);
if (!verification.includes('jar verified.')) throw new Error('Android bundle signature verification failed.');
console.log(JSON.stringify({ signedBundle: destination, signatureVerified: true, applicationId: 'nk.noircomicgen2.app' }));
