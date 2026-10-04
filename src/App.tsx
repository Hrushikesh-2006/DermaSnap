import React, { useState, useEffect, useRef } from 'react';
import { SymptomTrendsChart } from './components/SymptomTrendsChart';
import { CameraCaptureModal } from './components/CameraCaptureModal';
import { ConsultationHistoryModal } from './components/ConsultationHistoryModal';
import {
  Activity,
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  Copy,
  Database,
  Edit2,
  ExternalLink,
  FileText,
  History,
  Image as ImageIcon,
  Info,
  Loader2,
  MessageSquare,
  Phone,
  RefreshCw,
  Send,
  Settings,
  Share2,
  ShieldAlert,
  Smartphone,
  Sparkles,
  TrendingUp,
  Upload,
  User,
  PanelRight,
  X,
} from 'lucide-react';
import {
  auth,
  getPersistentAuthUser,
  signInWithGoogle,
  saveUserProfileToDatabase,
  fetchUserProfileFromDatabase,
  saveConsultationToDatabase,
  googleProvider,
  signOut,
} from './firebase';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imagePreview?: string;
  timestamp: string;
  source?: 'gemini' | 'knowledge_base' | 'knowledge_base_fallback';
}

interface ServerStatus {
  geminiConfigured: boolean;
  geminiModel: string;
  twilioConfigured: boolean;
  twilioFrom: string;
  openaiConfigured: boolean;
}

const WELCOME_TEMPLATE = (name: string) =>
  `Hey ${name || 'there'}! I'm DermaSnap - your AI skin-health & clinical triage assistant.\n\nSend a clear photo of your skin concern or describe your symptoms (such as itching, pain, heat, duration, location).\n\nI will provide an evidence-based assessment with preliminary medication recommendations, safe care regimens, and urgency rating. Hit "Send to WhatsApp" anytime to dispatch the full prescription & care report to your phone.`;

const SAMPLE_CASES = [
  {
    title: 'Eczema / Dermatitis',
    desc: 'Itchy red patch with dry skin',
    prompt: 'I have this itchy, red, slightly swollen patch with dry skin on my inner arm for 4 days.',
    color: 'from-amber-500/20 to-rose-500/20 border-rose-200 text-rose-800',
  },
  {
    title: 'Acne / Folliculitis',
    desc: 'Red bumps and pores after workout',
    prompt: 'Sudden breakout of red bumps and small pimples on my forehead and jawline after hot weather and workout.',
    color: 'from-orange-500/20 to-amber-500/20 border-orange-200 text-orange-800',
  },
  {
    title: 'Insect Bite / Welt',
    desc: 'Focal raised welt with central point',
    prompt: 'Woke up with an itchy, raised red welt on my ankle that feels warm to the touch.',
    color: 'from-teal-500/20 to-emerald-500/20 border-teal-200 text-teal-800',
  },
];

interface SymptomItem {
  id: string;
  label: string;
  keywords: string[];
  appendPhrase: string;
}

const COMMON_SYMPTOMS: SymptomItem[] = [
  { id: 'itching', label: 'Itching', keywords: ['itch', 'itching', 'pruritus'], appendPhrase: 'itching' },
  { id: 'pain', label: 'Pain', keywords: ['pain', 'painful', 'hurts', 'sore', 'tender'], appendPhrase: 'pain and tenderness' },
  { id: 'heat', label: 'Heat / Warmth', keywords: ['heat', 'warm', 'warmth', 'hot'], appendPhrase: 'heat / warmth' },
  { id: 'swelling', label: 'Swelling', keywords: ['swell', 'swelling', 'swollen', 'puffy'], appendPhrase: 'swelling' },
  { id: 'burning', label: 'Burning', keywords: ['burn', 'burning', 'stinging'], appendPhrase: 'burning sensation' },
  { id: 'dryness', label: 'Dryness / Peeling', keywords: ['dry', 'peel', 'peeling', 'flaking', 'scales'], appendPhrase: 'dryness and peeling' },
  { id: 'pus', label: 'Pus / Blisters', keywords: ['pus', 'blister', 'oozing'], appendPhrase: 'blisters or pus' },
];

// Client-side image compressor utility
function compressImage(file: File, maxDimension = 1200, quality = 0.85): Promise<{ base64: string; preview: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return resolve({
            base64: reader.result as string,
            preview: reader.result as string,
            mimeType: file.type || 'image/jpeg',
          });
        }

        ctx.drawImage(img, 0, 0, width, height);
        const mimeType = 'image/jpeg';
        const compressedBase64 = canvas.toDataURL(mimeType, quality);
        resolve({
          base64: compressedBase64,
          preview: compressedBase64,
          mimeType,
        });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function cleanDigits(phone: string): string {
  return (phone || '').replace(/[^0-9]/g, '');
}

