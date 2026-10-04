import os
import base64

from google import genai
from google.genai import types
from openai import OpenAI

from prompts import SYSTEM_PROMPT


DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"
FALLBACK_GEMINI_MODELS = (
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
)
PROXY_ENV_VARS = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
)


def clear_dead_local_proxy_settings():
    for name in PROXY_ENV_VARS:
        value = os.environ.get(name, "")
        if "127.0.0.1:9" in value or "localhost:9" in value:
            os.environ.pop(name, None)


class GeminiVisionProvider:
    def __init__(self, api_key, model_name=DEFAULT_GEMINI_MODEL):
        clear_dead_local_proxy_settings()
        self.client = genai.Client(api_key=api_key)
        self.model_name = model_name

    def create_chat(self):
        return self.client.chats.create(
            model=self.model_name,
            config=types.GenerateContentConfig(system_instruction=SYSTEM_PROMPT),
        )

    def create_chat_for_model(self, model_name):
        return self.client.chats.create(
            model=model_name,
            config=types.GenerateContentConfig(system_instruction=SYSTEM_PROMPT),
        )

    def fallback_models(self):
        return [model for model in FALLBACK_GEMINI_MODELS if model != self.model_name]

    @staticmethod
    def image_part(image_bytes, mime_type):
        return types.Part.from_bytes(data=image_bytes, mime_type=mime_type)


class OpenAIReviewProvider:
    def __init__(self, api_key, model_name="gpt-5.6-luna"):
        clear_dead_local_proxy_settings()
        self.client = OpenAI(api_key=api_key)
        self.model_name = model_name

    def review_skin_response(self, instruction, gemini_answer, knowledge, image_bytes=None, mime_type=None):
        content = [
            {
                "type": "input_text",
                "text": (
                    "You are DermaSnap's second medical-safety reviewer. "
                    "Use the reference notes, user request, and Gemini draft to "
                    "produce the final user-facing answer. Keep it concise and "
                    "clear. Do not give prescriptions, medicine dosages, steroid "
                    "instructions, antibiotic instructions, or exact treatment "
                    "durations. You may suggest general skin care, prevention, "
                    "and when to see a dermatologist. Always say this is not a "
                    "confirmed diagnosis.\n\n"
                    f"Reference notes:\n{knowledge}\n\n"
                    f"User request:\n{instruction}\n\n"
                    f"Gemini draft:\n{gemini_answer}"
                ),
            }
        ]
        if image_bytes and mime_type:
            encoded = base64.b64encode(image_bytes).decode("ascii")
            content.append(
                {
                    "type": "input_image",
                    "image_url": f"data:{mime_type};base64,{encoded}",
                }
            )

        response = self.client.responses.create(
            model=self.model_name,
            input=[{"role": "user", "content": content}],
        )
        return response.output_text
