# DermaSnap

DermaSnap is a Streamlit chat app based on the MacroSnap workflow. A user enters
their name and WhatsApp number, uploads a skin-condition photo or describes
symptoms, gets a cautious AI triage response from Gemini, and can send a summary
to WhatsApp through Twilio.
<<<<<<< HEAD

DermaSnap is a Streamlit chat app based on the MacroSnap workflow. A user enters
their name and WhatsApp number, uploads a skin-condition photo or describes
symptoms, gets a cautious AI triage response from Gemini, and can send a summary
to WhatsApp through Twilio.

This is not a medical diagnosis tool. It is designed to provide cautious,
non-definitive information and encourage professional care.

The app also loads local background notes from `data/skin_knowledge.txt` and
passes them to the LLM as reference context. Those notes are treated as medical
background, not as instructions. If `OPENAI_API_KEY` is configured, OpenAI runs
as an optional second reviewer after Gemini.

## Setup

1. Create and activate a virtual environment.

   ```powershell
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   ```

2. Install dependencies.

   ```powershell
   pip install -r requirements.txt
   ```

3. Copy `.streamlit/secrets.toml.example` to `.streamlit/secrets.toml`.

4. Fill in your Gemini API key and Twilio credentials.

   Twilio values can be left blank while you test the Gemini skin-analysis chat.
   The WhatsApp button turns on after Twilio is configured.
   OpenAI values can also be left blank; Gemini will still run by itself.

5. In Twilio, create a WhatsApp Content Template with one variable:

   ```text
   Hello {{1}} 👋

   Your DermaSnap skin analysis is ready.

   Please open the DermaSnap app to view your detailed results and recommendations.

   Thank you for using DermaSnap!
   ```

6. Run the app.

   ```powershell
   streamlit run app.py
   ```

The app opens at `http://localhost:8501`.

## Twilio WhatsApp setup

1. Create a Twilio account at `https://www.twilio.com/try-twilio`.
2. Open the Twilio Console and copy your Account SID and Auth Token.
3. Go to Messaging > Try it out > Send a WhatsApp message.
4. Use the sandbox number, usually `whatsapp:+14155238886`.
5. From your own WhatsApp number, send the sandbox join code shown by Twilio.
6. Go to Messaging > Content Template Builder.
7. Create a text template with one variable:

   ```text
   Hello {{1}} 👋

   Your DermaSnap skin analysis is ready.

   Please open the DermaSnap app to view your detailed results and recommendations.

   Thank you for using DermaSnap!
   ```

8. Submit/approve the template and copy its Content SID, which starts with `HX`.
9. Paste these values into `.streamlit/secrets.toml`.

For local testing, the WhatsApp number you type in the app must be the same
number that joined the Twilio sandbox.
=======
DermaSnap is an AI-powered skin health platform that analyzes skin images to identify possible skin conditions and provides information on symptoms, causes, precautions, and next steps. It generates personalized preliminary care recommendations and integrates with WhatsApp for reports, reminders, and follow-ups.

> > > > > > > b6076977a782570ddd48f9d8afaf3f565d0802b6