function getClientClinicalTriage(userText: string, hasImage: boolean, patientName: string): string {
  const lower = (userText || '').toLowerCase();

  let condition = 'Contact Dermatitis / Generalized Skin Irritation';
  let possibilities = 'Allergic contact dermatitis, irritant dermatitis, or mild superficial eczema flare';
  let trigger = 'Cutaneous epidermal barrier disruption from external irritants (detergents, harsh soaps, fragrances), weather shifts, or friction.';
  let urgency = 'Routine to Soon (consult clinician if not resolving within 5-7 days)';
  let otcMeds = '• **Hydrocortisone 1% Cream (OTC):** Apply a thin layer to affected skin 1 to 2 times daily for a maximum of 5 to 7 days to relieve redness and itching.\n• **Ceramide Barrier Emollient (e.g. CeraVe / Aveeno Colloidal Oatmeal):** Apply generously twice daily to restore skin lipid barrier.\n• **Oral Antihistamine (Cetirizine 10mg or Loratadine 10mg):** Take 1 tablet daily if itchiness disrupts sleep or daytime comfort.';
  let rxMeds = '• **Moderate-potency Corticosteroid (Triamcinolone acetonide 0.1% cream):** Evaluated by a dermatologist if OTC hydrocortisone is insufficient.\n• **Calcineurin Inhibitor (Tacrolimus 0.03% or Pimecrolimus 1% cream):** Non-steroidal prescription option ideal for face, neck, or sensitive skin folds.';
  let precautions = 'Avoid applying topical steroids near the eyes or on broken/infected skin. Do not use potent steroids continuously beyond 1-2 weeks without physician oversight.';

  if (lower.includes('acne') || lower.includes('pimple') || lower.includes('forehead') || lower.includes('sweat') || lower.includes('blackhead') || lower.includes('whitehead')) {
    condition = 'Acne Vulgaris / Folliculitis';
    possibilities = 'Inflammatory acne vulgaris, papulopustular acne, or pityrosporum folliculitis';
    trigger = 'Sebaceous gland hyperactivity, pore plugging with keratin debris, and localized Cutibacterium acnes / fungal microbial proliferation.';
    urgency = 'Routine';
    otcMeds = '• **Benzoyl Peroxide 2.5% to 5% Gel (OTC):** Apply once daily at night on clean dry skin (kills acne bacteria and reduces inflammation).\n• **Salicylic Acid 2% Cleanser (OTC):** Wash affected areas once daily to unclog follicular pores.\n• **Oil-Free Non-Comedogenic Hydrating Gel:** Prevent reactive oil overproduction.';
    rxMeds = '• **Topical Retinoid (Adapalene 0.1% or Tretinoin 0.025% cream):** Gold-standard prescription retinoid to normalize cell turnover and prevent new microcomedones.\n• **Topical Clindamycin 1% + Benzoyl Peroxide gel:** Prescription antibacterial combination for inflammatory pustules.\n• **Oral Doxycycline (50-100mg daily):** Prescribed for moderate-to-severe inflammatory flares under physician monitoring.';
    precautions = 'Benzoyl peroxide can bleach fabric; wash hands after application. Retinoids increase sun sensitivity; apply sunscreen daily and start with every-other-night use.';
  } else if (lower.includes('itch') || lower.includes('scratch') || lower.includes('eczema') || lower.includes('dry')) {
    condition = 'Atopic Dermatitis (Eczema) Flare';
    possibilities = 'Subacute atopic eczema, nummular dermatitis, or xerotic eczema';
    trigger = 'Genetic filaggrin deficiency leading to moisture loss and hyper-reactive immune inflammatory response.';
    urgency = 'Routine to Soon';
    otcMeds = '• **Hydrocortisone 1% Ointment (OTC):** Ointment formulation preferred over cream for dry eczema; apply twice daily to active itchy patches.\n• **Heavy Barrier Ointment (e.g. Petroleum Jelly / Aquaphor):** Apply immediately after a brief lukewarm shower to lock in moisture.\n• **Oral Antihistamine (Diphenhydramine 25mg at bedtime or Cetirizine 10mg):** Alleviates nocturnal pruritus and prevents sleep-scratch cycle.';
    rxMeds = '• **Prescription Topical Corticosteroid (Desonide 0.05% or Triamcinolone 0.1%):** Short-course anti-inflammatory for acute flare control.\n• **Topical PDE4 Inhibitor (Crisaborole 2% ointment) or Calcineurin Inhibitor:** Non-steroidal steroid-sparing prescription maintenance.';
    precautions = 'Avoid hot showers and wool fabrics. Never scratch actively—use an ice pack wrapped in a clean towel to numb itching.';
  } else if (lower.includes('bite') || lower.includes('bug') || lower.includes('insect') || lower.includes('welt') || lower.includes('sting')) {
    condition = 'Arthropod Bite Reaction (Insect Bite / Strophulus)';
    possibilities = 'Localized hypersensitivity welt from mosquito, flea, or mite bite';
    trigger = 'Direct histamine and immune mediator release triggered by salivary proteins injected during the insect bite.';
    urgency = 'Routine (treat as Urgent if experiencing breathing difficulty or facial swelling)';
    otcMeds = '• **Calamine Lotion with Pramoxine (OTC):** Apply 3-4 times daily for fast topical cooling and antipruritic itch relief.\n• **Hydrocortisone 1% Cream (OTC):** Apply to the center of the welt twice daily for 3 days to bring down swelling.\n• **Oral Antihistamine (Cetirizine 10mg or Fexofenadine 180mg):** Blunts systemic histamine release and accelerates swelling resolution.';
    rxMeds = '• **High-potency Topical Corticosteroid (Betamethasone dipropionate 0.05%):** May be prescribed by clinician for exaggerated bullous bite reactions without infection.\n• **Topical Mupirocin 2% Ointment:** Prescription antibiotic applied if scratching caused secondary bacterial impetiginization (yellow crusting or pus).';
    precautions = 'Do not break the blister or scratch the head of the welt to avoid bacterial infection (cellulitis). If red streaks appear, seek medical evaluation.';
  } else if (lower.includes('fungus') || lower.includes('ring') || lower.includes('groin') || lower.includes('foot') || lower.includes('athlete')) {
    condition = 'Tinea Infection (Dermatophytosis / Ringworm / Athlete\'s Foot)';
    possibilities = 'Tinea corporis, tinea cruris (jock itch), or tinea pedis';
    trigger = 'Superficial fungal infection of keratinized stratum corneum by Trichophyton or Microsporum species.';
    urgency = 'Routine';
    otcMeds = '• **Clotrimazole 1% or Terbinafine 1% Cream (OTC):** Apply to affected area and 1 inch beyond the red border twice daily for 2 to 4 weeks.\n• **Keep Area Dry:** Apply antifungal tolnaftate powder in shoes or skin folds to minimize moisture.';
    rxMeds = '• **Prescription Ciclopirox 0.77% cream or Ketoconazole 2% cream:** Broad-spectrum antifungal for resistant dermatophytes.\n• **Oral Terbinafine (250mg) or Fluconazole:** Prescribed by dermatologist for extensive or nail/scalp involvement.';
    precautions = 'IMPORTANT: Avoid topical steroid creams (like hydrocortisone) alone on fungal rashes; steroids feed fungi and cause "tinea incognito". Continue antifungal for 1 week after lesions clear.';
  }

  return `🩺 **Clinical Triage & Medicine Prescription Assessment**
*DermaSnap Clinical Dermatology Knowledge Base*

1. **Observable Characteristics:**
   ${hasImage ? 'Visible skin surface variation with localized erythema (redness) and tissue morphology' : 'Reported localized cutaneous symptoms'} consistent with "${userText || 'skin concern'}".

2. **Diagnostic Impression:**
   - **Primary Suspected Condition:** ${condition}
   - **Differential Possibilities:** ${possibilities}
   *(Preliminary assessment for guidance; not a definitive medical diagnosis).*

3. **Underlying Cause & Mechanism:**
   ${trigger}

4. **Urgency Rating:**
   **${urgency}**. If emergency signs appear (fever, rapid spreading, facial swelling, or breathing difficulty), seek immediate emergency medical care.

5. **Recommended Medications & Treatment Regimen:**
   **First-Line Over-The-Counter (OTC) Regimen:**
${otcMeds}

   **Prescription Medications for Doctor Evaluation:**
${rxMeds}

   **Application Instructions & Safety Precautions:**
   - Cleanse and thoroughly dry the area before applying topical medications.
   - Apply a thin, even layer; more is not better and increases side effects.
   - ${precautions}

6. **Supportive Self-Care:**
   - Use only lukewarm water and mild, soap-free cleansers.
   - Wear loose-fitting breathable cotton clothing to minimize friction and sweat.
   - Avoid known allergens, fragrances, fabric softeners, or harsh chemicals.

7. **Medical Notice:**
   *DermaSnap provides preliminary clinical information and evidence-based medication guidance for ${patientName || 'Patient'}. Final prescription confirmation and dosing should be verified by a licensed doctor or pharmacist.*`;
}

