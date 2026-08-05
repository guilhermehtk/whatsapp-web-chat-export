import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('store package uses independent branding and least-privilege permissions', async () => {
  const manifest = JSON.parse(await read('manifest.json'));
  const [popup, icon, generator, readme, privacy] = await Promise.all([
    read('popup.html'),
    read('icons/icon.svg'),
    read('icons/generate.html'),
    read('README.md'),
    read('PRIVACY.md'),
  ]);

  assert.equal(manifest.name, 'Chat Exporter for WhatsApp Web');
  assert.equal(manifest.version, '1.1');
  assert.deepEqual(manifest.permissions, ['activeTab']);
  assert.deepEqual(manifest.host_permissions, ['https://web.whatsapp.com/*']);
  assert.match(manifest.description, /not affiliated with WhatsApp or Meta/i);

  assert.match(popup, /<h1>Chat Exporter<\/h1>/);
  assert.match(popup, /Independent extension\. Not affiliated with WhatsApp or Meta\./);
  assert.doesNotMatch(`${popup}\n${icon}\n${generator}`, /#25d366|phone handset|speech bubble/i);
  assert.match(`${icon}\n${generator}`, /#2563eb/i);
  assert.match(readme, /^# Chat Exporter for WhatsApp Web/m);
  assert.match(privacy, /^# Privacy Policy — Chat Exporter for WhatsApp Web/m);
  assert.match(`${readme}\n${privacy}`, /not affiliated with WhatsApp or Meta/i);
});
