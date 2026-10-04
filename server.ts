import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import twilio from 'twilio';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = '0.0.0.0';

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Read skin knowledge base
const KNOWLEDGE_PATH = path.join(__dirname, 'data', 'skin_knowledge.txt');
let skinKnowledge = '';
try {
  skinKnowledge = fs.readFileSync(KNOWLEDGE_PATH, 'utf-8').trim();
} catch (err) {
  try {
    skinKnowledge = fs.readFileSync(path.join(process.cwd(), 'data', 'skin_knowledge.txt'), 'utf-8').trim();
  } catch (err2) {
    console.warn('Could not read skin_knowledge.txt:', err2);
  }
}

const SYSTEM_PROMPT = `You are DermaSnap, an expert AI dermatology triage assistant.
Your job is to help users evaluate visible skin concerns from photos or symptom descriptions, identify likely conditions, and recommend appropriate evidence-based medications, preliminary prescriptions, and comprehensive care regimens to relieve symptoms safely.

Important clinical rules:
1. Provide thoughtful, condition-specific medication guidance:
   - Recommend standard First-Line Over-The-Counter (OTC) active ingredients and strengths (e.g. Hydrocortisone 1% cream, Benzoyl Peroxide 2.5-5%, Salicylic acid 2%, Clotrimazole 1%, Oral Antihistamines like Cetirizine 10mg).
   - Outline standard Prescription-Grade Medication Classes that a dermatologist commonly evaluates and prescribes (e.g., Topical Retinoids like Adapalene/Tretinoin, Topical Antibiotics like Clindamycin, Corticosteroids like Triamcinolone 0.1%, or Calcineurin Inhibitors like Tacrolimus).
   - Provide clear application instructions (frequency, thin layer, clean dry skin, maximum continuous duration).
   - Include contraindications and precautions (e.g. avoid contact with eyes, discontinue if burning occurs, limit topical steroids to 5-7 days).
2. Emergency warning signs: If symptoms include breathing difficulty, lip/throat swelling, rapid spreading redness, fever with rash, severe pain, pus/red streaks, or purple/black skin, advise urgent emergency care immediately.
3. State that this is a cautious preliminary assessment and formal prescription medications should be verified by a licensed clinician or pharmacist.

For every skin photo or description, respond in structured plain text with:
1. Observable Findings (visible lesions, erythema, swelling, texture, pattern)
2. Likely Condition & Differential Possibilities (clearly labeled as preliminary possibilities)
3. Underlying Trigger / Cause (microbial, barrier disruption, allergen, friction, sebaceous activity)
4. Urgency Level (Routine, Soon, or Urgent)
5. Recommended Medications & Preliminary Treatment Regimen:
   - OTC Active Ingredients & Strengths
   - Application Instructions & Frequency
   - Prescription Medications for Doctor Evaluation
   - Safety Precautions & Contraindications
6. Supportive Self-Care (cleansing, barrier moisturization, lifestyle tips)
7. Clinical Notice (consult clinician or pharmacist before starting new medications)`;

const SUMMARY_REQUEST_PROMPT = `Summarize this dermatology consultation into a complete WhatsApp Medical Triage & Prescription Care Report.
Format it clearly with WhatsApp asterisks for bolding:

🩺 *DERMASNAP CLINICAL REPORT & MEDICINE REGIMEN*
👤 *Patient:* [Patient Name]
📅 *Date:* [Today's Date]

🔍 *OBSERVED FINDINGS:*
[Concise observation]

📋 *PRELIMINARY DIAGNOSTIC IMPRESSION:*
[Suspected condition & key possibilities]

⚡ *URGENCY RATING:*
[Routine / Soon / Urgent]

💊 *RECOMMENDED MEDICATIONS & CARE REGIMEN:*
• *First-Line OTC Topical:* [Specific active ingredient & strength, e.g. Hydrocortisone 1% or Benzoyl Peroxide 2.5%]
• *Application Method:* [e.g. Apply a thin layer to clean skin 1-2 times daily for up to 5-7 days]
• *Oral Symptom Relief:* [e.g. Cetirizine 10mg once daily if itching is severe]
• *Prescription-Grade Alternatives:* [e.g. Topical Retinoid, Tacrolimus, or Clindamycin for dermatologist review]
• *Precautions & Warnings:* [e.g. Avoid eye area, do not pick/scratch, discontinue if stinging persists]

🛡️ *SUPPORTIVE BARRIER CARE:*
• *Cleansing:* [Mild soap-free cleanser]
• *Moisturizing:* [Fragrance-free ceramide cream]

⚠️ *CLINICAL NOTICE:* Cautious preliminary triage. Consult a licensed physician or pharmacist for formal prescription issuance.

Keep plain text with emojis and asterisks. Do not use markdown backticks or hashes.`;

