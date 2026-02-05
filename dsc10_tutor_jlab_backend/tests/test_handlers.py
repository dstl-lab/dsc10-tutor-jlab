import json


async def test_get_example(jp_fetch):
    # When
    response = await jp_fetch("dsc10-tutor-jlab-backend", "get-example")

    # Then
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload == {
        "data": "This is /dsc10-tutor-jlab-backend/get-example endpoint!"
    }


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

    assert "files" in payload
    assert isinstance(payload["files"], list)
