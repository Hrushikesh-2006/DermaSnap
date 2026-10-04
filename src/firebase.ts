import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';

export {
  signInAnonymously,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  onAuthStateChanged,
};
export type { User };
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  orderBy,
  getDocs,
  serverTimestamp,
  getDocFromServer,
  Timestamp,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// CRITICAL: Must pass databaseId per Skill instructions
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Standard Firestore Error Handling per SKILL.md
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Connection test on boot per SKILL.md
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore notice: client is currently offline or connecting.');
    }
  }
}
testConnection();

export interface UserProfileData {
  id: string;
  name: string;
  whatsappNumber: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface StoredConsultation {
  id: string;
  userId: string;
  patientName: string;
  whatsappNumber?: string;
  text?: string;
  summary?: string;
  urgency?: string;
  createdAt: any;
}

// Save or update user profile in Firestore
export async function saveUserProfileToDatabase(uid: string, name: string, whatsappNumber: string): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const path = `users/${uid}`;
  try {
    const existing = await getDoc(userRef);
    if (!existing.exists()) {
      await setDoc(userRef, {
        id: uid,
        name: name.trim(),
        whatsappNumber: whatsappNumber.trim(),
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        name: name.trim(),
        whatsappNumber: whatsappNumber.trim(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

// Fetch user profile from Firestore
export async function fetchUserProfileFromDatabase(uid: string): Promise<UserProfileData | null> {
  const userRef = doc(db, 'users', uid);
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      return snap.data() as UserProfileData;
    }
    return null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
    return null;
  }
}

// Save consultation record to Firestore subcollection
export async function saveConsultationToDatabase(
  uid: string,
  consultation: {
    id: string;
    patientName: string;
    whatsappNumber?: string;
    text?: string;
    summary?: string;
    urgency?: string;
  }
): Promise<void> {
  const consultationRef = doc(db, 'users', uid, 'consultations', consultation.id);
  const path = `users/${uid}/consultations/${consultation.id}`;
  try {
    await setDoc(consultationRef, {
      ...consultation,
      userId: uid,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

// Fetch all consultation records from Firestore subcollection for user
export async function fetchConsultationsFromDatabase(uid: string): Promise<StoredConsultation[]> {
  const collRef = collection(db, 'users', uid, 'consultations');
  const path = `users/${uid}/consultations`;
  try {
    const q = query(collRef, orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((docSnap) => {
      const data = docSnap.data();
      let formattedDate = new Date().toISOString();
      if (data.createdAt) {
        if (typeof data.createdAt.toDate === 'function') {
          formattedDate = data.createdAt.toDate().toISOString();
        } else if (typeof data.createdAt === 'string') {
          formattedDate = data.createdAt;
        }
      }
      return {
        id: docSnap.id,
        userId: data.userId || uid,
        patientName: data.patientName || 'Patient',
        whatsappNumber: data.whatsappNumber || '',
        text: data.text || '',
        summary: data.summary || '',
        urgency: data.urgency || 'Routine',
        createdAt: formattedDate,
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return [];
  }
}

// Delete consultation record from Firestore
export async function deleteConsultationFromDatabase(uid: string, consultationId: string): Promise<void> {
  const consultationRef = doc(db, 'users', uid, 'consultations', consultationId);
  const path = `users/${uid}/consultations/${consultationId}`;
  try {
    await deleteDoc(consultationRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// Safe persistent auth listener (avoids restricted anonymous auth error)
export async function getPersistentAuthUser(): Promise<User | null> {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

// Sign in with Google popup
export async function signInWithGoogle(): Promise<User> {
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}