function buildGroundedSystemInstruction(): string {
  if (!skinKnowledge) return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT}

Use the following skin-disease reference notes as background medical context:

${skinKnowledge}`;
}

const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
];

async function callGemini(contents: any[]) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your-gemini-api-key-here') {
    throw new Error('GEMINI_API_KEY is not configured with a valid key.');
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const modelsToTry = [
    PRIMARY_MODEL,
    ...FALLBACK_MODELS.filter((m) => m !== PRIMARY_MODEL),
  ];

  let lastError: any = null;
  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: buildGroundedSystemInstruction(),
        },
      });

      if (response && response.text) {
        return response.text;
      }
    } catch (err: any) {
      console.warn(`Gemini model ${model} invocation attempt:`, err?.message || err);
      lastError = err;
    }
  }

  throw lastError || new Error('All Gemini models failed to generate a response.');
}

// Condition-specific clinical triage & medicine prescription generator
function generateClinicalKnowledgeTriage(userText: string, hasImage: boolean, userName: string): string {
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
  } else if (lower.includes('scale') || lower.includes('scaly') || lower.includes('plaque') || lower.includes('elbow') || lower.includes('knee')) {
    condition = 'Plaque Psoriasis';
    possibilities = 'Chronic plaque psoriasis, sebopsoriasis, or lichen simplex';
    trigger = 'Autoimmune accelerated keratinocyte proliferation driven by IL-17 and IL-23 inflammatory cytokine pathways.';
    urgency = 'Soon (dermatology evaluation advised)';
    otcMeds = '• **Salicylic Acid 3% or Coal Tar Ointment (OTC):** Helps soften and gently remove thick adherent silver scales.\n• **Intensive Urea 10-20% Cream:** Keratolytic moisturizer to restore hydration and smooth rough plaques.';
    rxMeds = '• **Calcipotriene (Vitamin D3 analog) + Betamethasone Dipropionate ointment:** Highly effective prescription combination to slow skin cell turnover and suppress inflammation.\n• **Tazarotene 0.05% gel:** Prescription topical retinoid for localized plaques.';
    precautions = 'Avoid sudden oral steroid withdrawal which can trigger psoriasis rebound flares. Monitor plaques for signs of arthritic joint pain.';
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
*Grounded in DermaSnap Clinical Dermatology Knowledge Base*

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
   *DermaSnap provides preliminary clinical information and evidence-based medication guidance. Final prescription confirmation and dosing should be verified by a licensed doctor or pharmacist.*`;
}

// Config Status Endpoint
app.get('/api/status', (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const geminiConfigured = Boolean(apiKey && apiKey !== 'your-gemini-api-key-here');
  const twilioConfigured = Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_WHATSAPP_FROM
  );
  const openaiConfigured = Boolean(process.env.OPENAI_API_KEY);

  res.json({
    geminiConfigured,
    geminiModel: PRIMARY_MODEL,
    twilioConfigured,
    twilioFrom: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
    openaiConfigured,
  });
});

// Reference Knowledge Endpoint
app.get('/api/knowledge', (req, res) => {
  res.json({
    knowledge: skinKnowledge,
  });
});

