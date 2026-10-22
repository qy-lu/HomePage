#!/usr/bin/env python3
"""Read-only HTTP verification of homepage bytes and independent service status."""
import argparse
import hashlib
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import urllib.error
import urllib.request

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def request(url):
    opener = urllib.request.build_opener(NoRedirect())
    try:
        response = opener.open(urllib.request.Request(url, headers={'Cache-Control': 'no-cache'}), timeout=25)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        data = response.read()
        return {'url': url, 'status': response.code,
                'location': response.headers.get('Location'),
                'sha256': hashlib.sha256(data).hexdigest()}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('manifest', type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    resources = [(f'https://{host}/' + ('' if name == 'index.html' else name), sha)
                 for host in ('thomas-hub.com', 'www.thomas-hub.com')
                 for name, sha in manifest.items()]
    with ThreadPoolExecutor(max_workers=4) as pool:
        checks = list(pool.map(request, [url for url, sha in resources]))
    for check, (url, sha) in zip(checks, resources):
        if check['status'] != 200 or check['sha256'] != sha:
            raise RuntimeError('HTTP content mismatch: ' + json.dumps(check))
    urls = ['http://thomas-hub.com/', 'http://www.thomas-hub.com/',
            'https://thomas-hub.com/wordpressZero/', 'https://thomas-hub.com/jupyter/',
            'https://anime.thomas-hub.com/', 'https://askpool.thomas-hub.com/']
    services = [request(url) for url in urls]
    config = Path('/etc/apache2/sites-available/thomas-hub.conf')
    print(json.dumps({'homepage_http_verified': len(checks), 'checks': checks,
                      'services': services,
                      'apache_config_sha256': hashlib.sha256(config.read_bytes()).hexdigest()}, indent=2))

if __name__ == '__main__':
    main()
