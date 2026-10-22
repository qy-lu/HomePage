#!/usr/bin/env python3
"""Explicit allowlist deploy, guarded against drift, with backup and rollback.

Only writes the homepage files listed in the captured baseline. Never extracts an
archive into the document root and never deletes unlisted files.
"""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tarfile
import tempfile

ROOT = Path('/var/www/public-root')
STATE = Path('/var/backups/thomas-homepage')

def digest(data):
    return hashlib.sha256(data).hexdigest()

def snapshot(root):
    result = {}
    for item in sorted(root.rglob('*')):
        if item.is_symlink():
            result[item.relative_to(root).as_posix()] = {'symlink': os.readlink(item)}
        elif item.is_file():
            st = item.stat()
            result[item.relative_to(root).as_posix()] = {
                'sha256': digest(item.read_bytes()), 'mode': stat.S_IMODE(st.st_mode),
                'uid': st.st_uid, 'gid': st.st_gid,
            }
    return result

def validate_path(name):
    if name in ('index.html', 'icon.png', 'favicon.ico', 'css/style.css', 'js/main.js', 'js/background.js'):
        return
    if name.startswith('assets/') and len(Path(name).parts) == 2 and '..' not in Path(name).parts:
        return
    raise RuntimeError('Outside homepage allowlist: ' + name)

def target(name):
    validate_path(name)
    result = ROOT / name
    if ROOT.is_symlink() or result.is_symlink() or result.resolve().parent != result.parent:
        raise RuntimeError('Symlink or unexpected target: ' + name)
    if not result.resolve().is_relative_to(ROOT.resolve()):
        raise RuntimeError('Target escaped document root')
    return result

def write_atomic(name, data, metadata):
    dest = target(name)
    # Atomic replacement per file, with index.html always installed last.
    fd, temporary = tempfile.mkstemp(prefix='.homepage-', dir=dest.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, metadata['mode'])
        os.chown(temporary, metadata['uid'], metadata['gid'])
        os.replace(temporary, dest)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def restore(backup):
    before = json.loads((backup / 'before.json').read_text())
    installed = json.loads((backup / 'manifest.json').read_text())
    for name in installed:
        target(name)
    for name in sorted(installed, key=lambda name: (name == 'index.html', name)):
        write_atomic(name, (backup / 'files' / name).read_bytes(), before[name])

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--expect', type=Path, help='Expected current hashes; abort on server drift')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--rollback', help='Backup directory name returned by a previous deployment')
    args = parser.parse_args()
    if ROOT.resolve() != ROOT or not ROOT.is_dir():
        raise RuntimeError('Unexpected document root')
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with open(STATE / 'deploy.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.rollback:
            if Path(args.rollback).name != args.rollback:
                raise RuntimeError('Invalid backup ID')
            backup = STATE / args.rollback
            installed = json.loads((backup / 'manifest.json').read_text())
            current = snapshot(ROOT)
            if any(current.get(name, {}).get('sha256') != value for name, value in installed.items()):
                raise RuntimeError('Current homepage differs from this release; inspect before rollback')
            restore(backup)
            restored = snapshot(ROOT)
            before = json.loads((backup / 'before.json').read_text())
            if any(restored.get(name) != before[name] for name in installed):
                raise RuntimeError('Rollback verification failed')
            if {k:v for k,v in current.items() if k not in installed} != {k:v for k,v in restored.items() if k not in installed}:
                raise RuntimeError('Unrelated files changed during rollback')
            print(json.dumps({'rollback': args.rollback, 'verified': True}))
            return
        if not args.archive or not args.expect:
            parser.error('--archive and --expect are required for deployment')
        expected = json.loads(args.expect.read_text())
        with tarfile.open(args.archive, 'r:gz') as archive:
            members = archive.getmembers()
            names = [item.name for item in members]
            if len(names) != len(set(names)) or any(not item.isfile() for item in members):
                raise RuntimeError('Archive must contain unique regular files only')
            if 'manifest.json' not in names:
                raise RuntimeError('Manifest missing')
            manifest = json.load(archive.extractfile('manifest.json'))
            if set(names) != set(manifest) | {'manifest.json'} or not set(manifest).issubset(expected):
                raise RuntimeError('Archive file list does not match reviewed allowlist')
            payload = {}
            for name, sha in manifest.items():
                target(name)
                payload[name] = archive.extractfile(name).read()
                if digest(payload[name]) != sha:
                    raise RuntimeError('Archive hash mismatch: ' + name)
        before = snapshot(ROOT)
        for name, sha in expected.items():
            if before.get(name, {}).get('sha256') != sha:
                raise RuntimeError('Server drift detected: ' + name)
        if args.dry_run:
            print(json.dumps({'dry_run': True, 'files': len(payload), 'all_current_hashes_match': True,
                              'changed_files': [name for name in payload if manifest[name] != expected[name]]}))
            return
        release_id = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        backup = STATE / release_id
        backup.mkdir(mode=0o700)
        shutil.copy2(Path(__file__), backup / 'server-release.py')
        (backup / 'before.json').write_text(json.dumps(before, indent=2))
        (backup / 'manifest.json').write_text(json.dumps(manifest, indent=2))
        # Full root archive is recovery insurance, including files outside the deploy allowlist.
        with tarfile.open(backup / 'public-root.tar.gz', 'w:gz') as archive:
            archive.add(ROOT, arcname='public-root')
        for name in payload:
            saved = backup / 'files' / name
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target(name), saved)
        if snapshot(ROOT) != before:
            raise RuntimeError('Document root changed while preparing backup; nothing installed')
        try:
            for name in sorted(payload, key=lambda name: (name == 'index.html', name)):
                write_atomic(name, payload[name], before[name])
            after = snapshot(ROOT)
            if any(after.get(name, {}).get('sha256') != sha for name, sha in manifest.items()):
                raise RuntimeError('Post-deploy hash check failed')
            if {k:v for k,v in before.items() if k not in manifest} != {k:v for k,v in after.items() if k not in manifest}:
                raise RuntimeError('Unrelated files changed during deploy')
        except Exception:
            restore(backup)
            raise
        report = {'release': release_id, 'backup': str(backup), 'verified': True,
                  'files': len(payload), 'unrelated_files_unchanged': True,
                  'changed_files': [name for name in payload if manifest[name] != expected[name]]}
        (backup / 'result.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report))

if __name__ == '__main__':
    main()
