#!/bin/zsh
# populate-agent-auth.sh — build ~/agent-auth/logins.json from Bitwarden.
# Same flat schema as the C:\agent-auth\ original: one object per domain with
# url, username, password. Bitwarden is the superset; this file is the
# agent-browser fast path. Disk only, chmod 600, never committed.
set -u

source "$HOME/.local/state/bitwarden/session.env" 2>/dev/null || true
export BW_SESSION
mkdir -p "$HOME/agent-auth"

python3 - <<'PYEOF'
import json, os, subprocess

# domain -> (bw search term, preferred username, canonical url)
SITES = {
    'my.acculynx.com':     ('my.acculynx.com',     'admin@spotonroof.com', 'https://my.acculynx.com'),
    'app.enzy.co':         ('app.enzy.co',         'admin@spotonroof.com', 'https://app.enzy.co/'),
    'accounts.intuit.com': ('accounts.intuit.com', 'admin@spotonroof.com', 'https://accounts.intuit.com/app/sign-in?app_group=QBO'),
    'accounts.google.com': ('accounts.google.com', 'admin@spotonroof.com', 'https://accounts.google.com'),
}

logins = {}
for domain, (term, preferred_user, url) in SITES.items():
    out = subprocess.run(['bw', 'list', 'items', '--search', term],
                         capture_output=True, text=True, timeout=60)
    try:
        items = json.loads(out.stdout)
    except Exception:
        items = []
    match = None
    for item in items:
        login = item.get('login') or {}
        if (login.get('username') or '').lower() == preferred_user:
            match = login
            break
    if match and match.get('password'):
        logins[domain] = {
            'url': url,
            'username': match.get('username'),
            'password': match.get('password'),
        }
        print(f'populate-agent-auth: {domain} -> {match.get("username")}')
    else:
        print(f'populate-agent-auth: {domain} NOT FOUND for {preferred_user}; add it in Bitwarden and re-run')

path = os.path.expanduser('~/agent-auth/logins.json')
with open(path, 'w') as f:
    json.dump(logins, f, indent=2)
os.chmod(path, 0o600)
print(f'populate-agent-auth: wrote {len(logins)} logins to {path}')
PYEOF
