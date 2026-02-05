import json
import os
import tempfile
from pathlib import Path
from tornado.httpclient import HTTPClientError


async def test_get_example(jp_fetch):
    # When
    response = await jp_fetch("dsc10-tutor-jlab-backend", "get-example")

    # Then
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload == {
        "data": "This is /dsc10-tutor-jlab-backend/get-example endpoint!"
    }


async def test_read_file_success(jp_fetch, tmp_path):
    test_file = tmp_path / "test.txt"
    test_content = "Hello, World!\nThis is a test file."
    test_file.write_text(test_content)

    response = await jp_fetch(
        "dsc10-tutor-jlab-backend",
        "read-file",
        method="POST",
        body=json.dumps({
            "file_path": str(test_file),
            "notebook_path": str(tmp_path / "notebook.ipynb")
        })
async def test_list_files(jp_fetch):
    response = await jp_fetch("dsc10-tutor-jlab-backend", "list-files")

    assert response.code == 200
    payload = json.loads(response.body)
    assert "files" in payload


async def test_search_files_empty(jp_fetch):
    response = await jp_fetch(
        "dsc10-tutor-jlab-backend",
        "search-files",
        method="POST",
        body=json.dumps({"query": "groupby"}),
    )

    assert response.code == 200
    payload = json.loads(response.body)
    assert payload["file_path"] == str(test_file)
    assert payload["content"] == test_content
    assert payload["truncated"] is False
    assert payload["file_size"] == len(test_content)
    assert payload["content_length"] == len(test_content)


async def test_read_file_relative_path(jp_fetch, tmp_path):
    test_file = tmp_path / "test.txt"
    test_content = "Test content"
    test_file.write_text(test_content)


    response = await jp_fetch(
        "dsc10-tutor-jlab-backend",
        "read-file",
        method="POST",
        body=json.dumps({
            "file_path": "test.txt",
            "notebook_path": str(tmp_path / "notebook.ipynb")
        })
    assert "files" in payload


async def test_search_files_finds_notebooks(jp_fetch):
    response = await jp_fetch(
        "dsc10-tutor-jlab-backend",
        "search-files",
        method="POST",
        body=json.dumps({"query": "numpy", "scope": "."}),
    )

    assert response.code == 200
    payload = json.loads(response.body)
    assert payload["content"] == test_content


async def test_read_file_missing_path(jp_fetch):
    try:
        response = await jp_fetch(
            "dsc10-tutor-jlab-backend",
            "read-file",
            method="POST",
            body=json.dumps({})
        )
    except HTTPClientError as e:
        response = e.response

    assert response.code == 400
    payload = json.loads(response.body)
    assert "error" in payload
    assert "file_path" in payload["error"].lower()


async def test_read_file_not_found(jp_fetch, tmp_path):
    try:
        response = await jp_fetch(
            "dsc10-tutor-jlab-backend",
            "read-file",
            method="POST",
            body=json.dumps({
                "file_path": str(tmp_path / "nonexistent.txt"),
                "notebook_path": str(tmp_path / "notebook.ipynb")
            })
        )
    except HTTPClientError as e:
        response = e.response

    assert response.code == 404
    payload = json.loads(response.body)
    assert "error" in payload
    assert "not found" in payload["error"].lower()



    assert "files" in payload
    assert isinstance(payload["files"], list)
