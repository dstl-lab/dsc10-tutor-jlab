"""
agents.py

This file contains templates and helpers for defining Gemini ADK agents.
Use this as a reference when adding new agents (e.g. debugging agents,
practice agents, etc.)
"""

# from google.generativeai.adk import Agent
# from ..gemini_client import get_gemini_model


# def create_debugging_agent():
#     """
#     Example agent: Debugging-focused DSC 10 tutor.

#     Purpose:
#     - Help students debug errors step-by-step
#     - Encourage reasoning about error messages
#     - Avoid giving full solutions immediately
#     """

#     instructions = """
# You are a DSC 10 tutor in debug mode.
# """

#     return Agent(
#         model=get_gemini_model(),
#         instructions=instructions,
#         tools=[],
#     )
