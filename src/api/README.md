# 2025-12-02 email from matt about prompt_mode:

I've added a new prompt_mode field to the /dsc10/ask API that gives you full control over how prompts are handled. There are now three modes:

1. "override" - Full ChatGPT-like mode (what you need)

Replace the entire SLH prompt with your custom prompt:

```json
{
  "class_id": "your_class_id",
  "assignment_id": "your_assignment_id",
  "question_id": null,
  "prompt": "You are a helpful assistant. Give output in markdown.",
  "prompt_mode": "override",
  "student_question": "How do I filter a DataFrame?",
  "notebook_json": "{...}",
  "student_email": "student@ucsd.edu"
}
```

With "override", the system will use only your custom prompt and ignore the SLH tutor instructions.

2. "append" - Enhanced SLH mode (default)

Adds your prompt as additional instructor guidance:

```json
{
  "prompt": "Focus on helping with groupby operations",
  "prompt_mode": "append"
}
```

This is the previous behavior - your prompt is added after the SLH instructions.

3. "none" - Pure SLH mode

Use only the base SLH tutor prompt:

```json
{
  "prompt": "This will be ignored",
  "prompt_mode": "none"
}
```

Implementation Note

If you don't specify prompt_mode, it defaults to "append" for backward compatibility. The notebook context is still

included in all modes when provided.
