import json

import streamlit as st
from twilio.rest import Client as TwilioClient

from knowledge_base import build_grounded_prompt, load_skin_knowledge
from llm_providers import DEFAULT_GEMINI_MODEL, GeminiVisionProvider, OpenAIReviewProvider
from prompts import SUMMARY_REQUEST_PROMPT, WELCOME_MESSAGE_TEMPLATE

st.set_page_config(page_title="DermaSnap", page_icon="DS")

GEMINI_API_KEY = st.secrets["GEMINI_API_KEY"]
GEMINI_MODEL = st.secrets.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
OPENAI_API_KEY = st.secrets.get("OPENAI_API_KEY", "")
OPENAI_MODEL = st.secrets.get("OPENAI_MODEL", "gpt-5.6-luna")
TWILIO_ACCOUNT_SID = st.secrets.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = st.secrets.get("TWILIO_AUTH_TOKEN", "")
TWILIO_WHATSAPP_FROM = st.secrets.get("TWILIO_WHATSAPP_FROM", "")
TWILIO_CONTENT_SID = st.secrets.get("TWILIO_CONTENT_SID", "")
TWILIO_READY = all(
    [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, TWILIO_CONTENT_SID]
)


@st.cache_resource
def get_llm_provider():
    return GeminiVisionProvider(api_key=GEMINI_API_KEY, model_name=GEMINI_MODEL)


@st.cache_resource
def get_openai_review_provider():
    if not OPENAI_API_KEY:
        return None
    return OpenAIReviewProvider(api_key=OPENAI_API_KEY, model_name=OPENAI_MODEL)


@st.cache_resource
def get_twilio_client():
    if not TWILIO_READY:
        return None
    return TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)


llm_provider = get_llm_provider()
openai_review_provider = get_openai_review_provider()
twilio_client = get_twilio_client()


def reset_session():
    for key in ("onboarded", "name", "whatsapp_number", "chat", "messages"):
        st.session_state.pop(key, None)
    st.rerun()


def ensure_session_ready():
    if not st.session_state.get("onboarded"):
        return
    required_profile = all(
        key in st.session_state for key in ("name", "whatsapp_number", "messages")
    )
    if not required_profile:
        reset_session()
    if "chat" not in st.session_state:
        st.session_state.chat = llm_provider.create_chat()


def render_message(message):
    with st.chat_message(message["role"]):
        if message["kind"] == "text":
            st.write(message["content"])
        elif message["kind"] == "image":
            st.image(message["content"])


def add_message(role, kind, content):
    st.session_state.messages.append({"role": role, "kind": kind, "content": content})
    render_message(st.session_state.messages[-1])


def ask_gemini(parts):
    try:
        return st.session_state.chat.send_message(parts).text
    except Exception as error:
        error_text = str(error)
        can_retry = any(code in error_text for code in ["503", "404", "UNAVAILABLE", "NOT_FOUND"])
        if not can_retry:
            return f"Sorry, something went wrong: {error}"

        for model_name in llm_provider.fallback_models():
            try:
                st.session_state.chat = llm_provider.create_chat_for_model(model_name)
                st.session_state.active_model = model_name
                return st.session_state.chat.send_message(parts).text
            except Exception as fallback_error:
                error_text = str(fallback_error)

        return f"Sorry, something went wrong after trying backup Gemini models: {error_text}"


def ask_dermasnap(parts, instruction):
    grounded_instruction = build_grounded_prompt(instruction)
    return ask_gemini([grounded_instruction, *parts])


def review_with_openai(instruction, gemini_answer, image_bytes=None, mime_type=None):
    if openai_review_provider is None:
        return gemini_answer
    try:
        return openai_review_provider.review_skin_response(
            instruction=instruction,
            gemini_answer=gemini_answer,
            knowledge=load_skin_knowledge(),
            image_bytes=image_bytes,
            mime_type=mime_type,
        )
    except Exception as error:
        return (
            f"{gemini_answer}\n\n"
            f"Note: OpenAI background review could not run: {error}"
        )


def clean_whatsapp_text(text):
    if not text:
        return "No skin-health summary available."
    text = " ".join(text.split())
    return text[:1500] + "..." if len(text) > 1500 else text


