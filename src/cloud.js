// Firebase layer: email/password login + Firestore with an offline cache.
// Bundled into cloud.bundle.js (npm run bundle) so the site and the APK need no CDN.
import { initializeApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, onAuthStateChanged,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, getDoc, deleteDoc, onSnapshot, writeBatch } from 'firebase/firestore';

// Public client identifiers (not secrets). Access is enforced by firestore.rules.
const firebaseConfig = {
  apiKey: 'AIzaSyCB0s1SOwwQuTNfbumH94igL7PSOVCtgUM',
  authDomain: 'deathnote-5a3b5.firebaseapp.com',
  projectId: 'deathnote-5a3b5',
  storageBucket: 'deathnote-5a3b5.firebasestorage.app',
  messagingSenderId: '1006582232318',
  appId: '1:1006582232318:web:4c5827a1fd66545a99e1af',
};

const app = initializeApp(firebaseConfig);
const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  ignoreUndefinedProperties: true,
});

const col = () => collection(db, 'users', auth.currentUser.uid, 'trades');
const shotsCol = () => collection(db, 'users', auth.currentUser.uid, 'shots');   // images live apart from trades to keep the list light
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export const TJCloud = {
  onAuth: cb => onAuthStateChanged(auth, cb),
  signIn: (e, p) => signInWithEmailAndPassword(auth, e, p),
  signUp: (e, p) => createUserWithEmailAndPassword(auth, e, p),
  reset: e => sendPasswordResetEmail(auth, e),
  signOut: () => signOut(auth),
  // cb(trades, { pending, fromCache }); onErr(error)
  subscribe(cb, onErr) {
    return onSnapshot(col(), { includeMetadataChanges: true },
      s => cb(s.docs.map(d => d.data()), { pending: s.metadata.hasPendingWrites, fromCache: s.metadata.fromCache }), onErr);
  },
  // Offline, these promises stay pending until the server acknowledges; the local cache updates at once.
  save: t => setDoc(doc(col(), t.id), t),
  remove: id => deleteDoc(doc(col(), id)),
  async saveMany(list) { for (const c of chunks(list, 400)) { const b = writeBatch(db); c.forEach(t => b.set(doc(col(), t.id), t)); await b.commit(); } },
  async removeMany(ids) { for (const c of chunks(ids, 200)) { const b = writeBatch(db); c.forEach(id => { b.delete(doc(col(), id)); b.delete(doc(shotsCol(), id)); }); await b.commit(); } },
  saveShots: (id, images) => images.length ? setDoc(doc(shotsCol(), id), { id, images }) : deleteDoc(doc(shotsCol(), id)),
  async getShots(id) { const s = await getDoc(doc(shotsCol(), id)); return s.exists() ? (s.data().images || []) : []; },
};
