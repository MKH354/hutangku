import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, onSnapshot } from "firebase/firestore";

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Simpan data ke Firestore (under kode sinkron)
export async function saveData(syncCode, data) {
  const ref = doc(db, "hutangku", syncCode);
  await setDoc(ref, { payload: JSON.stringify(data), updatedAt: Date.now() });
}

// Langganan realtime ke Firestore
// callback(data, exists) — jika dokumen belum ada, exists=false dan data=null
export function subscribeData(syncCode, callback) {
  const ref = doc(db, "hutangku", syncCode);
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) {
        try {
          callback(JSON.parse(snap.data().payload), true);
        } catch (_) {
          callback(null, false);
        }
      } else {
        // Dokumen belum ada (user baru) — langsung selesai loading dengan data kosong
        callback(null, false);
      }
    },
    (error) => {
      console.error("Firestore error:", error);
      callback(null, false);
    }
  );
}
