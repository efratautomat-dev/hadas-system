import { google } from 'googleapis';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const ROOT_ID = '1ocbxq5-ReY7WutAm48pKHDiaB8rBe6SM';
const MAX_DEPTH = 3;

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
oauth2.setCredentials({ refresh_token: REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oauth2 });

async function listChildren(parentId) {
  const out = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: "'" + parentId + "' in parents and trashed = false",
      fields: 'nextPageToken, files(id, name, mimeType)',
      pageSize: 1000, pageToken,
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    out.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return out;
}

const isFolder = f => f.mimeType === 'application/vnd.google-apps.folder';

async function walk(id, name, depth) {
  const children = await listChildren(id);
  const folders = children.filter(isFolder);
  const files = children.filter(f => !isFolder(f));
  const indent = '  '.repeat(depth);
  console.log(indent + '[DIR] ' + name + '  {' + id + '}  files=' + files.length + ' subfolders=' + folders.length);
  if (depth < MAX_DEPTH) {
    for (const f of folders) await walk(f.id, (f.name || '').trim(), depth + 1);
  } else if (folders.length) {
    console.log(indent + '  ... (' + folders.length + ' more subfolders, depth limit ' + MAX_DEPTH + ')');
  }
}

(async () => {
  try {
    const { token } = await oauth2.getAccessToken();
    console.log(token ? 'TOKEN OK' : 'NO ACCESS TOKEN');
    console.log('');
    const meta = await drive.files.get({ fileId: ROOT_ID, fields: 'id, name', supportsAllDrives: true });
    console.log('START AT: "' + meta.data.name + '" {' + ROOT_ID + '}');
    console.log('');
    await walk(ROOT_ID, meta.data.name, 0);
  } catch (err) {
    console.error('ERROR:', err.message);
  }
})();
