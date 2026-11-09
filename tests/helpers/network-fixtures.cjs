const dgram=require('node:dgram');
const net=require('node:net');
const http=require('node:http');
const tls=require('node:tls');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {promisify}=require('node:util');
const execute=promisify(require('node:child_process').execFile);
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const name=value=>Buffer.concat([...value.split('.').map(part=>Buffer.concat([Buffer.from([part.length]),Buffer.from(part)])),Buffer.from([0])]);
const word=value=>{const b=Buffer.alloc(2);b.writeUInt16BE(value);return b;};
const dword=value=>{const b=Buffer.alloc(4);b.writeUInt32BE(value);return b;};
async function fixtures() {
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'nettool-services-'));
  const dns=dgram.createSocket('udp4');
  dns.on('message',(message,remote)=>{
    let end=12;const labels=[];
    while(message[end]){labels.push(message.subarray(end+1,end+1+message[end]).toString());end+=message[end]+1;}
    const query=labels.join('.'),type=message.readUInt16BE(end+1),question=message.subarray(12,end+5);
    if(query==='timeout.test')return;
    const data={1:Buffer.from([127,0,0,1]),28:Buffer.from('00000000000000000000000000000001','hex'),
      2:name('ns.example.test'),5:name('alias.example.test'),12:name('device.example.test'),
      15:Buffer.concat([word(10),name('mail.example.test')]),16:Buffer.from([5,...Buffer.from('hello')]),
      33:Buffer.concat([word(10),word(5),word(5060),name('sip.example.test')]),
      6:Buffer.concat([name('ns.example.test'),name('hostmaster.example.test'),...[1,7200,3600,86400,300].map(dword)]),
      257:Buffer.concat([Buffer.from([0,5]),Buffer.from('issueca.example.test')])}[type];
    const missing=query==='missing.test';const header=Buffer.alloc(12);message.copy(header,0,0,2);
    header.writeUInt16BE(missing?0x8183:0x8180,2);header.writeUInt16BE(1,4);header.writeUInt16BE(data&&!missing?1:0,6);
    const answer=data&&!missing?Buffer.concat([Buffer.from([0xc0,0x0c]),word(type),word(1),dword(60),word(data.length),data]):Buffer.alloc(0);
    dns.send(Buffer.concat([header,question,answer]),remote.port,remote.address);
  });
  await new Promise(resolve=>dns.bind(0,'127.0.0.1',resolve));
  // Drain unexpected bytes (for example a TLS ClientHello) so the peer's FIN
  // can reach end/close instead of remaining behind a paused read buffer.
  const tcp=net.createServer(socket=>{socket.resume();socket.end();});await listen(tcp);
  const closed=net.createServer();await listen(closed);const closedPort=closed.address().port;await new Promise(resolve=>closed.close(resolve));
  const web=http.createServer((req,res)=>{
    if(req.url==='/redirect'){res.writeHead(302,{Location:'/file'});res.end();return;}
    if(req.url==='/error'){res.writeHead(503);res.end();return;}
    if(req.url==='/empty'){res.end();return;}
    if(req.url==='/stall'){res.writeHead(200);res.flushHeaders();return;}
    res.writeHead(200,{'Content-Type':'application/octet-stream'});
    if(req.url==='/stream') {const timer=setInterval(()=>res.write(Buffer.alloc(16384)),10);res.once('close',()=>clearInterval(timer));}
    else res.end(Buffer.alloc(2*1024*1024,7));
  });await listen(web);
  const keyFile=path.join(folder,'key.pem'),certFile=path.join(folder,'cert.pem');
  await execute('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','2','-subj','/CN=localhost'],{timeout:15000});
  const secure=tls.createServer({key:await fs.readFile(keyFile),cert:await fs.readFile(certFile)},socket=>socket.end());
  secure.on('tlsClientError',()=>{});await listen(secure);
  return {dnsPort:dns.address().port,openPort:tcp.address().port,closedPort,tlsPort:secure.address().port,url:`http://127.0.0.1:${web.address().port}`,
    async close(){dns.close();web.closeAllConnections();await Promise.all([tcp,web,secure].map(server=>new Promise(resolve=>server.close(resolve))));await fs.rm(folder,{recursive:true,force:true});}};
}
module.exports={fixtures};
