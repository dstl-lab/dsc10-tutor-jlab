# dsc10_tutor_jlab_backend

AI Tutor for DSC 10

This extension is composed of a Python package named `dsc10_tutor_jlab_backend`
for the server extension and a NPM package named `dsc10-tutor-jlab-frontend`
for the frontend extension.

## Requirements

- JupyterLab >= 4.0.0

## Install

To install the extension, execute:

```bash
pip install dsc10_tutor_jlab_backend
```

## Uninstall

To remove the extension, execute:

```bash
pip uninstall dsc10_tutor_jlab_backend
```

## Troubleshoot

If you are seeing the frontend extension, but it is not working, check
that the server extension is enabled:

```bash
jupyter server extension list
```

If the server extension is installed and enabled, but you are not seeing
the frontend extension, check the frontend extension is installed:

```bash
jupyter labextension list
```

## Contributing

### Development install

Note: You will need `uv` and NodeJS to build the extension package.

The `jlpm` command is JupyterLab's pinned version of
[yarn](https://yarnpkg.com/) that is installed with JupyterLab. You may use
`yarn` or `npm` in lieu of `jlpm` below.

#### One-time setup (run once after cloning the repo)

```bash
# Clone the repo to your local environment
# Change directory to the dsc10_tutor_jlab_backend directory
# Install package and development dependencies using uv
uv sync --dev --extra test
# Link your development version of the extension with JupyterLab
uv run jupyter labextension develop . --overwrite
# Server extension must be manually installed in develop mode
uv run jupyter server extension enable dsc10_tutor_jlab_backend
```

#### Daily development workflow (run each time you start working)

```bash
# Sync packages
uv sync --dev --extra test
# Activate the uv environment
source .venv/bin/activate  # On Unix/macOS
# or
.venv\Scripts\activate     # On Windows
```

**Important**: After running `uv sync --dev`, you need to activate the uv
virtual environment before running JupyterLab commands (or use `uv run` for all
commands). The environment will be created in `.venv/` directory in your project
root.

You can watch the source directory and run JupyterLab at the same time in
different terminals to watch for changes in the extension's source and
automatically rebuild the extension.

```bash
# Watch the source directory in one terminal, automatically rebuilding when needed
jlpm watch

# Run JupyterLab in another terminal (make sure your uv environment is activated)
jupyter lab
```

With the watch command running, every saved change will immediately be built
locally and available in your running JupyterLab. Refresh JupyterLab to load the
change in your browser (you may need to wait several seconds for the extension
to be rebuilt).

By default, the `jlpm build` command generates the source maps for this
extension to make it easier to debug using the browser dev tools. To also
generate source maps for the JupyterLab core extensions, you can run the
following command:

```bash
jupyter lab build --minimize=False
```

### Development uninstall

```bash
# Server extension must be manually disabled in develop mode
jupyter server extension disable dsc10_tutor_jlab_backend
# Remove the uv virtual environment (no need to uninstall the package)
rm -rf .venv
```

In development mode, you will also need to remove the symlink created by
`jupyter labextension develop` command. To find its location, you can run
`jupyter labextension list` to figure out where the `labextensions` folder is
located. Then you can remove the symlink named `dsc10-tutor-jlab-frontend`
within that folder.

### Testing the extension

#### Server tests

This extension is using [Pytest](https://docs.pytest.org/) for Python code
testing.

**Note**: If you've already completed the one-time setup above, you can skip the
dependency installation and extension linking steps.

Install test dependencies (needed only once):

```sh
uv sync --dev --extra test
# Each time you install the Python package, you need to restore the front-end extension link
jupyter labextension develop . --overwrite
```

To execute tests, run:

```sh
# Make sure your uv environment is activated
source .venv/bin/activate  # On Unix/macOS
# or
.venv\Scripts\activate     # On Windows
# Run the tests
pytest -vv -r ap --cov dsc10_tutor_jlab_backend
```

#### Frontend tests

This extension is using [Jest](https://jestjs.io/) for JavaScript code testing.

To execute them, execute:

```sh
jlpm
jlpm test
```

#### Integration tests

This extension uses [Playwright](https://playwright.dev/docs/intro) for the
integration tests (aka user level tests). More precisely, the JupyterLab helper
[Galata](https://github.com/jupyterlab/jupyterlab/tree/master/galata) is used to
handle testing the extension in JupyterLab.

More information are provided within the [ui-tests](./ui-tests/README.md) README.

### Packaging the extension

See [RELEASE](RELEASE.md)

---

DSC 10 Tutor (JupyterLab extension)

An in-notebook AI tutor for UC San Diego's DSC 10 (Principles of Data Science), built as a JupyterLab extension.
Students chat with the tutor in a side panel without leaving their notebook — it reads the current notebook state, answers questions in the style of a course tutor (powered by Google's Gemini), surfaces the most relevant cells from lecture notebooks via TF-IDF retrieval, recommends practice problems pulled from https://practice.dsc10.com, and offers an "exam mode" that drills students on past midterm and final questions. The extension is course-shaped but not course-locked: the lecture index, practice-problem dataset, and tutor prompts can all be swapped out to adapt it to other intro data science or programming courses. See Adapting for your class below.

---

Adapting for your class

This extension was built for DSC 10, but the course-specific pieces are isolated to a handful of files. To adapt it
for your own course:

1. Set environment variables

Create dsc10_tutor_jlab_backend/.env:

GEMINI_API_KEY=your_google_ai_studio_key
LECTURES_PATH=/absolute/path/to/your/lecture/notebooks # optional; auto-discovered if omitted

You can get a Gemini API key at aistudio.google.com (https://aistudio.google.com/apikey). The free tier is generous
enough for a small class; check rate limits before a full course deployment.

2. Point the tutor at your lecture notebooks

The tutor retrieves relevant cells from your lecture notebooks via TF-IDF. By default it auto-discovers any folder
named lectures/, lecture/, or lecs/ in the JupyterLab server root, and indexes notebooks whose filenames start with
lec or lecture (e.g. lec05.ipynb, lecture12-intro.ipynb). Set LECTURES_PATH to override the location explicitly.

Notebooks ending in -live.ipynb (live-coding versions) are skipped automatically in favor of the clean variants.

3. Replace the practice-problem dataset

Practice problems and exam questions are stored as JSON in dsc10_tutor_jlab_backend/data/:

- lecture_problems.json — problems indexed by lecture/topic
- exam_problems.json — past midterm and final questions used by "exam mode"

You have two options:

- Re-crawl from a similar site. If you maintain a problems website similar in shape to https://practice.dsc10.com,
  edit dsc10_tutor_jlab_backend/practice_problems/crawler.py to point at your URL structure, then run python -m
  dsc10_tutor_jlab_backend.practice_problems.ingest to regenerate both JSON files.
- Hand-author the JSON. The schemas are small and human-writable; open the existing files for the expected shape
  (text, images, source URL, lecture number, anchor IDs, etc.).

After replacing the data, update dsc10_tutor_jlab_backend/practice_problems/lecture_mapper.py so the topic-to-lecture mapping reflects your syllabus. This is what lets students say "I need practice with groupby" and get problems from the right lecture.

4. Rewrite the tutor prompts

Course-specific guidance (DSC 10 conventions, babypandas, the course's preferred phrasing) lives in
dsc10_tutor_jlab_backend/prompts.py and src/utils/prompts.py. Replace the DSC10-specific instructions with your own course context, libraries, and pedagogical preferences.

5. Configure or disable logging

src/api/logger.ts posts events to UC San Diego's internal logging API. For your deployment, either:

- Point LOG_API at your own logging endpoint (any service that accepts POST /events with a JSON body), or
- Replace the body of logEvent with a no-op (return;) to disable telemetry entirely.

Logged events include tutor queries, responses, lecture clicks, exam-mode activity, etc. No raw notebook content is
sent unless you opt in via the tutor_notebook_info event.

6. (Optional) Rename the extension

If you plan to publish your fork, update the package names in package.json, pyproject.toml, and the folder name
dsc10_tutor_jlab_backend/ to something course-specific. The backend route prefix /dsc10-tutor-jlab-backend/ in
handlers.py and src/api/index.ts will need to match.

7. Deploy

The extension installs like any JupyterLab extension (pip install + jupyter labextension develop). For class-wide
deployment you'll typically bake it into your course's JupyterHub/DataHub image — see your platform's docs for adding a pip install step to the build.