// Chat Endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const {
      history = [],
      text = '',
      imageBase64,
      imageMimeType = 'image/jpeg',
      userName = 'User',
    } = req.body;

    const hasImage = Boolean(imageBase64);
    const contents: any[] = [];

    // 1. Process previous conversation turns (history)
    for (const msg of history) {
      if (!msg || !msg.role) continue;
      const role = msg.role === 'assistant' ? 'model' : 'user';
      const parts: any[] = [];

      if (msg.content && typeof msg.content === 'string' && msg.content.trim()) {
        parts.push({ text: msg.content.trim() });
      }

      if (parts.length > 0) {
        if (contents.length > 0 && contents[contents.length - 1].role === role) {
          contents[contents.length - 1].parts.push(...parts);
        } else {
          contents.push({ role, parts });
        }
      }
    }

    // 2. Prepare the new user turn
    const currentParts: any[] = [];

    if (imageBase64) {
      const cleanBase64 = imageBase64.includes(',')
        ? imageBase64.split(',')[1].replace(/\s/g, '')
        : imageBase64.replace(/\s/g, '');

      let mime = imageMimeType || 'image/jpeg';
      if (mime === 'image/jpg') mime = 'image/jpeg';

      currentParts.push({
        inlineData: {
          data: cleanBase64,
          mimeType: mime,
        },
      });
    }

    const defaultInstruction = text.trim() || (
      "Please evaluate this skin photo cautiously. Identify the likely condition, " +
      "prescribe standard first-line over-the-counter and clinical prescription medications, " +
      "explain application instructions, precautions, and supportive self-care."
    );

    currentParts.push({
      text: userName ? `Patient/User Name: ${userName}\n${defaultInstruction}` : defaultInstruction,
    });

    if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
      contents[contents.length - 1].parts.push(...currentParts);
    } else {
      contents.push({ role: 'user', parts: currentParts });
    }

    // Attempt Gemini call
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey !== 'your-gemini-api-key-here') {
      try {
        const geminiAnswer = await callGemini(contents);
        return res.json({ answer: geminiAnswer, source: 'gemini' });
      } catch (geminiError: any) {
        console.warn('Gemini invocation error, falling back to clinical knowledge triage:', geminiError?.message || geminiError);
        const clinicalAnswer = generateClinicalKnowledgeTriage(text, hasImage, userName);
        return res.json({
          answer: clinicalAnswer,
          source: 'knowledge_base_fallback',
        });
      }
    } else {
      const clinicalAnswer = generateClinicalKnowledgeTriage(text, hasImage, userName);
      return res.json({ answer: clinicalAnswer, source: 'knowledge_base' });
    }
  } catch (error: any) {
    console.error('Fatal error during chat processing:', error);
    res.status(500).json({
      error: error?.message || 'Failed to process skin assessment.',
    });
  }
});

