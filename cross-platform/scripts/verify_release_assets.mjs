// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import {createHash,createPublicKey,verify} from 'node:crypto';
const root = path.resolve(process.argv[2]);
const version = JSON.parse(fs.readFileSync('package.json')).version;
const names = fs.readdirSync(root);
const read = name => fs.readFileSync(path.join(root,name));
const requireAsset = pattern => {const matched=names.filter(name=>pattern.test(name));if(matched.length!==1)throw new Error(`Expected one asset: ${pattern} (${matched})`);return matched[0];};
requireAsset(/\.dmg$/); const exe=requireAsset(/-setup\.exe$/); const mac=requireAsset(/\.app\.tar\.gz$/);
const source=requireAsset(/-corresponding-source\.tar\.gz$/);
const wanted=read(`${source}.sha256`).toString().trim().split(/\s+/)[0];
if(createHash('sha256').update(read(source)).digest('hex')!==wanted)throw new Error('Corresponding source digest mismatch');
for(const platform of ['macos','windows']) {
 const proof=JSON.parse(read(`${platform}-install-verification.json`).toString().replace(/^\uFEFF/,''));
 if(!proof.passed||proof.version!==version||!proof.packaged_core||!proof.window_ready||!proof.recovery||!proof.pdf_undo||proof.backups!==12)throw new Error(`${platform} installation proof failed`);
 if(platform==='windows'&&!proof.uninstall)throw new Error('Windows uninstall not verified');
}
const config=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json'));
const keyLines=Buffer.from(config.plugins.updater.pubkey,'base64').toString().trim().split(/\r?\n/);
const key=Buffer.from(keyLines[1],'base64');
if(key.length!==42||key.subarray(0,2).toString()!=='Ed')throw new Error('Invalid updater public key');
const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),key.subarray(10)]),format:'der',type:'spki'});
function validateSignature(name,encoded) {
 const lines=Buffer.from(encoded.trim(),'base64').toString().trim().split(/\r?\n/);
 const packet=Buffer.from(lines[1]??'','base64');
 if(packet.length!==74||!packet.subarray(2,10).equals(key.subarray(2,10))||!lines[2]?.startsWith('trusted comment: '))throw new Error(`Malformed updater signature: ${name}`);
 const signature=packet.subarray(10);
 const algorithm=packet.subarray(0,2).toString();
 if(!['Ed','ED'].includes(algorithm))throw new Error('Unknown signature algorithm');
 const bytes=read(name); const message=algorithm==='ED'?createHash('blake2b512').update(bytes).digest():bytes;
 if(!verify(null,message,publicKey,signature)||!verify(null,Buffer.concat([signature,Buffer.from(lines[2].slice(17))]),publicKey,Buffer.from(lines[3]??'','base64')))throw new Error(`Updater signature verification failed: ${name}`);
}
for(const name of [exe,mac])validateSignature(name,read(`${name}.sig`).toString());
if(names.includes('latest.json')) {
 const latest=JSON.parse(read('latest.json'));
 if(latest.version!==version)throw new Error('Updater version mismatch');
 for(const platform of ['darwin-aarch64','windows-x86_64']) {
  const item=latest.platforms?.[platform]; if(!item)throw new Error(`Missing updater platform ${platform}`);
  const url=new URL(item.url);
  if(url.origin!=='https://github.com'||!url.pathname.startsWith(`/WhaleChao/OpenDeskTW/releases/download/v${version}/`))throw new Error('Unexpected updater URL');
  const name=decodeURIComponent(url.pathname.split('/').pop()); validateSignature(name,item.signature);
 }
} else throw new Error('Signed updater manifest missing');
fs.writeFileSync(path.join(root,'SHA256SUMS'),names.filter(name=>name!=='SHA256SUMS').sort().map(name=>`${createHash('sha256').update(read(name)).digest('hex')}  ${name}`).join('\n')+'\n');
fs.writeFileSync(path.join(root,'release-verification.json'),JSON.stringify({passed:true,version,source_sha256:wanted,platforms:['darwin-aarch64','windows-x86_64'],installer_verified:true,updater_signatures_verified:true,assets:names},null,2));
console.log('Release installers, source, updater manifest and Ed25519 signatures: PASS');
