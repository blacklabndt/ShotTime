const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
// Shell scripts with Windows line endings fail in bash ("set: pipefail: invalid option name").
const root=path.join(__dirname,'..'),scripts=fs.readdirSync(root).filter(f=>f.endsWith('.sh'));
assert.ok(scripts.length>=3);for(const f of scripts)assert.ok(!fs.readFileSync(path.join(root,f),'utf8').includes('\r'),f+' has Windows line endings; convert it to LF');
// The privacy text must not deny a permission the manifest requests.
const manifest=fs.readFileSync(path.join(root,'AndroidManifest.xml'),'utf8'),page=fs.readFileSync(path.join(root,'assets/index.html'),'utf8');
if(manifest.includes('android.permission.INTERNET'))assert.ok(!/no[^.<]*network permission/i.test(page)&&/Internet permission only for optional/.test(page),'privacy text must describe the optional Internet use');
console.log('PASS: shell scripts use Unix line endings ('+scripts.join(', ')+'); privacy text matches the Internet permission');