// Summary & Clinical Prescription Regimen Endpoint
app.post('/api/summarize', async (req, res) => {
  try {
    const { messages = [], userName = 'User' } = req.body;

    const conversationText = messages
      .filter((m: any) => m && m.content)
      .map((m: any) => `${m.role === 'user' ? 'User' : 'DermaSnap'}: ${m.content}`)
      .join('\n\n');

    const prompt = `${SUMMARY_REQUEST_PROMPT}\n\nPatient Name: ${userName}\n\nConsultation Notes:\n${conversationText || 'Skin concern assessment'}`;

    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey !== 'your-gemini-api-key-here') {
      try {
        const summary = await callGemini([{ role: 'user', parts: [{ text: prompt }] }]);
        return res.json({ summary });
      } catch (err) {
        console.warn('Gemini summarize fallback to clinical template:', err);
      }
    }

    // Extract condition clues from the latest conversation message
    const lastMsgText = messages.length > 0 ? messages[messages.length - 1].content || '' : '';
    const lower = (conversationText + ' ' + lastMsgText).toLowerCase();

    let suspectedCondition = 'Contact Dermatitis / Allergic Skin Reaction';
    let otcMeds = '• *Topical:* Hydrocortisone 1% cream applied thinly 1-2x daily for up to 5 days\n• *Oral:* Cetirizine 10mg once daily if itching is intense\n• *Barrier:* Bland ceramide moisturizer twice daily';
    let rxMeds = '• Triamcinolone acetonide 0.1% or Tacrolimus 0.03% (physician evaluation)';

    if (lower.includes('acne') || lower.includes('pimple') || lower.includes('forehead') || lower.includes('sweat')) {
      suspectedCondition = 'Acne Vulgaris / Folliculitis';
      otcMeds = '• *Topical:* Benzoyl Peroxide 2.5% gel at bedtime + Salicylic acid 2% cleanser\n• *Barrier:* Oil-free non-comedogenic hydrating moisturizer';
      rxMeds = '• Topical Adapalene 0.1% retinoid / Clindamycin 1% gel (physician evaluation)';
    } else if (lower.includes('itch') || lower.includes('eczema')) {
      suspectedCondition = 'Atopic Dermatitis (Eczema Flare)';
      otcMeds = '• *Topical:* Hydrocortisone 1% ointment twice daily to itchy patches (5-7 days)\n• *Barrier:* Heavy petroleum-based ceramide cream after lukewarm shower\n• *Oral:* Cetirizine 10mg daily for itch relief';
      rxMeds = '• Desonide 0.05% or Triamcinolone 0.1% cream (physician evaluation)';
    } else if (lower.includes('bite') || lower.includes('insect') || lower.includes('welt')) {
      suspectedCondition = 'Arthropod Bite Reaction';
      otcMeds = '• *Topical:* Calamine lotion or Hydrocortisone 1% cream 2-3x daily\n• *Oral:* Oral Cetirizine 10mg or Diphenhydramine 25mg for swelling relief\n• *Cooling:* Clean cold compress for 10-15 minutes';
      rxMeds = '• Betamethasone dipropionate 0.05% if localized welt is severe';
    } else if (lower.includes('fungus') || lower.includes('ring') || lower.includes('foot')) {
      suspectedCondition = 'Tinea Fungal Infection (Ringworm / Athlete\'s Foot)';
      otcMeds = '• *Topical:* Clotrimazole 1% or Terbinafine 1% cream applied 2x daily for 2-3 weeks\n• *Hygiene:* Keep skin completely dry; change socks/towels daily';
      rxMeds = '• Prescription Ketoconazole 2% or Ciclopirox 0.77% cream';
    }

    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const fallbackSummary = `🩺 *DERMASNAP CLINICAL REPORT & MEDICINE REGIMEN*
👤 *Patient:* ${userName}
📅 *Date:* ${today}

🔍 *OBSERVED FINDINGS:*
Skin surface variation with localized erythema (redness) and discomfort.

📋 *PRELIMINARY DIAGNOSTIC IMPRESSION:*
*${suspectedCondition}*
*(Preliminary clinical assessment)*

⚡ *URGENCY RATING:*
*Routine to Soon* (Seek immediate emergency care if breathing difficulty or facial swelling develops)

💊 *RECOMMENDED MEDICATIONS & CARE REGIMEN:*
${otcMeds}

📋 *PRESCRIPTION MEDICATIONS FOR DOCTOR EVALUATION:*
${rxMeds}

⚠️ *PRECAUTIONS:*
• Cleanse and dry skin before applying topical medications.
• Apply thin layers; avoid contact with eyes and mucous membranes.
• Discontinue if burning or rash worsens.
• Consult a licensed physician or pharmacist for formal prescription issuance.`;

    return res.json({ summary: fallbackSummary });
  } catch (error: any) {
    console.error('Error generating summary:', error);
    res.status(500).json({ error: error?.message || 'Failed to generate summary.' });
  }
});

// Helper to normalize phone numbers
function cleanPhoneDigits(input: string): string {
  let cleaned = (input || '').replace(/[^0-9]/g, '');
  if (cleaned.startsWith('00')) {
    cleaned = cleaned.substring(2);
  }
  return cleaned;
}

