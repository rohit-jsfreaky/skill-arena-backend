import admin from "firebase-admin";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Get the current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Firebase Admin with credentials
// NOTE: You need to replace this with your own Firebase Admin credentials

// In a production environment, you should use a proper service account
// and store the credentials securely (not in source code)
let firebaseAdmin;

try {
  // Check if Firebase is already initialized to avoid multiple initializations
  if (!admin.apps.length) {
    // Read the service account file using fs instead of require
    const serviceAccount = JSON.parse(
      readFileSync(join(__dirname, "../firebase-service-account.json"), "utf8")
    );

    firebaseAdmin = admin.initializeApp({
      // For development, you can use environment variables or application default credentials
      // For production, use a service account JSON file or environment variables

      // Using service account with ES modules
      credential: admin.credential.cert(serviceAccount),

      // Option 2: Using environment variables (uncomment and configure)
      // credential: admin.credential.cert({
      //   projectId: process.env.FIREBASE_PROJECT_ID,
      //   clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      //   privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      // })

      // Option 3: Using application default credentials (simplest for development)
      //   credential: admin.credential.applicationDefault(),
    });
    console.log("✅ Firebase Admin initialized successfully");
  } else {
    firebaseAdmin = admin.app();
  }
} catch (error) {
  console.error("❌ Firebase Admin initialization error:", error);
}

export default firebaseAdmin;
