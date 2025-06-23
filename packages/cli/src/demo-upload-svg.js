// demo-upload-svg.js
//
// 1) Edit the two constants below to match your SVG file and Confluence page.
// 2) Run with:  node demo-upload-svg.js
//
// Environment variables still required for authentication:
//   CONF_BASE_URL=https://your-site.atlassian.net
//   CONF_USER=you@company.com
//   CONF_TOKEN=yourApiToken

import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';

const svgPath = '/private/var/folders/6g/v5qmkzrd5p35hjt6fl11_yqc0000gn/T/writerside-diagrams/4f96e23ee.svg';  // ← set your SVG file here
const pageId  = '1343511';                         // ← set your Confluence page ID here

async function main() {
  // --- Confluence credentials from env ---
  const cfg = {
    baseUrl: 'https://p19951115.atlassian.net',
    email:  'p19951115@gmail.com',
    apiToken:'ATATT3xFfGF05tPk8zxE5zoot_a_jMb4ozEPx5UUAdLXSo19uT8JhWJfRPbKZJptiUpoyamQtcLAlc6Xw5bRooNhxjtclxDGM5yQ-SfmxzLEVJA8hySGPW7SvT6zaK2bBbe836Sd6esGqaoGPQ89EN0fWb6wFnuuhNI9lLbajt4hWFI-eMwFgRg=ED646490'
  };
  const auth = { username: cfg.email, password: cfg.apiToken };

  // 1. Upload the SVG as a page attachment
  const fileName  = path.basename(svgPath);
  const attachUrl = `${cfg.baseUrl}/wiki/rest/api/content/${pageId}/child/attachment`;
  const svgBuffer = await fs.readFile(svgPath);
  const form = new FormData();
  form.append('file', svgBuffer, { filename: fileName, contentType: 'image/svg+xml' });

  const uploadRes = await axios.post(attachUrl, form, {
    headers: { ...form.getHeaders(), 'X-Atlassian-Token': 'no-check' },
    auth
  });
  const fileId = uploadRes.data.results[0].extensions.fileId;
  console.log(`Uploaded ${fileName} → fileId=${fileId}`);

  // 2. Build a minimal ADF embedding that SVG
  const adf = {
    version: 1,
    type: 'doc',
    content: [{
      type: 'mediaSingle',
      attrs: { layout: 'center' },
      content: [{
        type: 'media',
        attrs: {
          id: fileId,
          type: 'file',
          collection: `contentId-${pageId}`,  // ← crucial for page attachments
          occurrenceKey: Date.now().toString()
        }
      }]
    }]
  };

  // 3. Fetch page metadata to bump the version
  const pageMeta = await axios.get(
    `${cfg.baseUrl}/wiki/rest/api/content/${pageId}?expand=version,title`,
    { auth }
  );
  const title       = pageMeta.data.title;
  const nextVersion = pageMeta.data.version.number + 1;

  // 4. PUT the updated ADF back to Confluence
  await axios.put(
    `${cfg.baseUrl}/wiki/rest/api/content/${pageId}`,
    {
      id:      pageId,
      type:    'page',
      title,
      version: { number: nextVersion },
      body: {
        atlas_doc_format: {
          value:          JSON.stringify(adf),
          representation: 'atlas_doc_format'
        }
      }
    },
    { headers: { 'Content-Type': 'application/json' }, auth }
  );

  console.log('✅ Page updated – check Confluence for your SVG preview!');
}

main().catch(err => {
  console.error('❌ Demo failed:', err.response?.data || err.message);
  process.exit(1);
});