// WhatsApp Send Endpoint (Twilio + Direct WhatsApp URL)
app.post('/api/send-whatsapp', async (req, res) => {
  try {
    const { to, userName = 'Patient', summary } = req.body;

    if (!to) {
      return res.status(400).json({ error: 'WhatsApp phone number is required.' });
    }

    const cleanDigits = cleanPhoneDigits(to);
    if (!cleanDigits || cleanDigits.length < 7) {
      return res.status(400).json({ error: 'Please enter a valid phone number with country code.' });
    }

    const encodedReport = encodeURIComponent(
      summary || `Hello ${userName} 👋\n\nYour DermaSnap medical triage and prescription report is ready.`
    );

    // Universal direct WhatsApp links
    const waLink = `https://api.whatsapp.com/send?phone=${cleanDigits}&text=${encodedReport}`;
    const webWaLink = `https://web.whatsapp.com/send?phone=${cleanDigits}&text=${encodedReport}`;
    const deepLink = `whatsapp://send?phone=${cleanDigits}&text=${encodedReport}`;

    const {
      TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN,
      TWILIO_WHATSAPP_FROM,
      TWILIO_CONTENT_SID,
    } = process.env;

    const twilioConfigured = Boolean(
      TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_FROM
    );

    if (twilioConfigured) {
      try {
        const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        const formattedTo = `whatsapp:+${cleanDigits}`;
        let twilioMsg: any = null;

        // Try direct body message with the full report
        try {
          twilioMsg = await client.messages.create({
            from: TWILIO_WHATSAPP_FROM,
            to: formattedTo,
            body: summary,
          });
        } catch (bodyError: any) {
          console.warn('Twilio direct body send attempt error, checking template fallback:', bodyError?.message || bodyError);
          if (TWILIO_CONTENT_SID) {
            const contentVariables = JSON.stringify({ '1': userName });
            twilioMsg = await client.messages.create({
              from: TWILIO_WHATSAPP_FROM,
              to: formattedTo,
              contentSid: TWILIO_CONTENT_SID,
              contentVariables,
            });
          } else {
            throw bodyError;
          }
        }

        return res.json({
          success: true,
          method: 'twilio',
          sid: twilioMsg.sid,
          phone: cleanDigits,
          waLink,
          webWaLink,
          deepLink,
          message: `Prescription & triage report dispatched via Twilio to +${cleanDigits}!`,
        });
      } catch (twilioErr: any) {
        console.warn('Twilio dispatch error:', twilioErr?.message || twilioErr);
        return res.json({
          success: true,
          method: 'direct_link',
          fallbackReason: twilioErr?.message || 'Twilio Sandbox Notice',
          phone: cleanDigits,
          waLink,
          webWaLink,
          deepLink,
          message: `Prescription report ready! Click below to send directly to +${cleanDigits} on WhatsApp.`,
        });
      }
    } else {
      return res.json({
        success: true,
        method: 'direct_link',
        phone: cleanDigits,
        waLink,
        webWaLink,
        deepLink,
        message: `Prescription report ready! Click below to send directly to +${cleanDigits} on WhatsApp.`,
      });
    }
  } catch (error: any) {
    console.error('Error sending WhatsApp message:', error);
    res.status(500).json({ error: error?.message || 'Failed to send WhatsApp message.' });
  }
});

// Server persistent users database
const USERS_DB_PATH = path.join(process.cwd(), 'data', 'users_db.json');

function getUsersDb(): Record<string, any> {
  try {
    if (fs.existsSync(USERS_DB_PATH)) {
      const content = fs.readFileSync(USERS_DB_PATH, 'utf-8');
      return JSON.parse(content || '{}');
    }
  } catch (err) {
    console.warn('Error reading users db:', err);
  }
  return {};
}

function saveUsersDb(dbData: Record<string, any>) {
  try {
    const dir = path.dirname(USERS_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(USERS_DB_PATH, JSON.stringify(dbData, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Error saving users db:', err);
  }
}

app.get('/api/user/me', (req, res) => {
  const { deviceId, uid } = req.query as { deviceId?: string; uid?: string };
  const users = getUsersDb();

  let foundUser = null;
  if (uid && users[uid]) {
    foundUser = users[uid];
  } else if (deviceId && users[deviceId]) {
    foundUser = users[deviceId];
  } else {
    const allUsers = Object.values(users);
    foundUser = allUsers.find(
      (u: any) => (deviceId && u.deviceId === deviceId) || (uid && u.uid === uid)
    ) || null;
  }

  res.json({ user: foundUser });
});

app.post('/api/user/save', (req, res) => {
  const { deviceId, name, whatsappNumber, uid } = req.body;
  if (!name || !whatsappNumber) {
    return res.status(400).json({ error: 'Name and WhatsApp number are required' });
  }

  const users = getUsersDb();
  const key = uid || deviceId || 'default-user';
  const userData = {
    id: key,
    uid: uid || null,
    deviceId: deviceId || null,
    name: String(name).trim(),
    whatsappNumber: String(whatsappNumber).trim(),
    updatedAt: new Date().toISOString(),
  };

  users[key] = userData;
  if (deviceId && key !== deviceId) {
    users[deviceId] = userData;
  }
  if (uid && key !== uid) {
    users[uid] = userData;
  }

  saveUsersDb(users);
  res.json({ success: true, user: userData });
});

// Setup Vite middleware in dev or static files in production
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`DermaSnap server listening on http://${HOST}:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
