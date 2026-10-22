#!/usr/bin/env python3
"""Exercise deploy safety in a temporary directory, never against production."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('server-release.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def run(*args):
    sys.argv = ['server-release.py', *map(str, args)]
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        module.main()
    return json.loads(out.getvalue())

def rejected(*args):
    try:
        run(*args)
    except RuntimeError:
        return
    raise AssertionError('Unsafe deployment was accepted')

with tempfile.TemporaryDirectory(prefix='homepage-release-test-') as temp:
    sandbox = Path(temp)
    module.ROOT = sandbox / 'public'
    module.STATE = sandbox / 'backups'
    module.ROOT.mkdir()
    (module.ROOT / 'index.html').write_bytes(b'old homepage')
    (module.ROOT / 'unrelated.txt').write_bytes(b'keep me')
    old = module.snapshot(module.ROOT)
    expected = sandbox / 'expected.json'
    expected.write_text(json.dumps({'index.html': old['index.html']['sha256']}))
    candidate = b'new homepage'
    manifest = {'index.html': hashlib.sha256(candidate).hexdigest()}
    archive = sandbox / 'release.tar.gz'
    def pack(entries):
        with tarfile.open(archive, 'w:gz') as tar:
            for name, data in entries.items():
                member = tarfile.TarInfo(name)
                member.size = len(data)
                tar.addfile(member, io.BytesIO(data))
    entries = {'index.html': candidate, 'manifest.json': json.dumps(manifest).encode()}
    pack(entries)
    args = ['--archive', archive, '--expect', expected]
    assert run(*args, '--dry-run')['changed_files'] == ['index.html']
    assert module.snapshot(module.ROOT) == old
    report = run(*args)
    assert (module.ROOT / 'index.html').read_bytes() == candidate
    assert (module.ROOT / 'unrelated.txt').read_bytes() == b'keep me'
    rejected(*args)  # Out-of-date expected server content must stop deployment.
    run('--rollback', report['release'])
    assert module.snapshot(module.ROOT) == old
    pack({**entries, 'index.html': b'tampered'})
    rejected(*args)  # Checksums are enforced before writes.
    pack({**entries, '../outside': b'bad'})
    rejected(*args)  # Archive traversal / extra file is rejected.
    pack(entries)
    original_write = module.write_atomic
    count = [0]
    def fail_after_write(*args):
        original_write(*args)
        count[0] += 1
        if count[0] == 1:
            raise OSError('Simulated interrupted deployment')
    module.write_atomic = fail_after_write
    try:
        run(*args)
    except OSError:
        pass
    else:
        raise AssertionError('Failure injection did not run')
    assert module.snapshot(module.ROOT) == old
    module.write_atomic = original_write
    (module.ROOT / 'index.html').unlink()
    (module.ROOT / 'index.html').symlink_to(sandbox / 'outside')
    rejected(*args)
print('PASS: dry-run, changed-content deploy, drift guard, rollback, checksum guard, archive guard, automatic recovery, symlink guard, unrelated file preservation')