def send_whatsapp(to_number, user_name, summary):
    if twilio_client is None:
        return False, "Twilio is not configured yet. Add Twilio values to secrets.toml."
    try:
        content_variables = json.dumps({"1": user_name}, ensure_ascii=False)
        message = twilio_client.messages.create(
            from_=TWILIO_WHATSAPP_FROM,
            to=f"whatsapp:{to_number}",
            content_sid=TWILIO_CONTENT_SID,
            content_variables=content_variables,
        )
        return True, message.sid
    except Exception as error:
        return False, str(error)


if "onboarded" not in st.session_state:
    st.title("DermaSnap")
    st.caption("Snap a skin concern. Get cautious triage. Send it to WhatsApp.")
    st.info(
        "DermaSnap is not a doctor and cannot confirm a diagnosis. For severe, "
        "fast-spreading, painful, infected, or fever-related symptoms, seek "
        "medical care urgently."
    )
    with st.form("onboarding_form"):
        name = st.text_input("Your name")
        whatsapp_number = st.text_input(
            "WhatsApp number (with country code)",
            placeholder="+91XXXXXXXXXX",
            help="This is the number DermaSnap will text your summary to.",
        )
        submitted = st.form_submit_button("Let's go")
    if submitted:
        if not name.strip() or not whatsapp_number.strip():
            st.warning("Please fill in both your name and WhatsApp number.")
        else:
            st.session_state.name = name.strip()
            st.session_state.whatsapp_number = whatsapp_number.strip()
            st.session_state.chat = llm_provider.create_chat()
            st.session_state.messages = []
            st.session_state.onboarded = True
            st.rerun()
    st.stop()

ensure_session_ready()

header_col, button_col = st.columns([5, 2], vertical_alignment="center")

with header_col:
    st.title("DermaSnap")

with button_col:
    send_disabled = len(st.session_state.messages) <= 2 or not TWILIO_READY
    send_help = None if TWILIO_READY else "Add Twilio credentials to enable WhatsApp."
    if st.button(
        "Send to WhatsApp",
        disabled=send_disabled,
        help=send_help,
        use_container_width=True,
    ):
        with st.spinner("Preparing your skin-health summary..."):
            summary = ask_gemini([build_grounded_prompt(SUMMARY_REQUEST_PROMPT)])
        success, info = send_whatsapp(
            st.session_state.whatsapp_number, st.session_state.name, summary
        )
        if success:
            st.success("Sent. Check your WhatsApp.")
        else:
            st.error(f"Couldn't send that: {info}")

st.caption(
    f"Logged in as {st.session_state.name} - summaries go to "
    f"{st.session_state.whatsapp_number}"
)
st.warning(
    "This app gives cautious information only, not a confirmed diagnosis. "
    "Consult a licensed clinician for medical advice."
)

if not st.session_state.messages:
    add_message(
        "assistant", "text", WELCOME_MESSAGE_TEMPLATE.format(name=st.session_state.name)
    )
else:
    for message in st.session_state.messages:
        render_message(message)

user_input = st.chat_input(
    "Describe symptoms, or attach a clear skin photo",
    accept_file=True,
    file_type=["jpg", "jpeg", "png"],
)

if user_input:
    photo = user_input.files[0] if user_input.files else None
    text = user_input.text
    parts = []
    photo_bytes = None
    photo_mime_type = None

    if photo is not None:
        photo_bytes = photo.getvalue()
        photo_mime_type = photo.type
        add_message("user", "image", photo_bytes)
        parts.append(llm_provider.image_part(photo_bytes, photo_mime_type))
    if text:
        add_message("user", "text", text)

    instruction = text or (
        "Please assess this skin concern cautiously. Say what is visible, "
        "possible causes, why it may have occurred, urgency level, safe next "
        "steps, prevention, and when to see a dermatologist. Do not give a "
        "definitive diagnosis, prescription, dosage, or exact treatment duration."
    )

    with st.spinner("Reviewing the skin concern..."):
        gemini_answer = ask_dermasnap(parts, instruction)
        answer = review_with_openai(
            instruction=instruction,
            gemini_answer=gemini_answer,
            image_bytes=photo_bytes,
            mime_type=photo_mime_type,
        )
    add_message("assistant", "text", answer)
