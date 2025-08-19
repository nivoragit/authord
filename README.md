# authord
Private TypeScript module for @authord/core

exportHash is stored as a Confluence content property on the page, named exportHash.
To clear it:
`# vars (edit BASE if your Confluence lives under /wiki)
TOKEN='your token'
BASE='base'
PAGE='page id'

# delete the exportHash property
curl -i -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Atlassian-Token: no-check" \
  "$BASE/rest/api/content/$PAGE/property/exportHash"

# verify (should return 404 Not Found if cleared)
curl -i \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE/rest/api/content/$PAGE/property/exportHash"`
