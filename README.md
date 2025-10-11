# dsc10_tutor_jlab_backend

[![Github Actions Status](/workflows/Build/badge.svg)](/actions/workflows/build.yml)

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
uv sync --dev
# Link your development version of the extension with JupyterLab
jupyter labextension develop . --overwrite
# Server extension must be manually installed in develop mode
jupyter server extension enable dsc10_tutor_jlab_backend
```

#### Daily development workflow (run each time you start working)

```bash
# Sync packages
uv sync --dev
# Activate the uv environment
source .venv/bin/activate  # On Unix/macOS
# or
.venv\Scripts\activate     # On Windows
```

**Important**: After running `uv sync --dev`, you need to activate the uv virtual environment before running JupyterLab commands. The environment will be created in `.venv/` directory in your project root.

You can watch the source directory and run JupyterLab at the same time in different terminals to watch for changes in the extension's source and automatically rebuild the extension.

```bash
# Watch the source directory in one terminal, automatically rebuilding when needed
jlpm watch
# Run JupyterLab in another terminal (make sure your uv environment is activated)
jupyter lab
```

With the watch command running, every saved change will immediately be built locally and available in your running JupyterLab. Refresh JupyterLab to load the change in your browser (you may need to wait several seconds for the extension to be rebuilt).

By default, the `jlpm build` command generates the source maps for this extension to make it easier to debug using the browser dev tools. To also generate source maps for the JupyterLab core extensions, you can run the following command:

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

In development mode, you will also need to remove the symlink created by `jupyter labextension develop`
command. To find its location, you can run `jupyter labextension list` to figure out where the `labextensions`
folder is located. Then you can remove the symlink named `dsc10-tutor-jlab-frontend` within that folder.

### Testing the extension

#### Server tests

This extension is using [Pytest](https://docs.pytest.org/) for Python code testing.

**Note**: If you've already completed the one-time setup above, you can skip the dependency installation and extension linking steps.

Install test dependencies (needed only once):

```sh
uv sync --dev
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

This extension uses [Playwright](https://playwright.dev/docs/intro) for the integration tests (aka user level tests).
More precisely, the JupyterLab helper [Galata](https://github.com/jupyterlab/jupyterlab/tree/master/galata) is used to handle testing the extension in JupyterLab.

More information are provided within the [ui-tests](./ui-tests/README.md) README.

### Packaging the extension

See [RELEASE](RELEASE.md)
