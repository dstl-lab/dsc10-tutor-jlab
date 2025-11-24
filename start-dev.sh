#!/bin/bash

PROJECT_DIR="$HOME/dstl-lab/dsc10-tutor-jlab"

# Terminal A – frontend watcher
gnome-terminal -- bash -c "
    cd $PROJECT_DIR;
    source .venv/bin/activate;
    uv run jlpm watch;
    exec bash
"

# Terminal B – JupyterLab instance
gnome-terminal -- bash -c "
    cd $PROJECT_DIR;
    source .venv/bin/activate;
    uv run jupyter lab;
    exec bash
"