export default function App() {
  // Database & persistent auth state
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isDbLoading, setIsDbLoading] = useState(true);
  const [dbSyncStatus, setDbSyncStatus] = useState<string>('Syncing...');

  const [onboarded, setOnboarded] = useState<boolean>(() => {
    return Boolean(localStorage.getItem('dermasnap_onboarded'));
  });
  const [userName, setUserName] = useState<string>(() => {
    return localStorage.getItem('dermasnap_name') || '';
  });
  const [whatsappNumber, setWhatsappNumber] = useState<string>(() => {
    return localStorage.getItem('dermasnap_whatsapp') || '';
  });

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [selectedImage, setSelectedImage] = useState<{
    file?: File;
    preview: string;
    base64: string;
    mimeType: string;
    name?: string;
  } | null>(null);

  const [isCompressing, setIsCompressing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Profile & settings modal
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editProfileName, setEditProfileName] = useState('');
  const [editProfilePhone, setEditProfilePhone] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // WhatsApp summary & dispatch states
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [generatedSummary, setGeneratedSummary] = useState('');
  const [targetPhone, setTargetPhone] = useState('');
  const [isEditingPhone, setIsEditingPhone] = useState(false);
  const [whatsappDispatchStatus, setWhatsappDispatchStatus] = useState<{
    success: boolean;
    message: string;
    waLink?: string;
    webWaLink?: string;
    deepLink?: string;
  } | null>(null);

  // Reference notes modal
  const [knowledgeModalOpen, setKnowledgeModalOpen] = useState(false);
  const [knowledgeText, setKnowledgeText] = useState('');

  // Emergency red flags modal
  const [warningModalOpen, setWarningModalOpen] = useState(false);

  // Symptom trends chart modal
  const [trendsChartOpen, setTrendsChartOpen] = useState(false);

  // Direct camera capture modal with permission handler
  const [cameraModalOpen, setCameraModalOpen] = useState(false);

  // Side panel toggle state (Symptoms & Scenarios on the side)
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Client device ID for seamless persistent authentication across sessions
  const getDeviceId = () => {
    let id = localStorage.getItem('dermasnap_device_id');
    if (!id) {
      id = 'dev-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString(36);
      localStorage.setItem('dermasnap_device_id', id);
    }
    return id;
  };

  // Initialize persistent user profile from database & auth
  useEffect(() => {
    let isMounted = true;
    const deviceId = getDeviceId();

    const restoreUserProfile = async () => {
      try {
        // 1. Check if Firebase Auth has an active Google user
        const fbUser = await getPersistentAuthUser();
        if (fbUser && isMounted) {
          setCurrentUser(fbUser);
          const firestoreProfile = await fetchUserProfileFromDatabase(fbUser.uid);
          if (firestoreProfile?.name && firestoreProfile?.whatsappNumber) {
            setUserName(firestoreProfile.name);
            setWhatsappNumber(firestoreProfile.whatsappNumber);
            setTargetPhone(firestoreProfile.whatsappNumber);
            setEditProfileName(firestoreProfile.name);
            setEditProfilePhone(firestoreProfile.whatsappNumber);
            setOnboarded(true);
            setDbSyncStatus('Saved in Firestore');

            localStorage.setItem('dermasnap_onboarded', 'true');
            localStorage.setItem('dermasnap_name', firestoreProfile.name);
            localStorage.setItem('dermasnap_whatsapp', firestoreProfile.whatsappNumber);
            return;
          }
        }

        // 2. Query persistent server database
        const serverRes = await fetch(
          `/api/user/me?deviceId=${encodeURIComponent(deviceId)}${
            fbUser ? `&uid=${encodeURIComponent(fbUser.uid)}` : ''
          }`
        );
        const serverData = await serverRes.json();

        if (serverData?.user && isMounted) {
          const u = serverData.user;
          setUserName(u.name);
          setWhatsappNumber(u.whatsappNumber);
          setTargetPhone(u.whatsappNumber);
          setEditProfileName(u.name);
          setEditProfilePhone(u.whatsappNumber);
          setOnboarded(true);
          setDbSyncStatus('Saved in Database');

          localStorage.setItem('dermasnap_onboarded', 'true');
          localStorage.setItem('dermasnap_name', u.name);
          localStorage.setItem('dermasnap_whatsapp', u.whatsappNumber);
          return;
        }

        // 3. Fallback to localStorage cache
        const cachedName = localStorage.getItem('dermasnap_name');
        const cachedPhone = localStorage.getItem('dermasnap_whatsapp');
        if (cachedName && cachedPhone && isMounted) {
          setUserName(cachedName);
          setWhatsappNumber(cachedPhone);
          setTargetPhone(cachedPhone);
          setEditProfileName(cachedName);
          setEditProfilePhone(cachedPhone);
          setOnboarded(true);
          setDbSyncStatus('Saved in Database');

          // Sync to server database
          fetch('/api/user/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              deviceId,
              uid: fbUser?.uid || null,
              name: cachedName,
              whatsappNumber: cachedPhone,
            }),
          }).catch(() => {});
          return;
        }

        if (isMounted) {
          setDbSyncStatus('Ready for setup');
        }
      } catch (err) {
        console.warn('Profile load notice:', err);
      } finally {
        if (isMounted) setIsDbLoading(false);
      }
    };

    restoreUserProfile();

    return () => {
      isMounted = false;
    };
  }, []);

  // Load server status & knowledge
  useEffect(() => {
    fetch('/api/status')
      .then((res) => res.json())
      .then((data) => setServerStatus(data))
      .catch((err) => console.warn('Failed to load server status:', err));

    fetch('/api/knowledge')
      .then((res) => res.json())
      .then((data) => setKnowledgeText(data.knowledge || ''))
      .catch((err) => console.warn('Failed to load knowledge notes:', err));
  }, []);

  // Sync target phone with profile
  useEffect(() => {
    if (whatsappNumber && !targetPhone) {
      setTargetPhone(whatsappNumber);
    }
  }, [whatsappNumber]);

  // Initialize welcome message when onboarded
  useEffect(() => {
    if (onboarded && messages.length === 0) {
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          content: WELCOME_TEMPLATE(userName),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    }
  }, [onboarded]);

  // Scroll to bottom on updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, isCompressing]);

  // Clipboard paste support for images
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            await processAndSetImage(file);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const processAndSetImage = async (file: File) => {
    setIsCompressing(true);
    try {
      const compressed = await compressImage(file);
      setSelectedImage({
        file,
        preview: compressed.preview,
        base64: compressed.base64,
        mimeType: compressed.mimeType,
        name: file.name || 'skin-photo.jpg',
      });
    } catch (err) {
      console.error('Image compression failed:', err);
    } finally {
      setIsCompressing(false);
    }
  };

  const handleOnboardingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim() || !whatsappNumber.trim()) return;

    const trimmedName = userName.trim();
    const trimmedPhone = whatsappNumber.trim();
    const deviceId = getDeviceId();

    localStorage.setItem('dermasnap_onboarded', 'true');
    localStorage.setItem('dermasnap_name', trimmedName);
    localStorage.setItem('dermasnap_whatsapp', trimmedPhone);
    setTargetPhone(trimmedPhone);
    setEditProfileName(trimmedName);
    setEditProfilePhone(trimmedPhone);
    setOnboarded(true);

    // Save directly to server database
    try {
      await fetch('/api/user/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          uid: currentUser?.uid || null,
          name: trimmedName,
          whatsappNumber: trimmedPhone,
        }),
      });
      setDbSyncStatus('Saved in Database');
    } catch (err) {
      console.warn('Failed to save user profile to server database:', err);
    }

    // Save directly to Firestore database if authenticated
    if (currentUser) {
      try {
        await saveUserProfileToDatabase(currentUser.uid, trimmedName, trimmedPhone);
      } catch (err) {
        console.warn('Firestore sync note:', err);
      }
    }
  };

  const handleSaveProfileChanges = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editProfileName.trim() || !editProfilePhone.trim()) return;

    setIsSavingProfile(true);
    const trimmedName = editProfileName.trim();
    const trimmedPhone = editProfilePhone.trim();
    const deviceId = getDeviceId();

    setUserName(trimmedName);
    setWhatsappNumber(trimmedPhone);
    setTargetPhone(trimmedPhone);
    localStorage.setItem('dermasnap_name', trimmedName);
    localStorage.setItem('dermasnap_whatsapp', trimmedPhone);

    try {
      await fetch('/api/user/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          uid: currentUser?.uid || null,
          name: trimmedName,
          whatsappNumber: trimmedPhone,
        }),
      });
      setDbSyncStatus('Updated in Database');
    } catch (err) {
      console.warn('Error updating profile in database:', err);
    }

    if (currentUser) {
      try {
        await saveUserProfileToDatabase(currentUser.uid, trimmedName, trimmedPhone);
      } catch (err) {
        console.warn('Firestore update note:', err);
      }
    }

    setIsSavingProfile(false);
    setProfileModalOpen(false);
  };

  const handleClearChat = () => {
    setMessages([
      {
        id: 'welcome-' + Date.now(),
        role: 'assistant',
        content: WELCOME_TEMPLATE(userName),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    setSelectedImage(null);
    setInputText('');
    setGeneratedSummary('');
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processAndSetImage(file);
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      await processAndSetImage(file);
    }
  };

  const sendMessage = async (
    customText?: string,
    overrideImage?: { base64: string; mimeType: string; preview: string }
  ) => {
    const textToSend = customText !== undefined ? customText : inputText;
    const currentImg = overrideImage || selectedImage;
    if (!textToSend.trim() && !currentImg) return;
    const displayText = textToSend.trim();

    const userMessageId = 'msg-' + Date.now();
    const newUserMessage: Message = {
      id: userMessageId,
      role: 'user',
      content: displayText || (currentImg ? 'Skin concern photo attached for visual triage' : ''),
      imagePreview: currentImg ? currentImg.preview : undefined,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const historyPayload = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setMessages((prev) => [...prev, newUserMessage]);
    setInputText('');
    setSelectedImage(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: historyPayload,
          text: displayText,
          imageBase64: currentImg?.base64,
          imageMimeType: currentImg?.mimeType,
          userName,
        }),
      });

      let data: any = null;
      let rawText = '';
      try {
        rawText = await response.text();
        data = JSON.parse(rawText);
      } catch {
        // Handle non-JSON server text or HTML gracefully
      }

      if (!response.ok || !data || !data.answer) {
        throw new Error(data?.error || (rawText ? rawText.slice(0, 80) : 'Server connection failed'));
      }

      const assistantContent = data.answer;

      setMessages((prev) => [
        ...prev,
        {
          id: 'asst-' + Date.now(),
          role: 'assistant',
          content: assistantContent,
          source: data.source,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);

      // Automatically persist consultation record in Firestore database
      if (currentUser) {
        saveConsultationToDatabase(currentUser.uid, {
          id: 'consult-' + Date.now(),
          patientName: userName || 'Patient',
          whatsappNumber: whatsappNumber || targetPhone,
          text: displayText,
          summary: assistantContent,
          urgency: assistantContent.toLowerCase().includes('urgent') ? 'Urgent' : 'Routine',
        }).catch((dbErr) => console.warn('Consultation save notice:', dbErr));
      }
    } catch (err: any) {
      console.warn('Backend consultation notice:', err?.message || err);
      // Seamlessly generate clinically grounded triage note
      const fallbackAssessment = getClientClinicalTriage(displayText, Boolean(currentImg), userName);

      setMessages((prev) => [
        ...prev,
        {
          id: 'asst-' + Date.now(),
          role: 'assistant',
          content: fallbackAssessment,
          source: 'knowledge_base_fallback',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);

      if (currentUser) {
        saveConsultationToDatabase(currentUser.uid, {
          id: 'consult-' + Date.now(),
          patientName: userName || 'Patient',
          whatsappNumber: whatsappNumber || targetPhone,
          text: displayText,
          summary: fallbackAssessment,
          urgency: fallbackAssessment.toLowerCase().includes('urgent') ? 'Urgent' : 'Routine',
        }).catch((dbErr) => console.warn('Consultation save notice:', dbErr));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenSummaryModal = async (initialContent?: string) => {
    setSummaryModalOpen(true);
    setWhatsappDispatchStatus(null);
    setIsEditingPhone(false);
    const activePhone = targetPhone || whatsappNumber;

    if (initialContent) {
      const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const customReport = `🩺 *DERMASNAP CLINICAL CARE & TRIAGE REPORT*
👤 *Patient:* ${userName}
📅 *Date:* ${today}

📋 *ASSESSMENT & CARE REGIMEN:*
${initialContent}

⚠️ *DISCLAIMER:* Cautious preliminary triage only. Consult a licensed clinician for medical advice.`;

      setGeneratedSummary(customReport);
      const digits = cleanDigits(activePhone);
      const encoded = encodeURIComponent(customReport);
      setWhatsappDispatchStatus({
        success: true,
        message: `Report prepared for +${digits}. Click below to send directly on WhatsApp!`,
        waLink: `https://api.whatsapp.com/send?phone=${digits}&text=${encoded}`,
        webWaLink: `https://web.whatsapp.com/send?phone=${digits}&text=${encoded}`,
        deepLink: `whatsapp://send?phone=${digits}&text=${encoded}`,
      });
      return;
    }

    setIsGeneratingSummary(true);
    try {
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          userName,
        }),
      });

      const data = await response.json();
      const report = data.summary || 'Summary ready.';
      setGeneratedSummary(report);

      const digits = cleanDigits(activePhone);
      const encoded = encodeURIComponent(report);
      setWhatsappDispatchStatus({
        success: true,
        message: `Clinical care summary ready for +${digits || 'your WhatsApp'}!`,
        waLink: `https://api.whatsapp.com/send?phone=${digits}&text=${encoded}`,
        webWaLink: `https://web.whatsapp.com/send?phone=${digits}&text=${encoded}`,
        deepLink: `whatsapp://send?phone=${digits}&text=${encoded}`,
      });
    } catch (err: any) {
      setGeneratedSummary(`Error generating summary: ${err.message}`);
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleSendToWhatsapp = async () => {
    const phoneToUse = targetPhone || whatsappNumber;
    if (!phoneToUse) return;

    setIsGeneratingSummary(true);
    try {
      const response = await fetch('/api/send-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: phoneToUse,
          userName,
          summary: generatedSummary,
        }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        setWhatsappDispatchStatus({
          success: true,
          message: data.message || 'Notification processed!',
          waLink: data.waLink,
          webWaLink: data.webWaLink,
          deepLink: data.deepLink,
        });

        if (data.waLink && data.method === 'direct_link') {
          const win = window.open(data.waLink, '_blank');
          if (!win) {
            console.log('Popup handled via in-app button');
          }
        }
      } else {
        const digits = cleanDigits(phoneToUse);
        const encoded = encodeURIComponent(generatedSummary);
        setWhatsappDispatchStatus({
          success: true,
          message: 'Direct WhatsApp link generated below:',
          waLink: `https://api.whatsapp.com/send?phone=${digits}&text=${encoded}`,
          webWaLink: `https://web.whatsapp.com/send?phone=${digits}&text=${encoded}`,
        });
      }
    } catch (err: any) {
      const digits = cleanDigits(phoneToUse);
      const encoded = encodeURIComponent(generatedSummary);
      setWhatsappDispatchStatus({
        success: true,
        message: 'Direct WhatsApp link generated below:',
        waLink: `https://api.whatsapp.com/send?phone=${digits}&text=${encoded}`,
        webWaLink: `https://web.whatsapp.com/send?phone=${digits}&text=${encoded}`,
      });
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleToggleSymptom = (symptom: SymptomItem) => {
    const current = inputText.trim();
    const lower = current.toLowerCase();
    const isPresent = symptom.keywords.some((kw) => lower.includes(kw));

    if (isPresent) {
      let updated = current;
      for (const kw of symptom.keywords) {
        const regex = new RegExp(`(,\\s*)?(and\\s*)?(\\b${kw}\\b[^,\\.]*)`, 'gi');
        updated = updated.replace(regex, '');
      }
      updated = updated
        .replace(/,\s*,/g, ',')
        .replace(/,\s*\./g, '.')
        .replace(/^\s*,\s*/, '')
        .replace(/,\s*$/, '')
        .trim();
      setInputText(updated);
    } else {
      if (!current) {
        setInputText(`Experiencing ${symptom.appendPhrase}`);
      } else if (current.endsWith('.') || current.endsWith('!')) {
        setInputText(`${current} Also noticing ${symptom.appendPhrase}.`);
      } else {
        setInputText(`${current}, ${symptom.appendPhrase}`);
      }
    }
  };

  const renderInlineFormatted = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-bold text-slate-950">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  const formatTriageText = (content: string) => {
    return content.split('\n\n').map((block, idx) => {
      const lines = block.split('\n');
      return (
        <div key={idx} className="mb-3 leading-relaxed">
          {lines.map((line, lidx) => (
            <p
              key={lidx}
              className={
                line.startsWith('•') || line.startsWith('-')
                  ? 'pl-2 my-1 text-slate-700'
                  : 'my-1'
              }
            >
              {renderInlineFormatted(line)}
            </p>
          ))}
        </div>
      );
    });
  };

  // Database session loading screen
  if (isDbLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 rounded-2xl bg-teal-600 flex items-center justify-center text-white shadow-lg shadow-teal-600/20 mb-4 animate-bounce">
          <Activity className="w-6 h-6" />
        </div>
        <Loader2 className="w-6 h-6 text-teal-600 animate-spin mb-2" />
        <p className="text-sm font-semibold text-slate-800">Restoring your medical profile...</p>
        <p className="text-xs text-slate-500 mt-1">Connecting to Firestore database</p>
      </div>
    );
  }

  // First-time onboarding view (Only shown if completely new user without any database record)
  if (!onboarded) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 p-7">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-teal-600 flex items-center justify-center text-white shadow-md shadow-teal-200">
              <Activity className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">DermaSnap</h1>
              <p className="text-xs font-medium text-teal-700">AI Skin-Health Triage Assistant</p>
            </div>
          </div>

          <p className="text-slate-600 text-sm mb-5 leading-snug">
            Snap a skin concern. Get cautious triage. Send a clean clinical care regimen directly to WhatsApp.
          </p>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 mb-6 text-amber-900 text-xs leading-relaxed flex gap-2.5">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <strong className="font-semibold block text-amber-950 mb-0.5">Medical Safety Notice</strong>
              DermaSnap is not a doctor and cannot confirm a diagnosis. For severe, fast-spreading, painful, infected, or fever-related symptoms, seek urgent medical care.
            </div>
          </div>

          <form onSubmit={handleOnboardingSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
                Your Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Alex Chen"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm font-normal text-slate-800"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
                WhatsApp Number (with country code)
              </label>
              <div className="relative">
                <Smartphone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  placeholder="+14155552671 or +919876543210"
                  value={whatsappNumber}
                  onChange={(e) => setWhatsappNumber(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm font-normal text-slate-800"
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Your info will be saved persistently in the database so you won't be asked to log in again.
              </p>
            </div>

            <button
              type="submit"
              className="w-full mt-2 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-medium text-sm transition-all shadow-md shadow-teal-600/20 flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Save & Continue</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Main chat triage view (Automatically persistent across sessions)
  return (
    <div
      className="flex flex-col h-screen bg-slate-50 relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag & drop overlay indicator */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-teal-600/80 backdrop-blur-xs flex flex-col items-center justify-center text-white p-6 border-4 border-dashed border-white">
          <Upload className="w-16 h-16 mb-4 animate-bounce" />
          <h2 className="text-2xl font-bold">Drop your skin photo here</h2>
          <p className="text-teal-100 text-sm mt-1">Accepts JPG, PNG, WEBP for AI visual triage</p>
        </div>
      )}

      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 shrink-0">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-600 flex items-center justify-center text-white shadow-sm shadow-teal-200">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-slate-900 leading-tight">DermaSnap</h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-50 text-teal-700 border border-teal-200">
                  Clinical Triage
                </span>
              </div>
              <button
                type="button"
                onClick={() => setProfileModalOpen(true)}
                className="text-xs text-slate-500 hover:text-teal-700 flex items-center gap-1 cursor-pointer transition-colors"
                title="View & Edit Saved Patient Profile"
              >
                <span>Patient:</span>
                <strong className="text-slate-800 font-semibold">{userName}</strong>
                <span>• {whatsappNumber}</span>
                <Edit2 className="w-3 h-3 text-slate-400" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setTrendsChartOpen(true)}
              className="px-2.5 py-1.5 rounded-lg border border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-800 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              title="View Symptom Severity & Frequency Trends Chart"
            >
              <TrendingUp className="w-3.5 h-3.5 text-teal-600" />
              <span className="hidden sm:inline">Symptom Trends</span>
            </button>

            <button
              onClick={() => setWarningModalOpen(true)}
              className="px-2.5 py-1.5 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Urgent Red Flag Warning Signs"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              <span className="hidden sm:inline">Red Flags</span>
            </button>

            <button
              onClick={() => setKnowledgeModalOpen(true)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              title="View Skin Knowledge Notes"
            >
              <FileText className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden sm:inline">Reference Notes</span>
            </button>

            <button
              onClick={() => handleOpenSummaryModal()}
              disabled={messages.length === 0 || isLoading}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm ${
                messages.length === 0 || isLoading
                  ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20 cursor-pointer'
              }`}
              title="Send full clinical triage & regimen report to WhatsApp"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Send to WhatsApp</span>
            </button>

            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                sidebarOpen
                  ? 'border-teal-300 bg-teal-50 text-teal-800'
                  : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
              }`}
              title="Toggle Symptoms & Scenarios side panel"
            >
              <PanelRight className="w-3.5 h-3.5 text-teal-600" />
              <span className="hidden sm:inline">Side Tools</span>
            </button>

            <button
              onClick={handleClearChat}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              title="Start a new consultation (keeps your profile saved)"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Safety Notice Banner */}
      <div className="bg-amber-50/90 border-b border-amber-200 px-4 py-2 shrink-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-xs text-amber-900 gap-2">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Medical Safety Notice:</strong> DermaSnap provides cautious triage guidance only, not a confirmed diagnosis. Always consult a licensed clinician.
            </span>
          </div>
          <button
            onClick={() => setWarningModalOpen(true)}
            className="text-[11px] underline font-medium text-amber-800 hover:text-amber-950 shrink-0 cursor-pointer"
          >
            Emergency signs
          </button>
        </div>
      </div>

      {/* Main Content Area: Chat in center + Dedicated Side Panel on the side */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Central Chat Column */}
        <div className="flex-1 flex flex-col min-w-0 h-full bg-slate-50">
          {/* Main Chat Scroll Container */}
          <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
            <div className="max-w-3xl mx-auto space-y-4">
              {messages.map((message) => {
                const isUser = message.role === 'user';
                const isWelcome = message.id.startsWith('welcome');

                return (
                  <div
                    key={message.id}
                    className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
                  >
                    {!isUser && (
                      <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center text-white shrink-0 shadow-sm mt-1">
                        <Activity className="w-4 h-4" />
                      </div>
                    )}

                    <div
                      className={`max-w-[88%] sm:max-w-2xl rounded-2xl px-4 py-3.5 shadow-sm text-sm ${
                        isUser
                          ? 'bg-teal-600 text-white rounded-tr-xs'
                          : 'bg-white border border-slate-200 text-slate-800 rounded-tl-xs'
                      }`}
                    >
                      {/* Attached photo thumbnail for user message */}
                      {message.imagePreview && (
                        <div className="mb-2.5 overflow-hidden rounded-xl border border-teal-500/30">
                          <img
                            src={message.imagePreview}
                            alt="Uploaded skin condition"
                            className="max-h-72 w-full object-cover"
                          />
                        </div>
                      )}

                      {/* Message body */}
                      <div className="whitespace-pre-line leading-relaxed">
                        {formatTriageText(message.content)}
                      </div>

                      {/* Inline Action Bar for Assistant Triage Messages */}
                      {!isUser && !isWelcome && (
                        <div className="mt-3.5 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenSummaryModal(message.content)}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                            >
                              <Share2 className="w-3 h-3" />
                              <span>Send this to WhatsApp</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleCopyText(message.content, message.id)}
                              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors"
                            >
                              {copiedId === message.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  <span className="text-emerald-700">Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 text-slate-500" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>

                          <span className="text-[10px] text-slate-400">
                            {message.timestamp}
                          </span>
                        </div>
                      )}

                      {isUser && (
                        <div className="text-[10px] mt-2 text-right text-teal-200">
                          {message.timestamp}
                        </div>
                      )}
                    </div>

                    {isUser && (
                      <div className="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center text-slate-600 shrink-0 shadow-sm mt-1">
                        <User className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Image Compression Indicator */}
              {isCompressing && (
                <div className="flex gap-3 justify-start items-center bg-teal-50 border border-teal-200 rounded-xl p-3 max-w-sm">
                  <Loader2 className="w-4 h-4 text-teal-600 animate-spin" />
                  <p className="text-xs text-teal-800 font-medium">Optimizing photo for fast clinical analysis...</p>
                </div>
              )}

              {/* AI Thinking/Reviewing Loader */}
              {isLoading && (
                <div className="flex gap-3 justify-start items-start">
                  <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center text-white shrink-0 shadow-sm animate-pulse">
                    <Activity className="w-4 h-4" />
                  </div>
                  <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-xs px-4 py-3.5 shadow-sm max-w-sm flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-teal-600 animate-spin" />
                    <div>
                      <p className="text-xs font-semibold text-slate-800">Reviewing skin concern...</p>
                      <p className="text-[11px] text-slate-500">Preparing clinical triage & care regimen</p>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Clean, Uncluttered Input Area at Bottom */}
          <div className="bg-white border-t border-slate-200 p-3 sm:p-4 shrink-0">
            <div className="max-w-3xl mx-auto">
              {/* Selected photo preview thumbnail */}
              {selectedImage && (
                <div className="mb-3 flex items-center gap-3 bg-teal-50 border border-teal-200 rounded-xl p-2.5">
                  <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-teal-300 shrink-0">
                    <img
                      src={selectedImage.preview}
                      alt="Selected skin concern"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-800 truncate">
                      {selectedImage.name || 'skin-photo.jpg'}
                    </p>
                    <p className="text-[11px] text-teal-700">
                      Ready for visual triage • Click Send to analyze
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedImage(null)}
                    className="p-1.5 hover:bg-teal-200 rounded-lg text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                    title="Remove photo"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendMessage();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageSelect}
                  accept="image/*"
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => setCameraModalOpen(true)}
                  className="px-3 py-2.5 rounded-xl border border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-800 transition-colors shrink-0 flex items-center gap-1.5 text-xs font-semibold cursor-pointer shadow-xs"
                  title="Open live camera to capture skin photo directly"
                >
                  <Camera className="w-4 h-4 text-teal-600" />
                  <span className="hidden sm:inline">Take Photo</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-slate-800 transition-colors shrink-0 flex items-center justify-center text-xs font-medium cursor-pointer"
                  title="Upload skin photo from file storage"
                >
                  <Upload className="w-4 h-4" />
                </button>

                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={selectedImage ? "Add symptoms (itching, duration, location)..." : "Describe symptoms or attach a photo..."}
                  disabled={isLoading || isCompressing}
                  className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm text-slate-800"
                />

                <button
                  type="submit"
                  disabled={isLoading || isCompressing || (!inputText.trim() && !selectedImage)}
                  className={`p-2.5 rounded-xl font-medium transition-all shrink-0 ${
                    isLoading || isCompressing || (!inputText.trim() && !selectedImage)
                      ? 'bg-slate-100 text-slate-300 border border-slate-200 cursor-not-allowed'
                      : 'bg-teal-600 hover:bg-teal-700 text-white shadow-md shadow-teal-600/20 cursor-pointer'
                  }`}
                  title="Send message"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>

              <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2 px-1">
                <span>Patient: {userName} • WhatsApp: {whatsappNumber}</span>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="md:hidden text-teal-700 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <PanelRight className="w-3 h-3" />
                  <span>{sidebarOpen ? 'Hide Side Tools' : 'Show Symptoms & Scenarios'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Dedicated Right Side Panel (Symptoms Checklist & Quick Scenarios) */}
        {sidebarOpen && (
          <aside className="w-80 lg:w-88 border-l border-slate-200 bg-white flex flex-col shrink-0 overflow-y-auto max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:shadow-2xl">
            <div className="p-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 sticky top-0 backdrop-blur-xs z-10">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-teal-600" />
                <span className="text-xs font-bold text-slate-900 tracking-tight">
                  Symptoms & Scenarios
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="p-1 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
                title="Close side panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-6">
              {/* 1. Symptoms Checklist Section */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <CheckSquare className="w-3.5 h-3.5 text-teal-600" />
                    <span>Symptoms Checklist</span>
                  </span>
                  {inputText && (
                    <button
                      type="button"
                      onClick={() => setInputText('')}
                      className="text-[10px] text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      Clear text
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mb-2.5">
                  Tap to add or remove symptoms in your consultation:
                </p>
                <div className="space-y-1.5">
                  {COMMON_SYMPTOMS.map((symptom) => {
                    const isChecked = symptom.keywords.some((kw) =>
                      inputText.toLowerCase().includes(kw)
                    );
                    return (
                      <button
                        key={symptom.id}
                        type="button"
                        onClick={() => handleToggleSymptom(symptom)}
                        className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center justify-between cursor-pointer select-none border ${
                          isChecked
                            ? 'bg-teal-50 border-teal-300 text-teal-900 shadow-xs'
                            : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-4 h-4 rounded-xs flex items-center justify-center border text-[10px] transition-colors ${
                              isChecked
                                ? 'border-teal-600 bg-teal-600 text-white'
                                : 'border-slate-300 bg-slate-50'
                            }`}
                          >
                            {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                          </span>
                          <span className={isChecked ? 'font-semibold text-teal-900' : ''}>
                            {symptom.label}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400">
                          {isChecked ? 'Active' : '+ Add'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Direct Camera & File Upload Section */}
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Camera className="w-3.5 h-3.5 text-teal-600" />
                  <span className="text-xs font-bold text-slate-800">
                    Skin Photo Capture
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mb-2.5">
                  Capture directly via in-app camera or upload an existing photo:
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCameraModalOpen(true);
                      if (window.innerWidth < 768) setSidebarOpen(false);
                    }}
                    className="p-2.5 rounded-xl border border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-900 text-xs font-semibold flex flex-col items-center gap-1.5 text-center transition-all cursor-pointer shadow-2xs hover:scale-[1.02]"
                  >
                    <div className="w-7 h-7 rounded-lg bg-teal-600 text-white flex items-center justify-center shadow-xs">
                      <Camera className="w-4 h-4" />
                    </div>
                    <span>Take Photo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                      if (window.innerWidth < 768) setSidebarOpen(false);
                    }}
                    className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-medium flex flex-col items-center gap-1.5 text-center transition-all cursor-pointer hover:scale-[1.02]"
                  >
                    <div className="w-7 h-7 rounded-lg bg-slate-200 text-slate-700 flex items-center justify-center">
                      <Upload className="w-4 h-4" />
                    </div>
                    <span>Upload File</span>
                  </button>
                </div>
              </div>

              {/* 3. Quick Symptom Scenarios Section */}
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-teal-600" />
                  <span className="text-xs font-bold text-slate-800">
                    Quick Symptom Scenarios
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mb-2.5">
                  Click any case to test triage & prescription guidance:
                </p>
                <div className="space-y-2">
                  {SAMPLE_CASES.map((sample, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        sendMessage(sample.prompt);
                        if (window.innerWidth < 768) setSidebarOpen(false);
                      }}
                      className={`w-full text-left p-3 rounded-xl border bg-gradient-to-br transition-all hover:scale-[1.01] cursor-pointer shadow-xs ${sample.color}`}
                    >
                      <strong className="block font-bold text-xs">{sample.title}</strong>
                      <span className="text-[11px] opacity-90 block mt-0.5 leading-snug">
                        {sample.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Profile & Database Management Modal */}
      {profileModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center">
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Patient Profile</h3>
                  <p className="text-[11px] text-slate-500">Contact preferences for WhatsApp reports</p>
                </div>
              </div>
              <button
                onClick={() => setProfileModalOpen(false)}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProfileChanges} className="py-4 space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Your contact details are saved for your WhatsApp care reports.</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={editProfileName}
                  onChange={(e) => setEditProfileName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                  WhatsApp Number
                </label>
                <input
                  type="text"
                  required
                  value={editProfilePhone}
                  onChange={(e) => setEditProfilePhone(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm text-slate-800"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setProfileModalOpen(false)}
                  className="px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm shadow-teal-600/20"
                >
                  {isSavingProfile ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WhatsApp Summary & Direct Send Modal */}
      {summaryModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-sm shadow-emerald-200">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">WhatsApp Clinical Report</h3>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span>Send to:</span>
                    {isEditingPhone ? (
                      <input
                        type="text"
                        value={targetPhone}
                        onChange={(e) => setTargetPhone(e.target.value)}
                        placeholder="+14155552671"
                        className="border border-slate-300 rounded px-1.5 py-0.5 text-xs text-slate-800 font-medium"
                      />
                    ) : (
                      <strong className="text-slate-800 font-semibold">{targetPhone || whatsappNumber}</strong>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsEditingPhone(!isEditingPhone)}
                      className="text-teal-600 hover:text-teal-800 p-0.5 cursor-pointer"
                      title="Edit phone number"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSummaryModalOpen(false)}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 flex-1 overflow-y-auto space-y-3">
              {isGeneratingSummary ? (
                <div className="py-12 flex flex-col items-center justify-center text-center">
                  <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mb-3" />
                  <p className="text-sm font-semibold text-slate-800">Formatting Clinical Prescription Report...</p>
                  <p className="text-xs text-slate-500 mt-1">Grounded in skin knowledge and safe care regimen</p>
                </div>
              ) : (
                <>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs text-slate-800 font-mono whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                    {generatedSummary}
                  </div>

                  {/* Status banner and direct WhatsApp link */}
                  {whatsappDispatchStatus && (
                    <div className="p-3.5 rounded-xl border bg-emerald-50/80 border-emerald-200 text-emerald-950 text-xs space-y-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span className="font-semibold">{whatsappDispatchStatus.message}</span>
                      </div>

                      {whatsappDispatchStatus.waLink && (
                        <div className="pt-1 flex flex-wrap gap-2">
                          <a
                            href={whatsappDispatchStatus.waLink}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm shadow-emerald-600/30 transition-all cursor-pointer"
                          >
                            <span>Open Directly in WhatsApp</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>

                          {whatsappDispatchStatus.webWaLink && (
                            <a
                              href={whatsappDispatchStatus.webWaLink}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-all cursor-pointer"
                            >
                              <span>WhatsApp Web</span>
                              <ExternalLink className="w-3 h-3 text-slate-400" />
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => handleCopyText(generatedSummary, 'modal-summary')}
                className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
              >
                {copiedId === 'modal-summary' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-700">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-500" />
                    <span>Copy Text</span>
                  </>
                )}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSendToWhatsapp}
                  disabled={isGeneratingSummary || !generatedSummary}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer shadow-sm shadow-emerald-600/20"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Send to WhatsApp</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Skin Disease Knowledge Notes Modal */}
      {knowledgeModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-100 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-teal-600" />
                <h3 className="font-bold text-slate-900 text-base">DermaSnap Skin Reference Notes</h3>
              </div>
              <button
                onClick={() => setKnowledgeModalOpen(false)}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 flex-1 overflow-y-auto text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
              {knowledgeText || 'Loading reference notes...'}
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setKnowledgeModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-medium cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Red Flags / Emergency Warnings Modal */}
      {warningModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">Emergency Warning Signs</h3>
                <p className="text-xs text-rose-600 font-medium">Seek immediate emergency medical care</p>
              </div>
            </div>

            <div className="space-y-2 text-xs text-slate-700 mb-5">
              <p className="font-medium text-slate-900 mb-1">
                Go to the nearest emergency department or call emergency services if you experience:
              </p>
              <ul className="list-disc list-inside space-y-1.5 text-slate-600">
                <li><strong>Difficulty breathing</strong> or tightness in chest</li>
                <li><strong>Swelling of lips, tongue, face,</strong> or throat</li>
                <li><strong>High fever</strong> accompanying a rapid rash</li>
                <li><strong>Rapidly spreading</strong> redness or dark streaks</li>
                <li><strong>Severe, intense pain</strong> out of proportion to appearance</li>
                <li><strong>Black, purple, or necrotic-looking skin</strong></li>
                <li><strong>Blisters or peeling rash</strong> inside mouth, eyes, or genitals</li>
                <li>Rash near the eye affecting vision</li>
                <li>Rash in a newborn or infant under 3 months</li>
              </ul>
            </div>

            <button
              onClick={() => setWarningModalOpen(false)}
              className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold cursor-pointer"
            >
              Understood
            </button>
          </div>
        </div>
      )}

      {/* Symptom Trends & Frequency Chart Modal */}
      <SymptomTrendsChart
        messages={messages}
        isOpen={trendsChartOpen}
        onClose={() => setTrendsChartOpen(false)}
      />

      {/* Direct In-App Camera Capture Modal with Permission Handler */}
      <CameraCaptureModal
        isOpen={cameraModalOpen}
        onClose={() => setCameraModalOpen(false)}
        onCapture={async (file, sendImmediately) => {
          setIsCompressing(true);
          try {
            const compressed = await compressImage(file);
            const imgData = {
              file,
              preview: compressed.preview,
              base64: compressed.base64,
              mimeType: compressed.mimeType,
              name: file.name || 'skin-photo.jpg',
            };
            setSelectedImage(imgData);

            if (sendImmediately) {
              await sendMessage('Skin concern photo captured for visual triage', imgData);
            }
          } catch (err) {
            console.error('Image processing failed:', err);
          } finally {
            setIsCompressing(false);
          }
        }}
        onFallbackToFile={() => fileInputRef.current?.click()}
      />
    </div>
  );
}
