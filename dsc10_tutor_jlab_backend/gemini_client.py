import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from the backend directory
backend_dir = Path(__file__).parent
load_dotenv(dotenv_path=backend_dir / ".env")


def get_gemini_model(model_name: str = "gemini-3-pro-preview"):
    """
    Return a model identifier for ADK.
    ADK handles model instantiation internally.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY environment variable is not set. Please set it in a .env file or as an environment variable.")
    return model_name
