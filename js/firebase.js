import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getFirestore, collection, getDocs, getDoc, addDoc,
  updateDoc, deleteDoc, doc, serverTimestamp, setDoc
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  getAuth, signInWithPopup, GoogleAuthProvider,
  signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyDmNp6kUWYF3p_asPKblsEj5Dui5E-WNf8",
  authDomain: "windsurf-spot-finder.firebaseapp.com",
  projectId: "windsurf-spot-finder",
  storageBucket: "windsurf-spot-finder.firebasestorage.app",
  messagingSenderId: "520720418270",
  appId: "1:520720418270:web:d9738646339f4a4ed8c94f"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// ── Spots ────────────────────────────────────────────────────────

export async function getSpots() {
  const snap = await getDocs(collection(db, 'spots'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getSpot(id) {
  const snap = await getDoc(doc(db, 'spots', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function addSpot(data) {
  return await addDoc(collection(db, 'spots'), {
    ...data,
    erstellt_am: serverTimestamp(),
    erstellt_von: auth.currentUser?.uid ?? 'unknown'
  });
}

export async function updateSpot(id, data) {
  return await updateDoc(doc(db, 'spots', id), data);
}

export async function deleteSpot(id) {
  return await deleteDoc(doc(db, 'spots', id));
}

// ── Users ────────────────────────────────────────────────────────

export async function getUserRole(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data().role ?? 'viewer') : 'viewer';
}

export async function setUserRole(uid, role) {
  return await setDoc(doc(db, 'users', uid), { role }, { merge: true });
}

// ── Auth ─────────────────────────────────────────────────────────

export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  return await signInWithPopup(auth, provider);
}

export async function logout() {
  return await signOut(auth);
}

export { onAuthStateChanged };
