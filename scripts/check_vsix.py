"""Fail packaging if runtime files are missing or development/local data leak in."""
import json
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1]) as archive:
    names = set(archive.namelist())
    manifest = json.loads(archive.read("extension/package.json"))
    main = "extension/" + manifest["main"].removeprefix("./")
    required = {main, "extension/python/executor_runner.py", "extension/python/pi/runner.py",
                "extension/python/pi/command.py", "extension/python/schemas/task.py"}
    assert required <= names, f"Missing runtime files: {required - names}"
    forbidden = ("extension/.ai-project/", "extension/.pi/", "extension/.vscode-test/", "extension/node_modules/",
                 "extension/test/", "extension/out/test/", "extension/python/tests/", "extension/scripts/")
    assert not any(name.startswith(forbidden) or name.endswith((".ts", ".map", ".pyc")) for name in names), \
        "Development or local data included in VSIX"
    print(f"VSIX verified: {len(names)} entries, runtime present, no tests/dependencies/local sessions")
