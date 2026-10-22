#!/usr/bin/env python3
"""Verify sequential rollbacks in an isolated production copy, never on the live root."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile

ids = sys.argv[1:]
if not ids or any(Path(value).name != value for value in ids):
    raise RuntimeError('Supply backup IDs from newest to oldest')
state = Path('/var/backups/thomas-homepage')
reports = []
with tempfile.TemporaryDirectory(prefix='homepage-rollback-chain-', dir='/var/tmp') as directory:
    sandbox = Path(directory)
    shutil.copytree('/var/www/public-root', sandbox / 'public-root', symlinks=True)
    (sandbox / 'backups').mkdir()
    for release_id in ids:
        backup = state / release_id
        before = json.loads((backup / 'before.json').read_text())
        with tarfile.open(backup / 'public-root.tar.gz', 'r:gz') as archive:
            archived = {}
            for member in archive.getmembers():
                path = Path(member.name)
                if path.parts[0] != 'public-root' or '..' in path.parts:
                    raise RuntimeError('Unexpected backup archive path')
                name = Path(*path.parts[1:]).as_posix()
                if member.isfile():
                    archived[name] = {'sha256': hashlib.sha256(archive.extractfile(member).read()).hexdigest(),
                                      'mode': member.mode, 'uid': member.uid, 'gid': member.gid}
                elif member.issym():
                    archived[name] = {'symlink': member.linkname}
            if archived != before:
                raise RuntimeError('Backup archive verification failed: ' + release_id)
        shutil.copytree(backup, sandbox / 'backups' / release_id)
        spec = importlib.util.spec_from_file_location('release', backup / 'server-release.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.ROOT = sandbox / 'public-root'
        module.STATE = sandbox / 'backups'
        sys.argv = ['server-release.py', '--rollback', release_id]
        with contextlib.redirect_stdout(io.StringIO()):
            module.main()
        if module.snapshot(module.ROOT) != before:
            raise RuntimeError('Isolated rollback did not match snapshot: ' + release_id)
        reports.append({'release': release_id, 'archive_verified': True,
                        'isolated_rollback_verified': True, 'files': len(before)})
result = {'rollbacks_newest_to_oldest': reports, 'production_modified': False}
(state / ids[0] / 'rollback-chain-verification.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
