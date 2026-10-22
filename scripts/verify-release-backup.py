#!/usr/bin/env python3
"""Verify an existing production backup by restoring it into an isolated copy."""
import argparse
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

parser = argparse.ArgumentParser()
parser.add_argument('release_id')
args = parser.parse_args()
if Path(args.release_id).name != args.release_id:
    raise RuntimeError('Invalid release ID')
backup = Path('/var/backups/thomas-homepage') / args.release_id
before = json.loads((backup / 'before.json').read_text())
spec = importlib.util.spec_from_file_location('release', backup / 'server-release.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
archive_path = backup / 'public-root.tar.gz'
with tarfile.open(archive_path, 'r:gz') as archive:
    archived = {}
    for member in archive.getmembers():
        path = Path(member.name)
        if path.parts[0] != 'public-root' or '..' in path.parts:
            raise RuntimeError('Unexpected archive path')
        name = Path(*path.parts[1:]).as_posix()
        if member.isfile():
            archived[name] = {'sha256': hashlib.sha256(archive.extractfile(member).read()).hexdigest(),
                              'mode': member.mode, 'uid': member.uid, 'gid': member.gid}
        elif member.issym():
            archived[name] = {'symlink': member.linkname}
    if archived != before:
        raise RuntimeError('Full backup archive does not match pre-release snapshot')

with tempfile.TemporaryDirectory(prefix='homepage-restore-check-', dir='/var/tmp') as directory:
    sandbox = Path(directory)
    # Production is only read. All writes and rollback happen in this isolated directory.
    shutil.copytree('/var/www/public-root', sandbox / 'public-root', symlinks=True)
    (sandbox / 'backups').mkdir()
    shutil.copytree(backup, sandbox / 'backups' / args.release_id)
    module.ROOT = sandbox / 'public-root'
    module.STATE = sandbox / 'backups'
    sys.argv = ['server-release.py', '--rollback', args.release_id]
    with contextlib.redirect_stdout(io.StringIO()):
        module.main()
    if module.snapshot(module.ROOT) != before:
        raise RuntimeError('Restored copy does not match pre-release snapshot')
result = {'release': args.release_id, 'archive_verified': True,
          'isolated_rollback_verified': True, 'all_before_files_restored': len(before),
          'archive_sha256': hashlib.sha256(archive_path.read_bytes()).hexdigest()}
(backup / 'recovery-verification.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
