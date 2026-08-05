import urllib.request, json, os
from pathlib import Path

# Secrets live in seeds/.env (gitignored), one KEY=VALUE per line:
#   SUPABASE_ACCESS_TOKEN=sbp_...   (Management API personal access token)
#   SUPABASE_ANON_KEY=eyJ...
_envfile = Path(__file__).with_name('.env')
if _envfile.exists():
    for _line in _envfile.read_text().splitlines():
        if _line.strip() and not _line.lstrip().startswith('#'):
            _k, _, _v = _line.partition('=')
            os.environ.setdefault(_k.strip(), _v.strip())

TOKEN = os.environ['SUPABASE_ACCESS_TOKEN']
PROJECT = 'fwbdcxnabfmfvsngherc'
SUPABASE_URL = f'https://{PROJECT}.supabase.co'
ANON_KEY = os.environ['SUPABASE_ANON_KEY']
CLIENT_ID = '00000000-0000-0000-0000-000000000001'

# ── Step 1: create table via Management API ───────────────────────────────────
ddl = """
CREATE TABLE IF NOT EXISTS payment_methods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  uuid NOT NULL,
  name       text NOT NULL,
  code       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, code)
);
ALTER TABLE payment_methods DISABLE ROW LEVEL SECURITY;
"""

payload = json.dumps({'query': ddl}).encode()
req = urllib.request.Request(
    f'https://api.supabase.com/v1/projects/{PROJECT}/database/query',
    data=payload,
    headers={
        'Authorization': f'Bearer {TOKEN}',
        'Content-Type': 'application/json',
    },
    method='POST'
)
try:
    with urllib.request.urlopen(req) as resp:
        print('DDL status:', resp.status, resp.read().decode())
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print('DDL HTTP error:', e.code, body[:300])

# ── Step 2: seed via PostgREST ────────────────────────────────────────────────
rows = [
    {'client_id': CLIENT_ID, 'name': 'Square',           'code': 'square',    'sort_order': 1, 'is_active': True},
    {'client_id': CLIENT_ID, 'name': 'Cash',             'code': 'cash',      'sort_order': 2, 'is_active': True},
    {'client_id': CLIENT_ID, 'name': 'Insurance',        'code': 'insurance', 'sort_order': 3, 'is_active': True},
    {'client_id': CLIENT_ID, 'name': 'Other',            'code': 'other',     'sort_order': 4, 'is_active': True},
]

payload = json.dumps(rows).encode()
req = urllib.request.Request(
    f'{SUPABASE_URL}/rest/v1/payment_methods',
    data=payload,
    headers={
        'apikey': ANON_KEY,
        'Authorization': f'Bearer {ANON_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates,return=minimal',
    },
    method='POST'
)
try:
    with urllib.request.urlopen(req) as resp:
        body = resp.read().decode()
        print('Seed status:', resp.status, body or '(empty — success)')
except urllib.error.HTTPError as e:
    print('Seed HTTP error:', e.code, e.read().decode())
