// Refresh the bundled registry from IEEE; runtime never sends MACs to an external API.
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
async function download(url) {
  const {stdout:headers}=await execute('curl',['-fsSI','--max-time','20',url]);
  const size=Number(headers.match(/content-length:\s*(\d+)/i)?.[1]);
  const etag=headers.match(/etag:\s*([^\r\n]+)/i)?.[1];
  if(!size || size>12*1024*1024 || !/accept-ranges:\s*bytes/i.test(headers))throw new Error(`Unsupported registry download: ${url}`);
  const chunk=128*1024,parts=new Array(Math.ceil(size/chunk));let next=0;
  await Promise.all(Array.from({length:4},async()=>{
    while(next<parts.length){
      const index=next++,first=index*chunk,last=Math.min(size-1,first+chunk-1);
      const {stdout}=await execute('curl',['-fsSL','--max-time','45','--retry','1',...(etag?['-H',`If-Match: ${etag}`]:[]),'--range',`${first}-${last}`,url],{encoding:'buffer',maxBuffer:12*1024*1024});
      if(stdout.length!==last-first+1)throw new Error(`Incomplete registry chunk: ${url}`);
      parts[index]=stdout;
    }
  }));
  return Buffer.concat(parts).toString('utf8');
}
const sources = [
  'https://standards-oui.ieee.org/oui/oui.csv',
  'https://standards-oui.ieee.org/oui28/mam.csv',
  'https://standards-oui.ieee.org/oui36/oui36.csv',
];
function csvRows(text) {
  const rows=[]; let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') { if(quoted && text[i+1]==='"'){cell+='"';i++;} else quoted=!quoted; }
    else if(c===',' && !quoted){row.push(cell);cell='';}
    else if(c==='\n' && !quoted){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(cell||row.length){row.push(cell);rows.push(row);}
  return rows;
}
const entries={};
for(const rows of await Promise.all(sources.map(async url=>{
  const stdout=await download(url);
  console.log(`Downloaded ${url}`);
  return csvRows(stdout);
}))) {
  for(const [,prefix,name] of rows) if(/^(?:[A-F0-9]{6}|[A-F0-9]{7}|[A-F0-9]{9})$/.test(prefix) && name?.trim()) entries[prefix]=name.trim();
}
if(Object.keys(entries).length<30000)throw new Error('Incomplete IEEE registry; old file retained');
const directory=new URL('../electron/data/',import.meta.url);
await fs.mkdir(directory,{recursive:true});
await fs.writeFile(new URL('oui.json',directory),JSON.stringify({source:'IEEE Registration Authority',sources,updatedAt:new Date().toISOString(),entries}));
console.log(`Bundled ${Object.keys(entries).length} IEEE assignments`);
